import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const casesPath = path.join(
  repositoryRoot,
  'docs',
  'knowledge-retrieval-evals.json'
);
const baseUrl = (
  process.env.KNOWLEDGE_EVAL_BASE_URL ?? 'http://localhost:3000'
).replace(/\/$/, '');
const definition = JSON.parse(await fs.readFile(casesPath, 'utf8'));
const results = [];

for (const testCase of definition.cases) {
  for (const query of testCase.queries) {
    const url = new URL('/api/knowledge/search', baseUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('mode', 'hybrid');
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `${testCase.id}: search returned ${response.status} ${await response.text()}`
      );
    }
    const payload = await response.json();
    const expectedTerms = testCase.expectedContentTerms.map((term) =>
      term.toLocaleLowerCase()
    );
    const position = payload.evidence.findIndex((item) => {
      const content = String(item.content).toLocaleLowerCase();
      return expectedTerms.every((term) => content.includes(term));
    });
    const rank = position < 0 ? null : position + 1;
    results.push({
      case: testCase.id,
      query,
      rank,
      maximumRank: testCase.maximumRank,
      passed: rank !== null && rank <= testCase.maximumRank,
    });
  }
}

console.table(results);
const failures = results.filter((result) => !result.passed);
if (failures.length) {
  console.error(
    `Knowledge retrieval evaluation failed: ${failures.length}/${results.length} query variants missed their expected passage.`
  );
  process.exitCode = 1;
} else {
  console.log(
    `Knowledge retrieval evaluation passed: ${results.length}/${results.length} query variants.`
  );
}
