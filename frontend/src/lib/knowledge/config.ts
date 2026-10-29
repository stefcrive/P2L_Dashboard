import fs from 'node:fs';
import path from 'node:path';

import type { KnowledgeConfig } from './types';

function findRepositoryRoot() {
  const candidates = [process.cwd(), path.resolve(process.cwd(), '..')];
  return (
    candidates.find(
      (candidate) =>
        fs.existsSync(path.join(candidate, 'Raw ISOGEOCHEM data')) &&
        fs.existsSync(path.join(candidate, 'frontend'))
    ) ?? process.cwd()
  );
}

function resolveFromRepository(repositoryRoot: string, value: string) {
  return path.isAbsolute(value) ? value : path.resolve(repositoryRoot, value);
}

function readEnvironmentFile(filePath: string, name: string) {
  if (!fs.existsSync(filePath)) return undefined;
  const contents = fs.readFileSync(filePath, 'utf8');
  const match = contents.match(
    new RegExp(`^\\uFEFF?${name}\\s*=\\s*(.*)$`, 'm')
  );
  if (!match) return undefined;
  let value = match[1].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  } else {
    value = value.replace(/\s+#.*$/, '').trim();
  }
  return value || undefined;
}

export function getWorkspaceEnvironmentValue(name: string) {
  if (process.env[name]?.trim()) return process.env[name]!.trim();
  const repositoryRoot = findRepositoryRoot();
  const candidates = [
    path.join(repositoryRoot, 'frontend', '.env.local'),
    path.join(repositoryRoot, '.env.local'),
    path.join(repositoryRoot, '.env'),
    path.join(repositoryRoot, 'frontend', '.env'),
  ];
  for (const candidate of candidates) {
    const value = readEnvironmentFile(candidate, name);
    if (value) return value;
  }
  return undefined;
}

let cachedConfig: KnowledgeConfig | null = null;

export function getKnowledgeConfig(): KnowledgeConfig {
  if (cachedConfig) return cachedConfig;

  const repositoryRoot = process.env.APP_DATABASE_MODE === 'neon' ? '/tmp/p2l-knowledge' : findRepositoryRoot();
  const databasePath = resolveFromRepository(
    repositoryRoot,
    getWorkspaceEnvironmentValue('KNOWLEDGE_DB_PATH') ?? (process.env.VERCEL ? '/tmp/p2l-knowledge' : '.local-data/knowledge-postgres'),
  );
  const defaultSourcePath = resolveFromRepository(
    repositoryRoot,
    getWorkspaceEnvironmentValue('KNOWLEDGE_SOURCE_PATH') ??
      'Raw ISOGEOCHEM data'
  );
  const embeddingDimensions = Number.parseInt(
    getWorkspaceEnvironmentValue('KNOWLEDGE_EMBEDDING_DIMENSIONS') ?? '1024',
    10
  );

  if (!Number.isInteger(embeddingDimensions) || embeddingDimensions < 256) {
    throw new Error(
      'KNOWLEDGE_EMBEDDING_DIMENSIONS must be an integer of at least 256.'
    );
  }

  fs.mkdirSync(databasePath, { recursive: true });

  cachedConfig = {
    repositoryRoot,
    databasePath,
    defaultSourcePath,
    embeddingModel:
      getWorkspaceEnvironmentValue('KNOWLEDGE_EMBEDDING_MODEL') ??
      'text-embedding-3-small',
    embeddingDimensions,
    enrichmentModel:
      getWorkspaceEnvironmentValue('KNOWLEDGE_ENRICHMENT_MODEL') ??
      'gpt-5.6-luna',
    answerModel:
      getWorkspaceEnvironmentValue('KNOWLEDGE_ANSWER_MODEL') ?? 'gpt-5.6-terra',
  };

  return cachedConfig;
}

export function assertPathInsideRepository(inputPath: string) {
  const config = getKnowledgeConfig();
  const resolved = fs.realpathSync(path.resolve(inputPath));
  const repositoryRoot = fs.realpathSync(config.repositoryRoot);
  const relative = path.relative(repositoryRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Knowledge sources must be inside the project workspace.');
  }
  return resolved;
}
