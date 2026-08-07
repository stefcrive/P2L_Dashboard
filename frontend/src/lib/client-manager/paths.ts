import 'server-only';

import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';

async function canReadDirectory(directoryPath: string): Promise<boolean> {
  try {
    await access(directoryPath, constants.R_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveRelativeCandidates(relativePath: string): string[] {
  return [
    path.resolve(process.cwd(), relativePath),
    path.resolve(process.cwd(), '..', relativePath),
    path.resolve(process.cwd(), 'frontend', relativePath),
  ];
}

export async function resolveClientiRootPath(): Promise<string> {
  const envPath = process.env.CLIENTI_FOLDER_PATH?.trim();
  const candidates: string[] = [];
  const seen = new Set<string>();

  const pushCandidate = (candidatePath: string) => {
    if (!seen.has(candidatePath)) {
      seen.add(candidatePath);
      candidates.push(candidatePath);
    }
  };

  if (envPath) {
    if (path.isAbsolute(envPath)) {
      pushCandidate(envPath);
    } else {
      resolveRelativeCandidates(envPath).forEach(pushCandidate);
    }
  }

  resolveRelativeCandidates('Clienti').forEach(pushCandidate);

  for (const candidate of candidates) {
    if (await canReadDirectory(candidate)) {
      return candidate;
    }
  }

  return candidates[0] ?? resolveRelativeCandidates('Clienti')[0];
}

export async function clientiPathExists(directoryPath: string): Promise<boolean> {
  return canReadDirectory(directoryPath);
}
