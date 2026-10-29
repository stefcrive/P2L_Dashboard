import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CLEANUP_VERSION,
  parseMergedConversation,
  subjectGenre,
} from './clean-isogeochem-corpus.mjs';

const STRICT_BOILERPLATE_PATTERN =
  /(?:to unsubscribe|you received this message because|intended recipient|intended exclusively for (?:its|the) adressee|confidentiality notice|privileged and confidential|may contain information that is confidential|protected by professional privilege|dissemination,? copy or disclosure|received in error,? please (?:immediately )?notify|scan(?:ned)? for viruses|virus[- ]free|view this message in your browser|manage (?:your )?subscription|notice: this email and any attachments are confidential|do not copy or disclose the contents|opinions expressed in this message)/i;

async function fileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const repositoryRoot = path.resolve(scriptDirectory, '..');
  const rawDirectory = path.join(repositoryRoot, 'Raw ISOGEOCHEM data backup');
  const cleanDirectory = path.join(repositoryRoot, 'Raw ISOGEOCHEM data');
  const auditDirectory = path.join(repositoryRoot, 'cleanup_audit');
  const manifest = JSON.parse(
    await readFile(path.join(auditDirectory, 'manifest.json'), 'utf8'),
  );

  invariant(
    manifest.cleanupVersion === CLEANUP_VERSION,
    `Unexpected cleanup version: ${manifest.cleanupVersion}`,
  );

  const rawFiles = (await readdir(rawDirectory))
    .filter((name) => /\.txt$/i.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  const cleanFiles = (await readdir(cleanDirectory))
    .filter((name) => /\.txt$/i.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  invariant(rawFiles.length === manifest.files.input, 'Raw file count mismatch');
  invariant(cleanFiles.length === manifest.files.output, 'Clean file count mismatch');

  let parsedCleanMessages = 0;
  let residualBoilerplateMessages = 0;
  let residualQuarantinedGenres = 0;

  for (let index = 0; index < manifest.fileManifest.length; index += 1) {
    const entry = manifest.fileManifest[index];
    const rawPath = path.join(rawDirectory, entry.fileName);
    const cleanPath = path.join(cleanDirectory, entry.fileName);
    const rawHash = await fileSha256(rawPath);
    invariant(rawHash === entry.sourceSha256, `Raw hash mismatch: ${entry.fileName}`);

    if (entry.outputSha256) {
      const cleanHash = await fileSha256(cleanPath);
      invariant(cleanHash === entry.outputSha256, `Clean hash mismatch: ${entry.fileName}`);
      const cleanContent = await readFile(cleanPath, 'utf8');
      const messages = parseMergedConversation(cleanContent);
      invariant(
        messages.length === entry.retainedMessages,
        `Parsed output count mismatch: ${entry.fileName}`,
      );
      parsedCleanMessages += messages.length;
      for (const message of messages) {
        if (STRICT_BOILERPLATE_PATTERN.test(message.cleanText)) {
          residualBoilerplateMessages += 1;
        }
        if (subjectGenre(message.subjectNormalized)) {
          residualQuarantinedGenres += 1;
        }
      }
    }

    if ((index + 1) % 100 === 0 || index + 1 === manifest.fileManifest.length) {
      process.stderr.write(`Validated ${index + 1}/${manifest.fileManifest.length} files\n`);
    }
  }

  const decisions = (await readFile(path.join(auditDirectory, 'decisions.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const uniqueDecisions = new Set(
    decisions.map((row) => `${row.sourceFile}:${row.sourceOrdinal}`),
  );
  const searchableDecisions = decisions.filter((row) => row.searchable).length;
  const quarantinedDecisions = decisions.length - searchableDecisions;

  invariant(decisions.length === manifest.messages.input, 'Decision count mismatch');
  invariant(uniqueDecisions.size === decisions.length, 'Duplicate decision key detected');
  invariant(
    searchableDecisions === manifest.messages.searchable + manifest.messages.review,
    'Searchable decision count mismatch',
  );
  invariant(
    quarantinedDecisions === manifest.messages.quarantined,
    'Quarantine decision count mismatch',
  );
  invariant(
    parsedCleanMessages === searchableDecisions,
    'Clean corpus and audit decision counts differ',
  );
  invariant(
    residualQuarantinedGenres === 0,
    `${residualQuarantinedGenres} quarantined subject genres remain in cleaned output`,
  );

  const result = {
    cleanupVersion: manifest.cleanupVersion,
    rawFilesValidated: rawFiles.length,
    cleanFilesValidated: cleanFiles.length,
    rawHashesValidated: manifest.fileManifest.length,
    cleanHashesValidated: manifest.fileManifest.filter((entry) => entry.outputSha256).length,
    decisionsValidated: decisions.length,
    uniqueDecisionKeys: uniqueDecisions.size,
    parsedCleanMessages,
    quarantinedDecisions,
    residualQuarantinedGenres,
    residualBoilerplateMessages,
    status: residualBoilerplateMessages === 0 ? 'passed' : 'passed_with_residual_review',
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
