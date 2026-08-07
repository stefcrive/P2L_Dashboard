import path from 'node:path';

import { loadEnvConfig } from '@next/env';
import { NextResponse } from 'next/server';

import {
  executePlatformTool,
  PLATFORM_ENTITIES,
} from '@/lib/assistant/platform-tools';

export const runtime = 'nodejs';
export const maxDuration = 60;

let envLoaded = false;

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
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
      'Create a supported operational record. Call only when the user explicitly asks to add or record information.',
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
];

const instructions = `You are the P2L laboratory operations assistant embedded in its management platform.

You can retrieve platform data, inspect related records, update fields, create operational records, adjust stock, and produce Markdown reports.

Operating rules:
- Answer from tool results, never from invented platform facts.
- Use search to resolve record ids when needed. If multiple matches make a write ambiguous, ask the user which record they mean.
- Questions, explanations, reviews, and report requests are read-only. Do not mutate data unless the user explicitly asks to add, record, change, update, restock, consume, or otherwise write.
- Before any write, make sure the target and new values are unambiguous. After a successful write, state exactly what changed. Never claim success if a tool returned an error.
- Do not delete records. Explain that deletion is not available through the assistant.
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

async function createResponse(body: Record<string, unknown>): Promise<OpenAIResponse> {
  if (!envLoaded) {
    const roots = Array.from(
      new Set([
        process.cwd(),
        path.resolve(process.cwd(), '..'),
        path.resolve(process.cwd(), 'frontend'),
      ])
    );
    for (const root of roots) {
      try {
        loadEnvConfig(root, process.env.NODE_ENV !== 'production', {
          info: () => undefined,
          error: () => undefined,
        });
      } catch {
        // Continue through the same local-first environment fallbacks as Supabase.
      }
    }
    envLoaded = true;
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
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
  try {
    const body = (await request.json().catch(() => null)) as
      | { messages?: unknown[] }
      | null;
    const messages = (body?.messages ?? []).filter(isChatMessage).slice(-30);
    if (!messages.length || messages[messages.length - 1].role !== 'user') {
      return NextResponse.json(
        { error: 'A user message is required.' },
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

    const model = process.env.OPENAI_MODEL?.trim() || 'gpt-5.6-sol';
    let response = await createResponse({
      model,
      instructions,
      input: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
      tools,
      reasoning: { effort: 'medium', context: 'all_turns' },
      text: { verbosity: 'medium' },
    });

    for (let turn = 0; turn < 6; turn += 1) {
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
          output: JSON.stringify(result),
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

    const message = extractText(response);
    if (!message) {
      throw new Error('The assistant did not return a final response. Please try again.');
    }
    return NextResponse.json({ message });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unexpected assistant error.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
