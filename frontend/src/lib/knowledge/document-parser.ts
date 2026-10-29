import { createHash } from 'node:crypto';
import path from 'node:path';

import * as XLSX from 'xlsx';

import { extractImageKnowledge } from './openai';
import { extractPdfVisualKnowledge } from './pdf-visuals';
import {
  maskPersonalData,
  MERGED_CONVERSATION_PARSER_VERSION,
  parseMergedConversation,
} from './parser';
import { extractDeterministicMetadata } from './taxonomy';
import type { ParsedMessage, ParsedVisualAsset } from './types';

export const STRUCTURED_DOCUMENT_PARSER_VERSION = 'structured_document_v5';

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

// Keep the source document itself immutable, but repair extraction artifacts in
// the text that is chunked and embedded. These transformations are deliberately
// conservative: they remove soft hyphens, join alphabetic line-wrap hyphens,
// and normalize common PDF ligatures without trying to invent missing words.
export function normalizeDocumentSearchText(value: string) {
  return normalizeText(value)
    .replace(/\u00ad/g, '')
    .replace(/([A-Za-z])-[ \t]*\n(?=[a-z])/g, '$1')
    .replace(/[ﬀ-ﬆ]/g, (ligature) => {
      const replacements: Record<string, string> = {
        'ﬀ': 'ff',
        'ﬁ': 'fi',
        'ﬂ': 'fl',
        'ﬃ': 'ffi',
        'ﬄ': 'ffl',
        'ﬅ': 'st',
        'ﬆ': 'st',
      };
      return replacements[ligature] ?? ligature;
    });
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
  const normalizedContent = normalizeText(content);
  const cleanText = normalizeDocumentSearchText(
    maskPersonalData(normalizedContent)
  );
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
    bodyRaw: normalizedContent,
    bodyNew: normalizedContent,
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

function visualAssetMessage(
  sourceName: string,
  asset: ParsedVisualAsset,
  sourceOrdinal: number
): ParsedMessage {
  const subject = `${sourceName} - ${asset.kind} on page ${asset.pageNumber}`;
  const content = normalizeText(
    [
      `# ${subject}`,
      asset.caption ? `Caption: ${asset.caption}` : '',
      asset.description,
    ]
      .filter(Boolean)
      .join('\n\n')
  );
  return {
    sourceOrdinal,
    stableId: asset.stableId,
    subjectRaw: subject,
    subjectNormalized: subject,
    threadKey: sha256(`${sourceName.toLowerCase()}:visual:${asset.pageNumber}`),
    authorRaw: '',
    authorDisplay: 'Document visual',
    authorEmailHash: null,
    dateRaw: '',
    dateIso: null,
    bodyRaw: content,
    bodyNew: content,
    quotedHistory: '',
    signatureText: '',
    cleanText: content,
    startOffset: 0,
    endOffset: content.length,
    startLine: 1,
    bodyStartLine: 1,
    endLine: Math.max(1, content.split('\n').length),
    warnings: [],
    deterministicMetadata: {
      ...extractDeterministicMetadata(`${sourceName}\n${content}`),
      sourceFormat: 'pdf_visual',
      extractionIsDerived: true,
      pageNumber: asset.pageNumber,
      visualAsset: asset,
    },
  };
}

async function extractPdfText(rawBuffer: Buffer) {
  // Load native PDF support only when parsing a PDF. Explicit imports ensure
  // Vercel includes the canvas runtime used by PDF.js in its function bundle.
  const canvas = await import('@napi-rs/canvas');
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.DOMMatrix ??= canvas.DOMMatrix;
  globals.ImageData ??= canvas.ImageData;
  globals.Path2D ??= canvas.Path2D;
  const { PDFParse, VerbosityLevel } = await import('pdf-parse');
  const parser = new PDFParse({
    data: rawBuffer,
    // Malformed embedded font maps are common in scientific PDFs. They do not
    // prevent text extraction, so keep the queue log focused on actionable
    // parser errors instead of emitting one warning per affected font.
    verbosity: VerbosityLevel.ERRORS,
  });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

export async function parseKnowledgeDocument(
  sourcePath: string,
  rawBuffer: Buffer,
  options: { describeVisuals?: boolean } = {}
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
        parserVersion: MERGED_CONVERSATION_PARSER_VERSION,
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
    const visualKnowledge = await extractPdfVisualKnowledge({
      sourcePath,
      sourceName,
      rawBuffer,
      describeVisuals: options.describeVisuals ?? false,
    });
    const extractedText =
      visualKnowledge?.markdown ?? (await extractPdfText(rawBuffer));
    const content = normalizeText(`# ${sourceName}\n\n${extractedText}`);
    if (!content.replace(`# ${sourceName}`, '').trim()) {
      throw new Error(
        'The PDF contains no extractable text or visual structure.'
      );
    }
    const documentMessage = genericDocumentMessage(
      sourceName,
      content,
      visualKnowledge ? 'pdf_docling' : 'pdf_text',
      visualKnowledge ? [] : ['pdf_visual_extraction_unavailable']
    );
    if (visualKnowledge) {
      documentMessage.deterministicMetadata = {
        ...documentMessage.deterministicMetadata,
        visualAssetCount: visualKnowledge.assets.length,
        extractionWarnings: visualKnowledge.warnings,
      };
    }
    return {
      messages: [
        documentMessage,
        ...(visualKnowledge?.assets.map((asset, index) =>
          visualAssetMessage(sourceName, asset, index + 1)
        ) ?? []),
      ],
      parserVersion: visualKnowledge
        ? `${visualKnowledge.parserVersion}_${STRUCTURED_DOCUMENT_PARSER_VERSION}`
        : STRUCTURED_DOCUMENT_PARSER_VERSION,
      sourceFormat: 'pdf',
    };
  }

  if (IMAGE_MIME_TYPES[extension]) {
    const extracted = await extractImageKnowledge(
      rawBuffer,
      IMAGE_MIME_TYPES[extension],
      sourceName
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
