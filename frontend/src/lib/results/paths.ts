import 'server-only';

import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';

async function canReadDirectory(directoryPath: string) {
  try {
    await access(directoryPath, constants.R_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveResultsRootPath() {
  const configured = process.env.RESULTS_FOLDER_PATH?.trim();
  const relativeCandidates = (value: string) => [
    path.resolve(process.cwd(), value),
    path.resolve(process.cwd(), '..', value),
    path.resolve(process.cwd(), 'frontend', value),
  ];
  const candidates = configured
    ? path.isAbsolute(configured)
      ? [configured]
      : relativeCandidates(configured)
    : relativeCandidates('Results');
  for (const candidate of candidates) {
    if (await canReadDirectory(candidate)) return candidate;
  }
  return candidates[0];
}

