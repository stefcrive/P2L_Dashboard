import { promises as fs } from 'node:fs';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const decisionsPath = path.join(repositoryRoot, 'cleanup_audit', 'decisions.jsonl');
const outputDirectory = path.join(repositoryRoot, '.local-data', 'knowledge-pilots');
const outputPath = path.join(outputDirectory, 'isogeochem_raw_pilot_20.txt');
const manifestPath = path.join(outputDirectory, 'isogeochem_raw_pilot_20.json');

const decisions = (await fs.readFile(decisionsPath, 'utf8'))
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter(
    (item) =>
      item.lane === 'searchable' &&
      item.signals?.strong === true &&
      Number(item.parserCleanedCharacters ?? 0) >= 150
  )
  .slice(0, 20);

if (decisions.length !== 20) {
  throw new Error(`Expected 20 strong technical messages, found ${decisions.length}.`);
}

const rawFiles = new Map();
const records = [];
for (const decision of decisions) {
  if (!rawFiles.has(decision.sourceFile)) {
    const contents = await fs.readFile(
      path.join(
        repositoryRoot,
        'Raw ISOGEOCHEM data backup',
        decision.sourceFile
      ),
      'utf8'
    );
    rawFiles.set(decision.sourceFile, contents.split(/\r?\n/));
  }
  const lines = rawFiles.get(decision.sourceFile);
  records.push(
    lines
      .slice(Number(decision.sourceStartLine) - 1, Number(decision.sourceEndLine))
      .join('\n')
      .trimEnd()
  );
}

await fs.mkdir(outputDirectory, { recursive: true });
await fs.writeFile(outputPath, `${records.join('\n\n')}\n`, 'utf8');
await fs.writeFile(
  manifestPath,
  `${JSON.stringify(
    {
      name: 'Isogeochem knowledge engine pilot',
      source: 'Raw ISOGEOCHEM data backup',
      messages: decisions.map((item) => ({
        sourceFile: item.sourceFile,
        sourceOrdinal: item.sourceOrdinal,
        stableId: item.stableId,
        subject: item.subject,
      })),
    },
    null,
    2
  )}\n`,
  'utf8'
);

console.log(
  JSON.stringify({ outputPath, manifestPath, messages: decisions.length })
);
