import { createHash } from 'node:crypto';
import path from 'node:path';

import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import * as XLSX from 'xlsx';

import { extractImageKnowledge } from './openai';
import { maskPersonalData, parseMergedConversation } from './parser';
import { extractDeterministicMetadata } from './taxonomy';
import type { ParsedMessage } from './types';

export const STRUCTURED_DOCUMENT_PARSER_VERSION = 'structured_document_v2';

export const SUPPORTED_SOURCE_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.csv',
  '.tsv',
  '.xls',
  '.xlsx',
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
]);

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeText(value: string) {
  return value
    .replace(/\r\n?/g, '\n')
    .normalize('NFC')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function escapeMarkdownCell(value: unknown) {
  return String(value ?? '')
    .replace(/\r?\n/g, '<br>')
    .replace(/\|/g, '\\|')
    .trim();
}

function rowsToMarkdown(rows: unknown[][]) {
  if (!rows.length) return '_Empty sheet_';
  const width = Math.max(...rows.map((row) => row.length), 1);
  const normalized = rows.map((row) =>
    Array.from({ length: width }, (_, index) => escapeMarkdownCell(row[index]))
  );
  const header = normalized[0];
  const body = normalized.slice(1);
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function spreadsheetToMarkdown(buffer: Buffer, sourceName: string) {
  const workbook = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: true,
    cellText: false,
  });
  const sections = workbook.SheetNames.map((sheetName) => {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(
      workbook.Sheets[sheetName],
      {
        header: 1,
        raw: false,
        defval: '',
        blankrows: false,
      }
    );
    return `## Sheet: ${sheetName}\n\n${rowsToMarkdown(rows)}`;
  });
  return normalizeText(`# ${sourceName}\n\n${sections.join('\n\n')}`);
}

function genericDocumentMessage(
  sourceName: string,
  content: string,
  format: string,
  warnings: string[]
): ParsedMessage {
  const cleanText = normalizeText(maskPersonalData(content));
  const stableId = sha256(`${sourceName}\n${content}`);
  const lines = Math.max(1, content.split('\n').length);
  return {
    sourceOrdinal: 0,
    stableId,
    subjectRaw: sourceName,
    subjectNormalized: sourceName,
    threadKey: sha256(sourceName.toLowerCase()),
    authorRaw: '',
    authorDisplay: 'Source document',
    authorEmailHash: null,
    dateRaw: '',
    dateIso: null,
    bodyRaw: content,
    bodyNew: content,
    quotedHistory: '',
    signatureText: '',
    cleanText,
    startOffset: 0,
    endOffset: content.length,
    startLine: 1,
    bodyStartLine: 1,
    endLine: lines,
    warnings,
    deterministicMetadata: {
      ...extractDeterministicMetadata(`${sourceName}\n${cleanText}`),
      sourceFormat: format,
      extractionIsDerived: format !== 'text',
    },
  };
}

export async function parseKnowledgeDocument(
  sourcePath: string,
  rawBuffer: Buffer
): Promise<{
  messages: ParsedMessage[];
  parserVersion: string;
  sourceFormat: string;
}> {
  const sourceName = path.basename(sourcePath);
  const extension = path.extname(sourcePath).toLowerCase();

  if (extension === '.txt' || extension === '.md') {
    const rawContent = rawBuffer.toString('utf8');
    const conversations = parseMergedConversation(rawContent);
    if (conversations.length) {
      return {
        messages: conversations,
        parserVersion: 'merged_conversation_v2',
        sourceFormat: 'merged_conversation_text',
      };
    }
    return {
      messages: [genericDocumentMessage(sourceName, rawContent, 'text', [])],
      parserVersion: STRUCTURED_DOCUMENT_PARSER_VERSION,
      sourceFormat: extension === '.md' ? 'markdown' : 'plain_text',
    };
  }

  if (['.csv', '.tsv', '.xls', '.xlsx'].includes(extension)) {
    const markdown = spreadsheetToMarkdown(rawBuffer, sourceName);
    return {
      messages: [
        genericDocumentMessage(sourceName, markdown, 'spreadsheet_markdown', [
          'spreadsheet_converted_to_markdown',
        ]),
      ],
      parserVersion: STRUCTURED_DOCUMENT_PARSER_VERSION,
      sourceFormat: 'spreadsheet',
    };
  }

  if (extension === '.pdf') {
    const parsed = await pdfParse(rawBuffer);
    const content = normalizeText(`# ${sourceName}\n\n${parsed.text}`);
    if (!content.replace(`# ${sourceName}`, '').trim()) {
      throw new Error(
        'The PDF contains no extractable text. Use the planned Docling/OCR bridge for scanned PDFs.'
      );
    }
    return {
      messages: [
        genericDocumentMessage(sourceName, content, 'pdf_text', [
          'pdf_text_extraction_only',
          'figures_and_charts_require_docling',
        ]),
      ],
      parserVersion: STRUCTURED_DOCUMENT_PARSER_VERSION,
      sourceFormat: 'pdf',
    };
  }

  if (IMAGE_MIME_TYPES[extension]) {
    const extracted = await extractImageKnowledge(
      rawBuffer,
      IMAGE_MIME_TYPES[extension],
      sourceName,
    );
    const content = normalizeText(`# ${sourceName}\n\n${extracted}`);
    return {
      messages: [
        genericDocumentMessage(sourceName, content, 'image_vision', [
          'image_content_extracted_with_vision_model',
          'verify_critical_transcriptions_against_source_image',
        ]),
      ],
      parserVersion: STRUCTURED_DOCUMENT_PARSER_VERSION,
      sourceFormat: 'image',
    };
  }

  throw new Error(
    `Unsupported knowledge source: ${extension || 'unknown file type'}.`
  );
}
