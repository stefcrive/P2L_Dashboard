import { NextResponse } from 'next/server';
import { readUploadForm } from '@/lib/cloud/upload-form';

import {
  MAX_CLIENT_DOCUMENT_BYTES,
} from '@/lib/client-manager/documents';
import {
  loadAssistantUploads,
  stageAssistantUpload,
} from '@/lib/assistant/uploads';
import {
  executePlatformTool,
  PLATFORM_ENTITIES,
} from '@/lib/assistant/platform-tools';
import { getWorkspaceEnvironmentValue } from '@/lib/knowledge/config';
import { answerKnowledgeQuestion } from '@/lib/knowledge/retrieval';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const maxDuration = 180;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  attachments?: ChatAttachment[];
}

interface ChatAttachment {
  name: string;
  type: string;
  size: number;
  uploadId?: string;
  documentId?: string;
  clientId?: string;
  clientName?: string;
}

interface FunctionCall {
  type: 'function_call';
  name: string;
  call_id: string;
  arguments: string;
}

interface OpenAIResponse {
  id: string;
  error?: { message?: string };
  output?: Array<
    | FunctionCall
    | {
        type: 'message';
        content?: Array<{ type: string; text?: string }>;
      }
    | { type: string; [key: string]: unknown }
  >;
}

const entitySchema = {
  type: 'string',
  enum: PLATFORM_ENTITIES,
};

const deletableEntitySchema = {
  type: 'string',
  enum: [
    'client',
    'document',
    'credit_event',
    'material',
    'lab_entry',
    'queue_item',
  ],
};

