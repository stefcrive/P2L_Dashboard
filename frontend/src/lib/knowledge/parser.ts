import { createHash } from 'node:crypto';

import { extractDeterministicMetadata } from './taxonomy';
import type { ParsedMessage } from './types';

export const MERGED_CONVERSATION_PARSER_VERSION = 'merged_conversation_v3';

const MESSAGE_HEADER =
  /^Subject:([^\r\n]*)\r?\nAuthor:([^\r\n]*)\r?\nDate:([^\r\n]*)\r?\n={50}\r?$/gm;
const TRAILING_SEPARATOR = /\r?\n={50}\s*$/;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Keep phone candidates on one physical line. `\s` also matches newlines and
// caused vertical runs of figure/table values to be removed as one phone number.
const PHONE_PATTERN =
  /(?<!\d)(?:\+?\d[ \t().-]*)?(?:\d[ \t().-]*){7,14}\d(?!\d)/g;

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeNewlines(value: string) {
  return value.replace(/\r\n?/g, '\n');
}

function normalizeWhitespace(value: string) {
  return normalizeNewlines(value)
    .normalize('NFC')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

export function maskPersonalData(value: string) {
  return value
    .replace(EMAIL_PATTERN, '[email redacted]')
    .replace(PHONE_PATTERN, '[phone redacted]');
}

function normalizeSubject(subject: string) {
  let normalized = subject.normalize('NFC').trim();
  while (/^(?:re|fw|fwd)\s*:/i.test(normalized)) {
    normalized = normalized.replace(/^(?:re|fw|fwd)\s*:\s*/i, '');
  }
  return normalized.replace(/\s+/g, ' ').trim();
}

function parseAuthor(authorRaw: string) {
  const email = authorRaw.match(EMAIL_PATTERN)?.[0]?.toLowerCase() ?? null;
  const display =
    authorRaw
      .replace(EMAIL_PATTERN, '')
      .replace(/[<>"']/g, '')
      .replace(/\s+/g, ' ')
      .trim() || 'Unknown analyst';
  return {
    display,
    emailHash: email ? sha256(email) : null,
  };
}

function parseDate(dateRaw: string, warnings: string[]) {
  const timestamp = Date.parse(dateRaw.trim());
  if (Number.isNaN(timestamp)) {
    warnings.push('unparseable_date');
    return null;
  }
  const parsed = new Date(timestamp);
  const currentYear = new Date().getUTCFullYear();
  if (parsed.getUTCFullYear() < 1990 || parsed.getUTCFullYear() > currentYear + 2) {
    warnings.push('date_outlier');
  }
  return parsed.toISOString();
}

function findQuoteBoundary(body: string) {
  const patterns = [
    /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
    /^\s*-{2,}\s*Forwarded message\s*-{2,}\s*$/im,
    /^\s*On .{3,240} wrote:\s*$/im,
    /^\s*Begin forwarded message:\s*$/im,
    /^\s*>+\s?/m,
    /^\s*From:\s*.+\n(?:Sent|Date):\s*.+\n(?:To|Subject):\s*.+/im,
    /^\s*From:\s*\n[\s\S]{1,500}?^\s*(?:Sent|Date):\s*/im,
  ];
  const boundaries = patterns
    .map((pattern) => body.search(pattern))
    .filter((index) => index >= 0);
  return boundaries.length ? Math.min(...boundaries) : -1;
}

function splitSignature(body: string) {
  const footerPatterns = [
    /^\s*--\s*$/m,
    /^\s*_{5,}\s*$/m,
    /^\s*(?:best\s+regards|kind\s+regards|regards|cheers|sincerely),?\s*$/im,
    /^\s*To unsubscribe from this (?:group|list).+$/im,
    /^\s*You received this message because you are subscribed.+$/im,
  ];
  const candidates = footerPatterns
    .map((pattern) => body.search(pattern))
    .filter((index) => index >= Math.floor(body.length * 0.45) && body.length - index <= 1800);
  if (!candidates.length) return { content: body, signature: '' };
  const boundary = Math.min(...candidates);
  return {
    content: body.slice(0, boundary).trim(),
    signature: body.slice(boundary).trim(),
  };
}

function lineStartsFor(text: string) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function lineAtOffset(starts: number[], offset: number) {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle] <= offset) low = middle + 1;
    else high = middle;
  }
  return Math.max(1, low);
}

export function parseMergedConversation(content: string): ParsedMessage[] {
  const matches = Array.from(content.matchAll(MESSAGE_HEADER));
  const lineStarts = lineStartsFor(content);

  return matches.map((match, sourceOrdinal) => {
    const warnings: string[] = [];
    const headerStart = match.index ?? 0;
    const headerEnd = headerStart + match[0].length;
    const recordEnd = matches[sourceOrdinal + 1]?.index ?? content.length;
    const rawRecord = content.slice(headerStart, recordEnd);
    const bodySegment = content.slice(headerEnd, recordEnd);
    const leadingBodyWhitespace = bodySegment.match(/^(?:\r?\n)+/)?.[0] ?? '';
    const bodyRaw = bodySegment
      .slice(leadingBodyWhitespace.length)
      .replace(TRAILING_SEPARATOR, '')
      .trim();
    const subjectRaw = match[1]?.trim() ?? '';
    const authorRaw = match[2]?.trim() ?? '';
    const dateRaw = match[3]?.trim() ?? '';

    if (!subjectRaw) warnings.push('blank_subject');
    if (!bodyRaw) warnings.push('blank_body');
    if (rawRecord.length > 100_000) warnings.push('oversized_record');

    const normalizedBody = normalizeWhitespace(bodyRaw);
    const quoteBoundary = findQuoteBoundary(normalizedBody);
    const unquoted =
      quoteBoundary >= 0 ? normalizedBody.slice(0, quoteBoundary).trim() : normalizedBody;
    const quotedHistory =
      quoteBoundary >= 0 ? normalizedBody.slice(quoteBoundary).trim() : '';
    const { content: bodyNew, signature } = splitSignature(unquoted);
    const cleanText = normalizeWhitespace(maskPersonalData(bodyNew));
    const subjectNormalized = normalizeSubject(subjectRaw);
    const author = parseAuthor(authorRaw);
    const stableId = sha256(
      `${subjectNormalized}\n${author.emailHash ?? author.display}\n${dateRaw}\n${bodyRaw}`,
    );
    const threadKey = sha256(subjectNormalized.toLowerCase() || stableId);
    const deterministicMetadata = extractDeterministicMetadata(
      `${subjectNormalized}\n${cleanText}`,
    );

    return {
      sourceOrdinal,
      stableId,
      subjectRaw,
      subjectNormalized,
      threadKey,
      authorRaw,
      authorDisplay: author.display,
      authorEmailHash: author.emailHash,
      dateRaw,
      dateIso: parseDate(dateRaw, warnings),
      bodyRaw,
      bodyNew,
      quotedHistory,
      signatureText: signature,
      cleanText,
      startOffset: headerStart,
      endOffset: recordEnd,
      startLine: lineAtOffset(lineStarts, headerStart),
      bodyStartLine: lineAtOffset(lineStarts, headerEnd + leadingBodyWhitespace.length),
      endLine: lineAtOffset(lineStarts, Math.max(headerStart, recordEnd - 1)),
      warnings,
      deterministicMetadata,
    };
  });
}
