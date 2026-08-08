import { createHash } from 'node:crypto';
import { access, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLEANUP_VERSION = 'isogeochem_cleanup_v1';
export const RECORD_SEPARATOR = '='.repeat(50);

const MESSAGE_HEADER =
  /^Subject:([^\r\n]*)\r?\nAuthor:([^\r\n]*)\r?\nDate:([^\r\n]*)\r?\n={50}\r?$/gm;
const TRAILING_SEPARATOR = /\r?\n={50}\s*$/;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN =
  /(?<!\d)(?:\+?\d[\s().-]*)?(?:\d[\s().-]*){7,14}\d(?!\d)/g;

const JOB_SUBJECT_PATTERN =
  /\b(?:job(?:s| posting| announcement| offer| adverts?)?|vacanc(?:y|ies)|position(?:s)? available|position opening|postdoc(?:toral)?|post-doc|studentship|ph\.?d\.? (?:position|project|opportunity)|doctoral (?:position|opportunity)|research fellow|employment opportunity|career opportunity|faculty|lecturer position|assistant prof(?:essor)?|associate prof(?:essor)?|tenure[- ]track|open rank|endowed chair|research scientist position|research associate position|research assistant professor|scientific officer|technician position|graduate student opportunit(?:y|ies)|r\.?a\.? position)\b/i;
const EVENT_SUBJECT_PATTERN =
  /\b(?:conference|congress|fieldweek|work\s*shop|meeting|session announcement|webinar|symposium|seminar series|network event|registration deadline|abstract(?:s)? (?:submission )?(?:deadline|extension|process)|call for papers?|call for nominations|seminar announcement|summer school|technical training course|first circular|1st circular|second circular|2nd circular)\b/i;
const COMMERCIAL_SUBJECT_PATTERN =
  /\b(?:for sale|instrument sale|used (?:equipment|instrument)|equipment wanted|instrument wanted|looking for (?:a )?used|request for quotation|special offer)\b/i;
const LIST_ADMIN_SUBJECT_PATTERN =
  /\b(?:unsubscribe|subscription settings|remove .{0,80} distribution(?:s)? list|mailing list administration|listserv administration|daily digest|out of (?:the )?office|automatic reply|auto[- ]reply|e-mail addresses)\b/i;

const TECHNICAL_PATTERN =
  /\b(?:irms|mass spectrom(?:eter|etry)|isotope|isotopic|chromatograph|elemental analy[sz]er|sample|standard|reference gas|calibrat|normaliz|blank correction|linearity|peak|baseline|reactor|combustion|pyrolysis|capillar|column|autosampler|collector|faraday|filament|vacuum|pump|helium|carrier gas|flow rate|leak|fault|error|signal|voltage|pressure|temperature|software|firmware|method|protocol|measurement|precision|accuracy|reproducib|repair|replace|troubleshoot|gasket|gas\s*bench|delta\s+(?:xl|v|plus|xp|s)|duo\s*\d|tcea|conflo|isoprime|mat\s*25[123]|brf5|oxygen|nitrogen|carbon|sulfur|hydrogen)\b/gi;
const QUANTITATIVE_PATTERN =
  /(?:\b\d+(?:\.\d+)?\s*(?:ppm|ppb|ppt|mbar|bar|psi|kpa|pa|ml\/min|l\/min|sccm|mv|kv|v|ma|a|hz|khz|mhz|°c|deg(?:rees)?\s*c|µm|um|mm|cm)\b|\bm\/z\s*\d+|(?:δ|d)\s*\d{1,2}[A-Za-z]{1,2}\b)/gi;
const TECHNICAL_QUESTION_PATTERN =
  /\b(?:how (?:do|can|should)|has anyone|does anyone|any advice|help needed|problem with|issue with|not working|failed|failure|unstable|drift|noise|contamination|carryover|maintenance)\b/i;

const STRICT_BOILERPLATE_LINE_PATTERN =
  /(?:to unsubscribe|you received this message because|intended recipient|intended exclusively for (?:its|the) adressee|confidentiality notice|privileged and confidential|may contain information that is confidential|protected by professional privilege|dissemination,? copy or disclosure|received in error,? please (?:immediately )?notify|scan(?:ned)? for viruses|virus[- ]free|privacy policy|view this message in your browser|manage (?:your )?subscription|mailing list footer|message archive|sent from my (?:iphone|android|mobile)|notice: this email and any attachments are confidential|do not copy or disclose the contents|opinions expressed in this message|email disclaimer:|before printing this email)/i;
const CONTACT_LINE_PATTERN =
  /(?:\[email redacted\]|\b(?:tel|telephone|phone|mobile|fax)\s*[:.]?\s*(?:\+?\d[\d ().-]{6,})|https?:\/\/|www\.)/i;
const ORGANIZATION_LINE_PATTERN =
  /\b(?:university|universität|universite|université|college|faculty|department|institute|institut|laboratory|laboratoire|lab\b|school of|centre for|center for|research council|museum|academy)\b/i;
const ADDRESS_LINE_PATTERN =
  /\b(?:p\.?\s*o\.?\s*box|post(?:al)? code|street|st\.|road|rd\.|avenue|ave\.|boulevard|blvd|drive|campus|building|room|postcode|zip code)\b/i;
const TITLE_LINE_PATTERN =
  /\b(?:professor|director|manager|technician|researcher|scientist|engineer|lecturer|coordinator|administrator|chair)\b/i;
const VALEDICTION_PATTERN =
  /^(?:best(?: wishes| regards)?|kind regards|regards|cheers|sincerely|many thanks|thanks),?\s*$/i;
const SOCIAL_BODY_PATTERN =
  /^(?:hi|hello|dear all|thanks|thank you|many thanks|congratulations|interesting|agreed|sounds good|sorry|best wishes)[\s,!.\-]*(?:everyone|all|folks|colleagues)?[\s,!.\-]*$/i;
const ADMINISTRATIVE_BODY_PATTERN =
  /^(?:please )?(?:remove|unsubscribe) .{0,160}(?:list|distribution|subscription)|^(?:test|testing)(?: message)?[.!]*$/i;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeNewlines(value) {
  return value.replace(/\r\n?/g, '\n');
}

function normalizeWhitespace(value) {
  return normalizeNewlines(value)
    .normalize('NFC')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function normalizeSubject(subject) {
  let normalized = subject.normalize('NFC').trim();
  while (/^(?:re|fw|fwd)\s*:/i.test(normalized)) {
    normalized = normalized.replace(/^(?:re|fw|fwd)\s*:\s*/i, '');
  }
  return normalized.replace(/\s+/g, ' ').trim();
}

function maskPersonalData(value) {
  return value
    .replace(EMAIL_PATTERN, '[email redacted]')
    .replace(PHONE_PATTERN, '[phone redacted]');
}

function findQuoteBoundary(body) {
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

function splitSignature(body) {
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

function lineStartsFor(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function lineAtOffset(starts, offset) {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (starts[middle] <= offset) low = middle + 1;
    else high = middle;
  }
  return Math.max(1, low);
}

export function parseMergedConversation(content) {
  const matches = Array.from(content.matchAll(MESSAGE_HEADER));
  const lineStarts = lineStartsFor(content);

  return matches.map((match, sourceOrdinal) => {
    const headerStart = match.index ?? 0;
    const headerEnd = headerStart + match[0].length;
    const recordEnd = matches[sourceOrdinal + 1]?.index ?? content.length;
    const bodySegment = content.slice(headerEnd, recordEnd);
    const leadingBodyWhitespace = bodySegment.match(/^(?:\r?\n)+/)?.[0] ?? '';
    const bodyRaw = bodySegment
      .slice(leadingBodyWhitespace.length)
      .replace(TRAILING_SEPARATOR, '')
      .trim();
    const subjectRaw = match[1]?.trim() ?? '';
    const authorRaw = match[2]?.trim() ?? '';
    const dateRaw = match[3]?.trim() ?? '';
    const normalizedBody = normalizeWhitespace(bodyRaw);
    const quoteBoundary = findQuoteBoundary(normalizedBody);
    const unquoted =
      quoteBoundary >= 0 ? normalizedBody.slice(0, quoteBoundary).trim() : normalizedBody;
    const quotedHistory =
      quoteBoundary >= 0 ? normalizedBody.slice(quoteBoundary).trim() : '';
    const { content: bodyNew, signature } = splitSignature(unquoted);
    const cleanText = normalizeWhitespace(maskPersonalData(bodyNew));
    const subjectNormalized = normalizeSubject(subjectRaw);
    const stableId = sha256(`${subjectNormalized}\n${authorRaw}\n${dateRaw}\n${bodyRaw}`);
    const threadKey = sha256(subjectNormalized.toLowerCase() || stableId);

    return {
      sourceOrdinal,
      stableId,
      threadKey,
      subjectRaw,
      subjectNormalized,
      authorRaw,
      dateRaw,
      bodyRaw,
      cleanText,
      quotedHistory,
      signatureText: signature,
      startLine: lineAtOffset(lineStarts, headerStart),
      endLine: lineAtOffset(lineStarts, Math.max(headerStart, recordEnd - 1)),
    };
  });
}

function matchCount(value, pattern) {
  pattern.lastIndex = 0;
  const count = value.match(pattern)?.length ?? 0;
  pattern.lastIndex = 0;
  return count;
}

export function technicalSignals(subject, body) {
  const text = `${subject}\n${body}`;
  const technicalTerms = matchCount(text, TECHNICAL_PATTERN);
  const quantitativeTerms = matchCount(text, QUANTITATIVE_PATTERN);
  const technicalQuestion = TECHNICAL_QUESTION_PATTERN.test(text);
  const strong = technicalTerms >= 2 || quantitativeTerms >= 1 || technicalQuestion;
  return {
    strong,
    technicalTerms,
    quantitativeTerms,
    technicalQuestion,
  };
}

export function subjectGenre(subject) {
  if (JOB_SUBJECT_PATTERN.test(subject)) return 'job_posting';
  if (EVENT_SUBJECT_PATTERN.test(subject)) return 'event_announcement';
  if (COMMERCIAL_SUBJECT_PATTERN.test(subject)) return 'commercial_posting';
  if (LIST_ADMIN_SUBJECT_PATTERN.test(subject)) return 'list_administration';
  return null;
}

function blockSignatureEvidence(block) {
  const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
  const contact = lines.filter((line) => CONTACT_LINE_PATTERN.test(line)).length;
  const organization = lines.filter((line) => ORGANIZATION_LINE_PATTERN.test(line)).length;
  const address = lines.filter((line) => ADDRESS_LINE_PATTERN.test(line)).length;
  const title = lines.filter((line) => TITLE_LINE_PATTERN.test(line)).length;
  const valediction = lines.filter((line) => VALEDICTION_PATTERN.test(line)).length;
  return {
    lines: lines.length,
    contact,
    organization,
    address,
    title,
    valediction,
    total: contact + organization + address + title + valediction,
  };
}

export function cleanMessageBody(body) {
  const reasons = new Set();
  const excluded = [];
  const sourceLines = normalizeNewlines(body).split('\n');
  const retainedLines = [];

  for (let index = 0; index < sourceLines.length; index += 1) {
    const line = sourceLines[index];
    if (STRICT_BOILERPLATE_LINE_PATTERN.test(line)) {
      excluded.push({ kind: 'boilerplate_line', line: index + 1, characters: line.length });
      reasons.add('boilerplate_removed');
      continue;
    }
    retainedLines.push(line);
  }

  let cleaned = normalizeWhitespace(retainedLines.join('\n'));
  const signatureCandidates = Array.from(
    cleaned.matchAll(
      /^(?:\s*--\s*|\s*(?:best(?: wishes| regards)?|kind regards|regards|cheers|sincerely|many thanks|thanks),?\s*)$/gim,
    ),
  )
    .map((match) => match.index ?? -1)
    .filter((index) => index >= Math.floor(cleaned.length * 0.35));
  if (signatureCandidates.length) {
    const boundary = Math.min(...signatureCandidates);
    const tail = cleaned.slice(boundary);
    const evidence = blockSignatureEvidence(tail);
    const tailShare = tail.length / Math.max(1, cleaned.length);
    const removable =
      tail.length <= 5_000 &&
      (evidence.total >= 2 ||
        (tail.length <= 240 && tailShare <= 0.25));
    if (removable) {
      excluded.push({
        kind: 'extended_signature_block',
        characters: tail.length,
        evidence,
      });
      reasons.add('institutional_signature_removed');
      cleaned = normalizeWhitespace(cleaned.slice(0, boundary));
    }
  }

  for (let attempt = 0; attempt < 3 && cleaned; attempt += 1) {
    const blocks = cleaned.split(/\n{2,}/);
    if (blocks.length < 2) break;
    const tail = blocks.at(-1) ?? '';
    const evidence = blockSignatureEvidence(tail);
    const tailTechnical = technicalSignals('', tail).strong;
    const tailShare = tail.length / Math.max(1, cleaned.length);
    const signatureLike =
      evidence.contact >= 1 &&
      evidence.total >= 2 &&
      evidence.lines <= 12 &&
      tail.length <= 1_200 &&
      (tailShare <= 0.4 || (evidence.contact >= 2 && evidence.total >= 4));

    if (!signatureLike || tailTechnical) break;
    excluded.push({
      kind: 'institutional_signature_block',
      characters: tail.length,
      evidence,
    });
    reasons.add('institutional_signature_removed');
    blocks.pop();
    cleaned = normalizeWhitespace(blocks.join('\n\n'));
  }

  return {
    text: cleaned,
    reasons: [...reasons],
    excluded,
    excludedCharacters: excluded.reduce((sum, item) => sum + item.characters, 0),
  };
}

export function classifyMessage(message, cleanedBody, threadHasTechnical) {
  const reasons = [];
  const genre = subjectGenre(message.subjectNormalized);
  const signals = technicalSignals(message.subjectNormalized, cleanedBody);

  if (genre) {
    reasons.push(genre);
    return {
      lane: 'quarantine',
      searchable: false,
      reasons,
      signals,
      threadHasTechnical,
    };
  }

  const compactBody = cleanedBody.replace(/\s+/g, ' ').trim();
  const administrative =
    ADMINISTRATIVE_BODY_PATTERN.test(compactBody) ||
    (compactBody.length <= 280 && SOCIAL_BODY_PATTERN.test(compactBody));

  if (!cleanedBody) {
    reasons.push('empty_after_cleanup');
    return {
      lane: 'quarantine',
      searchable: false,
      reasons,
      signals,
      threadHasTechnical,
    };
  }

  if (administrative && !signals.strong && !threadHasTechnical) {
    reasons.push('nontechnical_conversation');
    return {
      lane: 'quarantine',
      searchable: false,
      reasons,
      signals,
      threadHasTechnical,
    };
  }

  if (signals.strong) reasons.push('technical_signal');
  else if (threadHasTechnical) reasons.push('technical_thread_context');
  else reasons.push('ambiguous_retained_for_recall');

  return {
    lane: signals.strong || threadHasTechnical ? 'searchable' : 'review',
    searchable: true,
    reasons,
    signals,
    threadHasTechnical,
  };
}

export function serializeRecord(message, cleanedBody) {
  return [
    `Subject:${message.subjectRaw}`,
    `Author:${message.authorRaw}`,
    `Date:${message.dateRaw}`,
    RECORD_SEPARATOR,
    cleanedBody,
    RECORD_SEPARATOR,
  ].join('\n');
}

function parseArguments(argv) {
  const options = {
    input: 'Raw ISOGEOCHEM data',
    output: 'Merged_text_files',
    audit: 'cleanup_audit',
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--input') options.input = argv[++index];
    else if (argument === '--output') options.output = argv[++index];
    else if (argument === '--audit') options.audit = argv[++index];
    else if (argument === '--dry-run') options.dryRun = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

async function pathExists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function safelyRemoveTemporary(target, expectedParent, expectedPrefix) {
  const resolved = path.resolve(target);
  const parent = path.dirname(resolved);
  if (parent !== path.resolve(expectedParent) || !path.basename(resolved).startsWith(expectedPrefix)) {
    throw new Error(`Refusing to remove unexpected temporary path: ${resolved}`);
  }
  await rm(resolved, { recursive: true, force: true });
}

export async function runCleanup({
  repositoryRoot,
  input,
  output,
  audit,
  dryRun = false,
}) {
  const inputDirectory = path.resolve(repositoryRoot, input);
  const outputDirectory = path.resolve(repositoryRoot, output);
  const auditDirectory = path.resolve(repositoryRoot, audit);
  const temporaryOutput = path.join(
    path.dirname(outputDirectory),
    `.${path.basename(outputDirectory)}.cleaning-${process.pid}`,
  );
  const temporaryAudit = path.join(
    path.dirname(auditDirectory),
    `.${path.basename(auditDirectory)}.cleaning-${process.pid}`,
  );

  if (!(await pathExists(inputDirectory))) {
    throw new Error(`Input directory does not exist: ${inputDirectory}`);
  }
  if (!dryRun && (await pathExists(outputDirectory))) {
    throw new Error(`Output directory already exists: ${outputDirectory}`);
  }
  if (!dryRun && (await pathExists(auditDirectory))) {
    throw new Error(`Audit directory already exists: ${auditDirectory}`);
  }

  const entries = await readdir(inputDirectory, { withFileTypes: true });
  const fileNames = entries
    .filter((entry) => entry.isFile() && /\.txt$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  if (!fileNames.length) throw new Error(`No .txt files found in ${inputDirectory}`);

  const threadTechnical = new Map();
  for (let index = 0; index < fileNames.length; index += 1) {
    const fileName = fileNames[index];
    const content = await readFile(path.join(inputDirectory, fileName), 'utf8');
    for (const message of parseMergedConversation(content)) {
      const cleaned = cleanMessageBody(message.cleanText);
      const signals = technicalSignals(message.subjectNormalized, cleaned.text);
      if (signals.strong) threadTechnical.set(message.threadKey, true);
      else if (!threadTechnical.has(message.threadKey)) threadTechnical.set(message.threadKey, false);
    }
    if ((index + 1) % 100 === 0 || index + 1 === fileNames.length) {
      process.stderr.write(`Signal pass ${index + 1}/${fileNames.length}\n`);
    }
  }

  if (!dryRun) {
    await mkdir(temporaryOutput, { recursive: false });
    await mkdir(temporaryAudit, { recursive: false });
  }

  const summary = {
    cleanupVersion: CLEANUP_VERSION,
    generatedAt: new Date().toISOString(),
    inputDirectory: path.basename(inputDirectory),
    outputDirectory: path.basename(outputDirectory),
    files: {
      input: fileNames.length,
      output: 0,
      emptyAfterCleanup: 0,
    },
    messages: {
      input: 0,
      searchable: 0,
      review: 0,
      quarantined: 0,
    },
    characters: {
      rawBody: 0,
      parserCleaned: 0,
      searchableOutput: 0,
      quarantinedParserCleaned: 0,
      additionalBoilerplateRemoved: 0,
    },
    quarantineReasons: {},
    retentionReasons: {},
    fileManifest: [],
  };

  let decisionsHandle = null;
  if (!dryRun) {
    decisionsHandle = await open(path.join(temporaryAudit, 'decisions.jsonl'), 'w');
  }

  try {
    for (let fileIndex = 0; fileIndex < fileNames.length; fileIndex += 1) {
      const fileName = fileNames[fileIndex];
      const inputPath = path.join(inputDirectory, fileName);
      const content = await readFile(inputPath, 'utf8');
      const sourceStat = await stat(inputPath);
      const sourceSha256 = sha256(content);
      const messages = parseMergedConversation(content);
      const retainedRecords = [];
      let fileQuarantined = 0;
      let fileReview = 0;

      for (const message of messages) {
        const bodyCleanup = cleanMessageBody(message.cleanText);
        const classification = classifyMessage(
          message,
          bodyCleanup.text,
          threadTechnical.get(message.threadKey) ?? false,
        );

        summary.messages.input += 1;
        summary.characters.rawBody += message.bodyRaw.length;
        summary.characters.parserCleaned += message.cleanText.length;
        summary.characters.additionalBoilerplateRemoved += bodyCleanup.excludedCharacters;

        if (classification.searchable) {
          retainedRecords.push(serializeRecord(message, bodyCleanup.text));
          summary.characters.searchableOutput += bodyCleanup.text.length;
          if (classification.lane === 'review') {
            summary.messages.review += 1;
            fileReview += 1;
          } else {
            summary.messages.searchable += 1;
          }
          for (const reason of classification.reasons) {
            summary.retentionReasons[reason] = (summary.retentionReasons[reason] ?? 0) + 1;
          }
        } else {
          summary.messages.quarantined += 1;
          summary.characters.quarantinedParserCleaned += message.cleanText.length;
          fileQuarantined += 1;
          for (const reason of classification.reasons) {
            summary.quarantineReasons[reason] = (summary.quarantineReasons[reason] ?? 0) + 1;
          }
        }

        if (decisionsHandle) {
          await decisionsHandle.write(
            `${JSON.stringify({
              cleanupVersion: CLEANUP_VERSION,
              sourceFile: fileName,
              sourceOrdinal: message.sourceOrdinal,
              sourceStartLine: message.startLine,
              sourceEndLine: message.endLine,
              stableId: message.stableId,
              threadKey: message.threadKey,
              subject: message.subjectNormalized,
              lane: classification.lane,
              searchable: classification.searchable,
              reasons: [...bodyCleanup.reasons, ...classification.reasons],
              signals: classification.signals,
              threadHasTechnical: classification.threadHasTechnical,
              parserCleanedCharacters: message.cleanText.length,
              outputCharacters: classification.searchable ? bodyCleanup.text.length : 0,
              excludedCharacters: bodyCleanup.excludedCharacters,
              excludedSpans: bodyCleanup.excluded,
            })}\n`,
          );
        }
      }

      const outputContent = retainedRecords.length ? `${retainedRecords.join('\n')}\n` : '';
      let outputSha256 = null;
      if (outputContent) {
        summary.files.output += 1;
        outputSha256 = sha256(outputContent);
        if (!dryRun) {
          await writeFile(path.join(temporaryOutput, fileName), outputContent, 'utf8');
        }
      } else {
        summary.files.emptyAfterCleanup += 1;
      }

      summary.fileManifest.push({
        fileName,
        sourceBytes: sourceStat.size,
        sourceSha256,
        parsedMessages: messages.length,
        retainedMessages: retainedRecords.length,
        quarantinedMessages: fileQuarantined,
        reviewMessages: fileReview,
        outputBytes: Buffer.byteLength(outputContent),
        outputSha256,
      });

      if ((fileIndex + 1) % 50 === 0 || fileIndex + 1 === fileNames.length) {
        process.stderr.write(`Cleanup pass ${fileIndex + 1}/${fileNames.length}\n`);
      }
    }

    if (decisionsHandle) {
      await decisionsHandle.close();
      decisionsHandle = null;
    }

    summary.rates = {
      messageQuarantine:
        summary.messages.input > 0
          ? summary.messages.quarantined / summary.messages.input
          : 0,
      parserCharacterRetention:
        summary.characters.rawBody > 0
          ? summary.characters.parserCleaned / summary.characters.rawBody
          : 0,
      finalCharacterRetention:
        summary.characters.rawBody > 0
          ? summary.characters.searchableOutput / summary.characters.rawBody
          : 0,
      postParserCharacterRetention:
        summary.characters.parserCleaned > 0
          ? summary.characters.searchableOutput / summary.characters.parserCleaned
          : 0,
    };

    if (!dryRun) {
      await writeFile(
        path.join(temporaryAudit, 'manifest.json'),
        `${JSON.stringify(summary, null, 2)}\n`,
        'utf8',
      );
      await rename(temporaryOutput, outputDirectory);
      await rename(temporaryAudit, auditDirectory);
    }

    return summary;
  } catch (error) {
    if (decisionsHandle) await decisionsHandle.close();
    if (!dryRun) {
      await safelyRemoveTemporary(
        temporaryOutput,
        path.dirname(outputDirectory),
        `.${path.basename(outputDirectory)}.cleaning-`,
      );
      await safelyRemoveTemporary(
        temporaryAudit,
        path.dirname(auditDirectory),
        `.${path.basename(auditDirectory)}.cleaning-`,
      );
    }
    throw error;
  }
}

async function main() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(scriptDirectory, '..');
  const options = parseArguments(process.argv.slice(2));
  const summary = await runCleanup({ repositoryRoot, ...options });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
}