const tools = [
  {
    type: 'function',
    name: 'get_platform_overview',
    description:
      'Return platform-wide record counts and attention items such as low stock, open invoices, service-due equipment, and backup issues.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'search_platform',
    description:
      'Search records across any or all platform entities. Use this to find ids before requesting details or making an explicit update.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Name, code, status, description, reference, or other text to find.',
        },
        entities: {
          type: 'array',
          items: entitySchema,
          description: 'Entity types to search. Omit to search the whole platform.',
        },
        limit: {
          type: 'number',
          description: 'Maximum records per entity, from 1 to 20.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_record_details',
    description:
      'Load one complete record by entity and id. Clients, materials, invoices, and purchase lists include related records.',
    parameters: {
      type: 'object',
      properties: {
        entity: entitySchema,
        id: { type: 'string' },
      },
      required: ['entity', 'id'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'update_record_fields',
    description:
      'Update allowed fields on one existing record, including sample queue status, priority, position, ownership, and analysis dates. Queue changes automatically synchronize to the linked lab-book entry. Call only when the user explicitly asks to change stored data.',
    parameters: {
      type: 'object',
      properties: {
        entity: entitySchema,
        id: { type: 'string' },
        fields: {
          type: 'object',
          description: 'Field names and new values for the selected entity.',
          additionalProperties: true,
        },
      },
      required: ['entity', 'id', 'fields'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'create_record',
    description:
      'Create a supported operational record, including a client, credit ledger event, inventory material, lab-book entry, or sample queue item. A queue_item requires sample_label, sample_count, and analysis_type; its analysis window is estimated automatically unless explicit dates are supplied. Call only when the user explicitly asks to add or record information.',
    parameters: {
      type: 'object',
      properties: {
        entity: entitySchema,
        fields: {
          type: 'object',
          description: 'Field names and values for the new record.',
          additionalProperties: true,
        },
      },
      required: ['entity', 'fields'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'delete_record',
    description:
      'Remove one supported record by id, including a sample queue item. Removing a queue item also removes its linked lab-book schedule and annexed queue files. Other document deletions remove database records only and never delete source documents from disk. Call only on an explicit, unambiguous removal request.',
    parameters: {
      type: 'object',
      properties: {
        entity: deletableEntitySchema,
        id: { type: 'string' },
      },
      required: ['entity', 'id'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'get_queue_schedule',
    description:
      'Inspect the queue as ordered run-level calendar data. Returns parent queue metadata, every split run id and run_position, sample-derived working-day duration, monthly calendar distribution, future sequence, gaps, overlaps, holiday/weekend validation, and whether runway order matches calendar order. Use before explaining or manipulating queue distribution.',
    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['active', 'future', 'all'],
          description:
            'active includes queued/analysing runs, future includes only future queued/analysing runs, and all includes past completed runs too.',
        },
        from_date: {
          type: 'string',
          description: 'Optional inclusive calendar start date in YYYY-MM-DD format.',
        },
        to_date: {
          type: 'string',
          description: 'Optional inclusive calendar end date in YYYY-MM-DD format.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'set_queue_item_runs',
    description:
      'Replace the complete run-segment list for one queue item. Use to split a queue item, resume it later, move or resize its individual calendar runs, or merge split runs. Existing run ids preserve those runs; omit an old run to remove it. Dates must start and end on working days and runs cannot overlap. Call only when the user explicitly requests the change.',
    parameters: {
      type: 'object',
      properties: {
        queue_item_id: { type: 'string' },
        runs: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description:
                  'Existing run id from get_queue_schedule. Omit only for a newly added split run.',
              },
              start_at: {
                type: 'string',
                description: 'Working-day start date or ISO timestamp.',
              },
              end_at: {
                type: 'string',
                description: 'Working-day end date or ISO timestamp.',
              },
              run_position: {
                type: 'number',
                description:
                  'Optional runway position for a new or existing run. Use move_queue_run for simple list reordering.',
              },
            },
            required: ['start_at', 'end_at'],
            additionalProperties: false,
          },
        },
      },
      required: ['queue_item_id', 'runs'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'move_queue_run',
    description:
      'Move one queue run before or after another run in the runway list. This operates on run ids, so split runs can be interleaved with other queue items. Set plan_calendar true only when the user also wants future calendar dates recalculated immediately.',
    parameters: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        target_run_id: { type: 'string' },
        placement: { type: 'string', enum: ['before', 'after'] },
        plan_calendar: {
          type: 'boolean',
          description:
            'When true, also distribute future runs in the new runway order. Past/current runs remain fixed.',
        },
      },
      required: ['run_id', 'target_run_id', 'placement', 'plan_calendar'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'move_queue_runs',
    description:
      'Apply multiple related runway moves atomically, then optionally plan the calendar once. Prefer this over repeated move_queue_run calls when the user asks to swap, replace, promote, demote, or move two or more queue runs. Resolve run ids with get_queue_schedule first.',
    parameters: {
      type: 'object',
      properties: {
        moves: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              run_id: { type: 'string' },
              target_run_id: { type: 'string' },
              placement: { type: 'string', enum: ['before', 'after'] },
            },
            required: ['run_id', 'target_run_id', 'placement'],
            additionalProperties: false,
          },
        },
        plan_calendar: {
          type: 'boolean',
          description:
            'When true, recalculate future dates once after all moves are applied.',
        },
      },
      required: ['moves', 'plan_calendar'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'plan_queue_calendar',
    description:
      'Apply Plan on calendar: recalculate future active queue runs in run_position order using ceil(sample_count / samples_per_week * 5) working days, preserve runs that start today or earlier, avoid weekends and Brazil/Sao Paulo laboratory holidays, and produce a validated calendar distribution. Call only when the user explicitly asks to plan, distribute, or recalculate the future queue calendar.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'annex_document_to_client',
    description:
      'Attach an existing file from the configured Clienti folder to a client record, or reassign an already indexed file to that client. Use search_platform to resolve the client id first.',
    parameters: {
      type: 'object',
      properties: {
        client_id: { type: 'string' },
        source_path: {
          type: 'string',
          description: 'Absolute path or path relative to the configured Clienti folder.',
        },
        category: {
          type: 'string',
          enum: [
            'quote',
            'invoice',
            'payment_slip',
            'payment_receipt',
            'credit',
            'purchase_order',
            'shipping',
            'analysis',
            'other',
          ],
        },
        year: { type: 'number' },
        document_number: { type: 'string' },
        document_date: { type: 'string' },
      },
      required: ['client_id', 'source_path'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'attach_uploaded_file_to_client',
    description:
      'Attach a file uploaded in this conversation to a client record. Use search_platform to resolve the client id, then use the upload_id supplied with the attachment. Call only when the user explicitly asks to attach or save the file.',
    parameters: {
      type: 'object',
      properties: {
        upload_id: { type: 'string' },
        client_id: { type: 'string' },
        category: {
          type: 'string',
          enum: [
            'quote',
            'invoice',
            'payment_slip',
            'payment_receipt',
            'credit',
            'purchase_order',
            'shipping',
            'analysis',
            'other',
          ],
        },
        year: { type: 'number' },
      },
      required: ['upload_id', 'client_id'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'import_uploaded_result_file',
    description:
      'Parse an uploaded Excel stable-isotope result workbook, attach the source workbook to the chosen client, and import its measurements into the result register. Use this instead of the generic attachment tool for scientific result workbooks.',
    parameters: {
      type: 'object',
      properties: {
        upload_id: { type: 'string' },
        client_id: { type: 'string' },
      },
      required: ['upload_id', 'client_id'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'adjust_material_stock',
    description:
      'Consume, restock, set current stock, or set minimum stock for a material and record the stock movement. Use only for an explicit user request.',
    parameters: {
      type: 'object',
      properties: {
        material_id: { type: 'string' },
        action: {
          type: 'string',
          enum: ['consume', 'restock', 'set_stock', 'set_minimum'],
        },
        amount: { type: 'number' },
        note: { type: 'string' },
      },
      required: ['material_id', 'action', 'amount'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'get_report_data',
    description:
      'Retrieve a bounded, report-ready dataset. Turn the result into a polished Markdown report with findings, evidence, caveats, and next actions.',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['executive', 'client', 'inventory', 'finance', 'operations'],
        },
        query: {
          type: 'string',
          description: 'Optional client, material, status, code, or other report filter.',
        },
      },
      required: ['kind'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'search_gmail',
    description:
      'Search the connected Gmail mailbox using Gmail query syntax and return message ids plus metadata. This is read-only.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Gmail search query, for example: from:supplier@example.com newer_than:30d.',
        },
        max_results: {
          type: 'number',
          description: 'Number of messages to return, from 1 to 20.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'read_gmail_message',
    description:
      'Read one Gmail message, including its headers, text body, labels, and attachment metadata. Use a message id returned by search_gmail.',
    parameters: {
      type: 'object',
      properties: { message_id: { type: 'string' } },
      required: ['message_id'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    type: 'function',
    name: 'create_gmail_draft',
    description:
      'Create a draft in the connected Gmail mailbox. Use when the user asks to draft, write, or prepare an email without explicitly asking to send it.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'array', items: { type: 'string' } },
        cc: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['to', 'subject', 'body'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'send_gmail_email',
    description:
      'Send an email immediately from the connected Gmail mailbox. Call only when the user explicitly asks to send an email and recipients, subject, and body are unambiguous. A request to write, compose, prepare, or draft is not permission to send.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'array', items: { type: 'string' } },
        cc: { type: 'array', items: { type: 'string' } },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['to', 'subject', 'body'],
      additionalProperties: false,
    },
  },
];

const instructions = `You are the P2L laboratory operations assistant embedded in its management platform.

You can retrieve platform data, inspect related records, manage the sample queue, update all editable client fields, create and remove supported records, attach uploaded files to clients, import uploaded result workbooks, annex existing document files, adjust stock, work with a connected Gmail mailbox, and produce Markdown reports.

Operating rules:
- Answer from tool results, never from invented platform facts.
- Use search to resolve record ids when needed. If multiple matches make a write ambiguous, ask the user which record they mean.
- Questions, explanations, reviews, and report requests are read-only. Do not mutate data unless the user explicitly asks to add, record, change, update, restock, consume, or otherwise write.
- Before any write, make sure the target and new values are unambiguous. After a successful write, state exactly what changed. Never claim success if a tool returned an error.
- Deletions are allowed only when the user explicitly asks to remove or delete a specific, unambiguous record. Client deletion can cascade to dependent database records and can fail when protected invoices exist. Document deletion removes only the database record, never the source file.
- Use annex_document_to_client for existing files in Clienti. Do not invent paths and do not claim a file was uploaded when no file path was provided.
- Uploaded files are retained for the conversation and identified by upload_id. Reviewing or discussing an upload is read-only. Use attach_uploaded_file_to_client only when the user asks to save or attach it to a client.
- Use import_uploaded_result_file when the user asks to import an uploaded Excel result workbook. It attaches the workbook and imports measurements together. After the user resolves any ambiguity and says to proceed, complete the import without asking them to reattach the file.
- User-attached images and files are primary context for the current request. Inspect them directly, distinguish their contents from platform records, and mention when a requested fact is not visible or extractable.
- Use adjust_material_stock for stock changes so movements are logged. Creating or removing an inventory material uses create_record or delete_record.
- The queue has two levels: a queue item is the sample batch; its one or more runs are the individually ordered and scheduled calendar segments. Split runs retain the same queue_item_id and can be interleaved with runs from other items.
- Use get_queue_schedule before explaining queue distribution or performing run-level changes. Treat run_position as the runway sequence and start_at/end_at as the calendar allocation. Use its validation and calendar_distribution instead of inferring from parent estimated dates alone.
- Use the queue_item entity to add, edit, reprioritize, change sample_count or samples_per_week, change status, assign an instrument/operator, or remove sample queue records. Queue writes automatically synchronize their linked lab-book schedule; do not create a second lab_entry for the same queue work.
- Use set_queue_item_runs to split, merge, interrupt/resume, move, or resize one item's calendar runs. It replaces that item's complete run list, so first retrieve existing run ids and include every run that should remain. Do not use update_record_fields with a partial segments array.
- Use move_queue_run for one runway move and move_queue_runs for a swap or any request involving multiple runs. Prefer the batch tool so all list changes are applied atomically and the calendar is planned at most once. Runs, not parent items, are the sortable units. Reordering alone changes sequence but not dates. Set plan_calendar true or separately use plan_queue_calendar only when the user asks to recalculate the future calendar.
- plan_queue_calendar affects only active runs whose start is after today. It follows run_position globally, assigns the item duration ceil(sample_count / samples_per_week * 5) across its runs, preserves past/current runs, and skips weekends plus Brazil/Sao Paulo laboratory holidays. It places future runs sequentially without overlap.
- A new queue_item requires sample_label, sample_count, and analysis_type. If the user does not provide an analysis window, let the queue calculate it from current capacity and method throughput. Use estimated_start_at and estimated_end_at only when the user explicitly supplies or requests different dates.
- Gmail search and reading are read-only. Use Gmail only when the user asks for an email task; do not inspect their mailbox speculatively.
- Use create_gmail_draft when the user asks to write, compose, prepare, or draft an email. Creating a draft does not require send permission from the user.
- Use send_gmail_email only when the user explicitly asks to send and the recipients, subject, and final body are unambiguous. Never treat a request to write or draft as permission to send. After sending, state the recipients and subject.
- Credit-ledger additions, updates, and removals must use the credit_event entity; balances are recalculated automatically.
- A message beginning with /knowledge is handled by the dedicated grounded knowledge-base pipeline before this agent is called.
- Reports should lead with the conclusion and use concise Markdown headings, tables, bullets, and recommendations. Include the reporting scope and note unavailable tables or missing data.
- Monetary values should keep their stored currency. Dates should be clear and unambiguous.
- Respond in the language used by the user. Use direct, professional laboratory-operations language.
- Keep routine responses compact, but provide sufficient evidence for decisions and reports.`;

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<ChatMessage>;
  return (
    (message.role === 'user' || message.role === 'assistant') &&
    typeof message.content === 'string' &&
    message.content.trim().length > 0
  );
}

const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);
const MAX_FILES = 8;
const MAX_REQUEST_FILE_BYTES = 50 * 1024 * 1024;

function attachmentFromUnknown(value: unknown): ChatAttachment | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<ChatAttachment>;
  if (!item.name || typeof item.name !== 'string') return null;
  return {
    name: item.name,
    type:
      typeof item.type === 'string' && item.type
        ? item.type
        : 'application/octet-stream',
    size: typeof item.size === 'number' ? item.size : 0,
    uploadId: typeof item.uploadId === 'string' ? item.uploadId : undefined,
    documentId:
      typeof item.documentId === 'string' ? item.documentId : undefined,
    clientId: typeof item.clientId === 'string' ? item.clientId : undefined,
    clientName:
      typeof item.clientName === 'string' ? item.clientName : undefined,
  };
}

function normalizeMessages(values: unknown[]) {
  return values.filter(isChatMessage).slice(-30).map((message) => ({
    ...message,
    attachments: Array.isArray(message.attachments)
      ? message.attachments
          .map(attachmentFromUnknown)
          .filter((item): item is ChatAttachment => Boolean(item))
      : [],
  }));
}

function normalizeKnowledgeEngineIds(value: unknown) {
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      parsed = [];
    }
  }
  if (!Array.isArray(parsed)) return undefined;
  return Array.from(
    new Set(
      parsed
        .map(Number)
        .filter((id) => Number.isSafeInteger(id) && id > 0)
    )
  ).slice(0, 50);
}

function normalizeThinking(value: unknown) {
  return value === true || value === 'true';
}

function decodeBytea(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (typeof value === 'string' && value.startsWith('\\x')) {
    return Uint8Array.from(Buffer.from(value.slice(2), 'hex'));
  }
  if (typeof value === 'string' && value) {
    return Uint8Array.from(Buffer.from(value, 'base64'));
  }
  return null;
}

function fileInputPart(name: string, type: string, bytes: Uint8Array) {
  const dataUrl = `data:${type || 'application/octet-stream'};base64,${Buffer.from(
    bytes
  ).toString('base64')}`;
  if (IMAGE_MIME_TYPES.has(type)) {
    return { type: 'input_image', image_url: dataUrl, detail: 'auto' };
  }
  return {
    type: 'input_file',
    filename: name,
    file_data: dataUrl,
    ...(type === 'application/pdf' ? { detail: 'auto' } : {}),
  };
}

async function readRequest(request: Request) {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('multipart/form-data') || request.headers.get('x-p2l-direct-upload') === '1') {
    const formData = await readUploadForm(request);
    let rawMessages: unknown[] = [];
    try {
      const parsed = JSON.parse(String(formData.get('messages') ?? '[]')) as unknown;
      rawMessages = Array.isArray(parsed) ? parsed : [];
    } catch {
      rawMessages = [];
    }
    return {
      messages: normalizeMessages(rawMessages),
      knowledgeEngineIds: normalizeKnowledgeEngineIds(
        formData.get('knowledgeEngineIds')
      ),
      thinking: normalizeThinking(formData.get('thinking')),
      files: formData
        .getAll('files')
        .filter((value): value is File => value instanceof File && value.size > 0),
    };
  }

  const body = (await request.json().catch(() => null)) as
    | { messages?: unknown[]; knowledgeEngineIds?: unknown; thinking?: unknown }
    | null;
  return {
    messages: normalizeMessages(body?.messages ?? []),
    knowledgeEngineIds: normalizeKnowledgeEngineIds(
      body?.knowledgeEngineIds
    ),
    thinking: normalizeThinking(body?.thinking),
    files: [] as File[],
  };
}

async function createModelInput(messages: ChatMessage[]) {
  const latestStoredIds = messages
    .slice()
    .reverse()
    .flatMap((message) => message.attachments ?? [])
    .map((attachment) => attachment.documentId)
    .filter((id): id is string => Boolean(id))
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .slice(0, MAX_FILES);
  const latestUploadIds = messages
    .slice()
    .reverse()
    .flatMap((message) => message.attachments ?? [])
    .map((attachment) => attachment.uploadId)
    .filter((id): id is string => Boolean(id))
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .slice(0, MAX_FILES);

  const storedById = new Map<
    string,
    { file_name: string; mime_type: string; content: Uint8Array }
  >();
  let contextualBytes = 0;
  if (latestStoredIds.length) {
    const database = getSupabaseAdminClient();
    const { data, error } = await database
      .from('client_documents')
      .select('id, file_name, mime_type, content')
      .in('id', latestStoredIds);
    if (!error) {
      for (const row of data ?? []) {
        const bytes = decodeBytea(row.content);
        if (!bytes || contextualBytes + bytes.byteLength > MAX_REQUEST_FILE_BYTES)
          continue;
        contextualBytes += bytes.byteLength;
        storedById.set(String(row.id), {
          file_name: String(row.file_name ?? 'document'),
          mime_type: String(row.mime_type ?? 'application/octet-stream'),
          content: bytes,
        });
      }
    }
  }
  const loadedUploads = await loadAssistantUploads(latestUploadIds);
  const uploadById = new Map(
    Array.from(loadedUploads.entries()).filter(([, upload]) => {
      if (contextualBytes + upload.bytes.byteLength > MAX_REQUEST_FILE_BYTES) {
        return false;
      }
      contextualBytes += upload.bytes.byteLength;
      return true;
    })
  );

  return Promise.all(
    messages.map(async (message) => {
      const parts: Array<Record<string, unknown>> = [
        { type: 'input_text', text: message.content },
      ];
      if (message.role === 'user') {
        for (const attachment of message.attachments ?? []) {
          const upload = attachment.uploadId
            ? uploadById.get(attachment.uploadId)
            : undefined;
          if (upload) {
            parts.push({
              type: 'input_text',
              text: `[Available uploaded file: ${upload.fileName}; upload_id: ${upload.id}]`,
            });
            parts.push(fileInputPart(upload.fileName, upload.mimeType, upload.bytes));
            continue;
          }
          const stored = attachment.documentId
            ? storedById.get(attachment.documentId)
            : undefined;
          if (stored) {
            parts.push(
              fileInputPart(stored.file_name, stored.mime_type, stored.content)
            );
          }
        }
      }
      return {
        role: message.role,
        content:
          parts.length === 1 && message.role === 'assistant'
            ? message.content
            : parts,
      };
    })
  );
}

function extractText(response: OpenAIResponse): string {
  const parts: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue;
    const messageItem = item as {
      type: 'message';
      content?: Array<{ type: string; text?: string }>;
    };
    for (const content of messageItem.content ?? []) {
      if (content.type === 'output_text' && content.text) parts.push(content.text);
    }
  }
  return parts.join('\n\n').trim();
}

const MAX_TOOL_OUTPUT_CHARACTERS = 500_000;
const MAX_PLATFORM_TOOL_TURNS = 6;
const MODEL_REQUEST_TIMEOUT_MS = 60_000;

function compactToolValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[nested data omitted]';
  if (typeof value === 'string') {
    return value.length > 8_000
      ? `${value.slice(0, 8_000)}… [${value.length - 8_000} characters omitted]`
      : value;
  }
  if (Array.isArray(value)) {
    const limit = 30;
    const items = value.slice(0, limit).map((item) => compactToolValue(item, depth + 1));
    if (value.length > limit) {
      items.push({ _truncated_items: value.length - limit });
    }
    return items;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const compacted = Object.fromEntries(
      entries.slice(0, 70).map(([key, item]) => [key, compactToolValue(item, depth + 1)])
    );
    if (entries.length > 70) compacted._truncated_fields = entries.length - 70;
    return compacted;
  }
  return value;
}

function serializeToolOutput(value: unknown): string {
  const serialized = JSON.stringify(compactToolValue(value));
  if (serialized.length <= MAX_TOOL_OUTPUT_CHARACTERS) return serialized;
  return JSON.stringify({
    truncated: true,
    message:
      'The tool result exceeded the assistant context budget. Refine the search or request one record by id.',
    preview: serialized.slice(0, MAX_TOOL_OUTPUT_CHARACTERS - 1_000),
    original_characters: serialized.length,
  });
}

async function createResponse(
  body: Record<string, unknown>,
  requestSignal?: AbortSignal
): Promise<OpenAIResponse> {
  const apiKey = getWorkspaceEnvironmentValue('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error(
      'The assistant is not configured. Add OPENAI_API_KEY to the project .env file and restart the app.'
    );
  }

  let response: Response;
  try {
    const timeoutSignal = AbortSignal.timeout(MODEL_REQUEST_TIMEOUT_MS);
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: requestSignal
        ? AbortSignal.any([requestSignal, timeoutSignal])
        : timeoutSignal,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError')
    ) {
      throw new Error(
        'The assistant model request timed out. No further queue actions were attempted; please retry.'
      );
    }
    throw error;
  }
  const payload = (await response.json().catch(() => null)) as OpenAIResponse | null;
  if (!response.ok || !payload) {
    const message =
      payload?.error?.message ?? `OpenAI request failed with status ${response.status}.`;
    throw new Error(message);
  }
  return payload;
}

export async function POST(request: Request) {
  let responseAttachments: ChatAttachment[] = [];
  try {
    const { messages, files, knowledgeEngineIds, thinking } =
      await readRequest(request);
    if (!messages.length || messages[messages.length - 1].role !== 'user') {
      return NextResponse.json(
        { error: 'A user message is required.' },
        { status: 400 }
      );
    }

    if (files.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Attach no more than ${MAX_FILES} files per message.` },
        { status: 400 }
      );
    }
    const oversized = files.find((file) => file.size > MAX_CLIENT_DOCUMENT_BYTES);
    if (oversized) {
      return NextResponse.json(
        { error: `${oversized.name} exceeds the 25 MB file limit.` },
        { status: 400 }
      );
    }
    if (files.reduce((total, file) => total + file.size, 0) > MAX_REQUEST_FILE_BYTES) {
      return NextResponse.json(
        { error: 'Attachments exceed the 50 MB combined limit.' },
        { status: 400 }
      );
    }

    const totalCharacters = messages.reduce(
      (total, message) => total + message.content.length,
      0
    );
    if (totalCharacters > 60_000) {
      return NextResponse.json(
        { error: 'This conversation is too long. Start a new chat to continue.' },
        { status: 400 }
      );
    }
    if (!getWorkspaceEnvironmentValue('OPENAI_API_KEY')) {
      return NextResponse.json(
        {
          error:
            'The assistant is not configured. Add OPENAI_API_KEY to the project .env file and restart the app.',
        },
        { status: 500 }
      );
    }

    if (files.length) {
      const staged = [];
      for (const file of files) {
        staged.push(await stageAssistantUpload(file));
      }
      responseAttachments = staged.map((upload) => ({
        name: upload.fileName,
        type: upload.mimeType,
        size: upload.size,
        uploadId: upload.id,
      }));
    }

    const modelMessages = messages.map((message, index) =>
      index === messages.length - 1 && message.role === 'user' && files.length
        ? { ...message, attachments: responseAttachments }
        : message
    );

    const latestMessage = messages[messages.length - 1].content.trim();
    const knowledgeMatch = latestMessage.match(/^\/knowledge(?:\s+|$)([\s\S]*)/i);
    if (knowledgeMatch && !files.length) {
      const question = knowledgeMatch[1].trim();
      if (!question) {
        return NextResponse.json(
          { error: 'Add a question after /knowledge.' },
          { status: 400 }
        );
      }
      if (knowledgeEngineIds !== undefined && !knowledgeEngineIds.length) {
        return NextResponse.json(
          { error: 'Select at least one active knowledge engine.' },
          { status: 400 }
        );
      }
      const result = await answerKnowledgeQuestion({
        question,
        rerank: true,
        engineIds: knowledgeEngineIds,
        thinking,
      });
      const sources = result.evidence.map(
        (item) =>
          `- **[KB:${item.chunkId}]** ${item.sourceName}, ${
            item.visual
              ? `${item.visual.kind} on page ${item.visual.pageNumber}`
              : `lines ${item.startLine}–${item.endLine}`
          }${
            item.subject ? ` — ${item.subject}` : ''
          }`
      );
      const message = sources.length
        ? `${result.answer}\n\n### Retrieved sources\n${sources.join('\n')}`
        : result.answer;
      return NextResponse.json({
        message,
        mode: 'knowledge',
        evidence: result.evidence,
        trace: result.trace,
        knowledgeEngineIds: knowledgeEngineIds ?? null,
        attachments: responseAttachments,
      });
    }

    const model = getWorkspaceEnvironmentValue('OPENAI_MODEL') || 'gpt-5.6-sol';
    let response = await createResponse({
      model,
      instructions,
      input: await createModelInput(modelMessages),
      tools,
      reasoning: { effort: 'medium', context: 'all_turns' },
      text: { verbosity: 'medium' },
    }, request.signal);

    for (let turn = 0; turn < MAX_PLATFORM_TOOL_TURNS; turn += 1) {
      const calls = (response.output ?? []).filter(
        (item): item is FunctionCall => item.type === 'function_call'
      );
      if (!calls.length) break;

      const outputs = [];
      for (const call of calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.arguments) as Record<string, unknown>;
        } catch {
          args = {};
        }
        const result = await executePlatformTool(call.name, args);
        outputs.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: serializeToolOutput(result),
        });
      }

      const lastToolTurn = turn === MAX_PLATFORM_TOOL_TURNS - 1;
      response = await createResponse(
        lastToolTurn
          ? {
              model,
              instructions: `${instructions}\n\nThe platform tool-turn limit has been reached. Provide the final user-facing response now from the completed tool results. Do not request another tool call.`,
              previous_response_id: response.id,
              input: outputs,
              reasoning: { effort: 'low', context: 'all_turns' },
              text: { verbosity: 'medium' },
            }
          : {
              model,
              instructions,
              previous_response_id: response.id,
              input: outputs,
              tools,
              reasoning: { effort: 'medium', context: 'all_turns' },
              text: { verbosity: 'medium' },
            },
        request.signal
      );
    }

    let message = extractText(response);
    if (!message) {
      response = await createResponse({
        model,
        instructions,
        previous_response_id: response.id,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: 'Provide the final user-facing response now. Summarize completed actions and any confirmed errors. Do not call more tools.',
              },
            ],
          },
        ],
        reasoning: { effort: 'low', context: 'all_turns' },
        text: { verbosity: 'medium' },
      }, request.signal);
      message = extractText(response);
    }
    if (!message) {
      throw new Error('The assistant did not return a final response. Please try again.');
    }
    return NextResponse.json({ message, attachments: responseAttachments });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unexpected assistant error.';
    return NextResponse.json(
      { error: message, attachments: responseAttachments },
      { status: 500 }
    );
  }
}
