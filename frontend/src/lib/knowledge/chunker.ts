import { createHash } from 'node:crypto';

import type { KnowledgeChunk, ParsedMessage } from './types';

export function approximateTokens(value: string) {
  return Math.max(1, Math.ceil(value.length / 4));
}

function splitLongUnit(unit: string, targetCharacters: number) {
  if (unit.length <= targetCharacters) return [unit];
  const sentences = unit.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
  if (sentences.length === 1) {
    const slices: string[] = [];
    for (let index = 0; index < unit.length; index += targetCharacters) {
      slices.push(unit.slice(index, index + targetCharacters));
    }
    return slices;
  }
  return sentences;
}

function semanticUnits(text: string, targetCharacters: number) {
  return text
    .split(/\n{2,}/)
    .flatMap((paragraph) => splitLongUnit(paragraph.trim(), targetCharacters))
    .filter(Boolean);
}

function isStructuralBoundary(unit: string) {
  return /^(?:#{1,6}\s+|--\s*\d+\s+of\s+\d+\s*--$)/i.test(unit.trim());
}

function sectionHeadingBefore(text: string, offset: number) {
  const matches = Array.from(
    text.slice(0, offset).matchAll(/^#{1,6}\s+(.{1,180})$/gm)
  );
  return matches[matches.length - 1]?.[1]?.trim() ?? '';
}

function takeOverlap(units: string[], overlapCharacters: number) {
  const overlap: string[] = [];
  let length = 0;
  for (let index = units.length - 1; index >= 0 && length < overlapCharacters; index -= 1) {
    overlap.unshift(units[index]);
    length += units[index].length + 2;
  }
  return overlap;
}

export function chunkMessage(
  message: ParsedMessage,
  targetTokens = 320,
  overlapTokens = 50,
): KnowledgeChunk[] {
  const targetCharacters = targetTokens * 4;
  const overlapCharacters = overlapTokens * 4;
  let primary = message.cleanText;
  let includesQuotedContext = false;

  if (primary.length < 160 && message.quotedHistory) {
    primary = `${primary}\n\nQuoted context from the immediately preceding reply:\n${message.quotedHistory.slice(
      0,
      1200,
    )}`.trim();
    includesQuotedContext = true;
  }
  if (!primary) return [];

  const units = semanticUnits(primary, targetCharacters);
  const groups: string[][] = [];
  let current: string[] = [];
  let currentLength = 0;

  for (const unit of units) {
    if (current.length && isStructuralBoundary(unit)) {
      groups.push(current);
      current = [];
      currentLength = 0;
    }
    const nextLength = currentLength + unit.length + (current.length ? 2 : 0);
    if (current.length && nextLength > targetCharacters) {
      groups.push(current);
      current = takeOverlap(current, overlapCharacters);
      currentLength = current.join('\n\n').length;
    }
    current.push(unit);
    currentLength += unit.length + (current.length > 1 ? 2 : 0);
  }
  if (current.length) groups.push(current);

  let cursor = 0;
  return groups.map((group, chunkIndex) => {
    const content = group.join('\n\n').trim();
    const firstUnit = group[0] ?? '';
    const foundAt = primary.indexOf(firstUnit, cursor);
    const startOffset = foundAt >= 0 ? foundAt : cursor;
    const endOffset = Math.min(primary.length, startOffset + content.length);
    cursor = Math.max(cursor, endOffset - overlapCharacters);
    const sourceStartLine =
      message.bodyStartLine + (primary.slice(0, startOffset).match(/\n/g)?.length ?? 0);
    const sourceEndLine = sourceStartLine + (content.match(/\n/g)?.length ?? 0);
    const sectionHeading = sectionHeadingBefore(primary, startOffset);
    const contextParts = [
      `Subject: ${message.subjectNormalized || '(no subject)'}`,
      sectionHeading ? `Section: ${sectionHeading}` : null,
      message.dateIso ? `Date: ${message.dateIso.slice(0, 10)}` : null,
      `Analyst: ${message.authorDisplay}`,
      `Source lines: ${sourceStartLine}-${sourceEndLine}`,
    ].filter(Boolean);
    const contextualContent = `${contextParts.join(' | ')}\n\n${content}`;

    return {
      chunkIndex,
      content,
      contextualContent,
      contentSha256: createHash('sha256').update(contextualContent).digest('hex'),
      approxTokens: approximateTokens(contextualContent),
      startOffset,
      endOffset,
      metadata: {
        includesQuotedContext,
        threadKey: message.threadKey,
        sourceStartLine,
        sourceEndLine,
        sectionHeading: sectionHeading || undefined,
        ...message.deterministicMetadata,
      },
    };
  });
}
