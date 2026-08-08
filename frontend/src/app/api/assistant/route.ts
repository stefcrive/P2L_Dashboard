import { NextResponse } from 'next/server';

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
  enum: ['client', 'document', 'credit_event', 'material', 'lab_entry'],
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
      'Update allowed fields on one existing record. Call only when the user explicitly asks to change stored data. Never infer permission from a question or report request.',
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
      'Create a supported operational record, including a client, credit ledger event, inventory material, or lab-book entry. Call only when the user explicitly asks to add or record information.',
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
      'Remove one client, client document record, credit ledger event, inventory material, or lab-book entry by id. This deletes database records only and never deletes document files from disk. Call only on an explicit, unambiguous removal request.',
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

You can retrieve platform data, inspect related records, update all editable client fields, create and remove supported records, attach uploaded files to clients, import uploaded result workbooks, annex existing document files, adjust stock, work with a connected Gmail mailbox, and produce Markdown reports.

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
  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    let rawMessages: unknown[] = [];
    try {
      const parsed = JSON.parse(String(formData.get('messages') ?? '[]')) as unknown;
      rawMessages = Array.isArray(parsed) ? parsed : [];
    } catch {
      rawMessages = [];
    }
    return {
      messages: normalizeMessages(rawMessages),
      files: formData
        .getAll('files')
        .filter((value): value is File => value instanceof File && value.size > 0),
    };
  }

  const body = (await request.json().catch(() => null)) as
    | { messages?: unknown[] }
    | null;
  return {
    messages: normalizeMessages(body?.messages ?? []),
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

async function createResponse(body: Record<string, unknown>): Promise<OpenAIResponse> {
  const apiKey = getWorkspaceEnvironmentValue('OPENAI_API_KEY');
  if (!apiKey) {
    throw new Error(
      'The assistant is not configured. Add OPENAI_API_KEY to the project .env file and restart the app.'
    );
  }

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
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
    const { messages, files } = await readRequest(request);
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
      const result = await answerKnowledgeQuestion({ question, rerank: true });
      const sources = result.evidence.map(
        (item) =>
          `- **[KB:${item.chunkId}]** ${item.sourceName}, lines ${item.startLine}–${item.endLine}${
            item.subject ? ` — ${item.subject}` : ''
          }`
      );
      const message = sources.length
        ? `${result.answer}\n\n### Retrieved sources\n${sources.join('\n')}`
        : result.answer;
      return NextResponse.json({
        message,
        mode: 'knowledge',
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
    });

    for (let turn = 0; turn < 10; turn += 1) {
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

      response = await createResponse({
        model,
        instructions,
        previous_response_id: response.id,
        input: outputs,
        tools,
        reasoning: { effort: 'medium', context: 'all_turns' },
        text: { verbosity: 'medium' },
      });
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
      });
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
