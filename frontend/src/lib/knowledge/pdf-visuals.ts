import 'server-only';

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { getKnowledgeConfig, getWorkspaceEnvironmentValue } from './config';
import { describeKnowledgeVisual } from './openai';
import type { ParsedVisualAsset } from './types';

const execFileAsync = promisify(execFile);

interface DoclingAsset {
  stableId: string;
  pageNumber: number;
  kind: 'figure' | 'table';
  caption: string;
  structuredText: string;
  file: string;
  mimeType: string;
  sha256: string;
  width: number;
  height: number;
  bbox: Record<string, unknown>;
  pageSurfaceRatio: number;
}

interface DoclingManifest {
  schemaVersion: number;
  sourceSha256: string;
  parser: string;
  doclingVersion: string;
  markdownFile: string;
  visualsTruncated: boolean;
  assets: DoclingAsset[];
}

function positiveInteger(name: string, fallback: number) {
  const value = Number.parseInt(getWorkspaceEnvironmentValue(name) ?? '', 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

async function firstExistingPath(candidates: Array<string | undefined>) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next configured interpreter.
    }
  }
  return null;
}

function descriptionMarkdown(params: {
  caption: string;
  title: string;
  summary: string;
  transcription: string;
  keyDetails: string[];
}) {
  return [
    params.title ? `### ${params.title}` : '',
    params.caption ? `Caption: ${params.caption}` : '',
    params.summary,
    params.transcription ? `Visible text: ${params.transcription}` : '',
    params.keyDetails.length
      ? `Key visual details:\n${params.keyDetails.map((item) => `- ${item}`).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

export async function extractPdfVisualKnowledge(params: {
  sourcePath: string;
  sourceName: string;
  rawBuffer: Buffer;
  describeVisuals: boolean;
}): Promise<{
  markdown: string;
  assets: ParsedVisualAsset[];
  parserVersion: string;
  warnings: string[];
} | null> {
  const mode = (
    getWorkspaceEnvironmentValue('KNOWLEDGE_PDF_VISUAL_MODE') ?? 'docling'
  ).toLowerCase();
  if (mode === 'off' || mode === 'disabled') return null;

  const config = getKnowledgeConfig();
  const sourceSha = createHash('sha256').update(params.rawBuffer).digest('hex');
  const outputDirectory = path.join(
    config.repositoryRoot,
    '.local-data',
    'knowledge-assets',
    sourceSha
  );
  const scriptPath = path.join(
    config.repositoryRoot,
    'scripts',
    'extract-pdf-visuals.py'
  );
  const configuredPython = getWorkspaceEnvironmentValue(
    'KNOWLEDGE_DOCLING_PYTHON'
  );
  const pythonPath = await firstExistingPath([
    configuredPython
      ? path.isAbsolute(configuredPython)
        ? configuredPython
        : path.resolve(config.repositoryRoot, configuredPython)
      : undefined,
    path.join(
      config.repositoryRoot,
      '.local-data',
      'docling-venv',
      'Scripts',
      'python.exe'
    ),
  ]);
  if (!pythonPath) return null;

  await fs.mkdir(outputDirectory, { recursive: true });
  const timeoutSeconds = positiveInteger(
    'KNOWLEDGE_DOCLING_TIMEOUT_SECONDS',
    1_800
  );
  try {
    await execFileAsync(
      pythonPath,
      [
        scriptPath,
        '--input',
        params.sourcePath,
        '--output-dir',
        outputDirectory,
        '--max-visuals',
        String(positiveInteger('KNOWLEDGE_MAX_VISUALS_PER_PDF', 120)),
        '--timeout-seconds',
        String(timeoutSeconds),
      ],
      {
        cwd: config.repositoryRoot,
        timeout: (timeoutSeconds + 60) * 1_000,
        maxBuffer: 2 * 1_048_576,
        windowsHide: true,
      }
    );
  } catch {
    return null;
  }

  const manifest = JSON.parse(
    await fs.readFile(path.join(outputDirectory, 'manifest.json'), 'utf8')
  ) as DoclingManifest;
  const markdown = await fs.readFile(
    path.join(outputDirectory, manifest.markdownFile),
    'utf8'
  );
  const visionBudget = params.describeVisuals
    ? positiveInteger('KNOWLEDGE_MAX_VISION_DESCRIPTIONS_PER_PDF', 80)
    : 0;
  let described = 0;
  const warnings: string[] = manifest.visualsTruncated
    ? ['visual_asset_limit_reached']
    : [];
  const assets: ParsedVisualAsset[] = [];

  for (const asset of manifest.assets) {
    const imagePath = path.join(outputDirectory, asset.file);
    let kind: ParsedVisualAsset['kind'] = asset.kind;
    let description = asset.structuredText || asset.caption;
    let altText = asset.caption || `${asset.kind} on page ${asset.pageNumber}`;
    let extractionModel = asset.kind === 'table' ? 'docling-table' : 'docling';
    let promptVersion = asset.kind === 'table' ? 'docling_table_v1' : '';
    let confidence: number | null = asset.kind === 'table' ? 1 : null;
    let visualMetadata: Record<string, unknown> = {
      pageSurfaceRatio: asset.pageSurfaceRatio,
      structuredText: asset.structuredText,
    };

    if (asset.kind === 'figure' && described < visionBudget) {
      const cachePath = path.join(outputDirectory, `${asset.sha256}.vision.json`);
      try {
        let visual;
        try {
          visual = JSON.parse(await fs.readFile(cachePath, 'utf8')) as Awaited<
            ReturnType<typeof describeKnowledgeVisual>
          >;
        } catch {
          visual = await describeKnowledgeVisual({
            buffer: await fs.readFile(imagePath),
            mimeType: asset.mimeType,
            sourceName: params.sourceName,
            pageNumber: asset.pageNumber,
            caption: asset.caption,
          });
          await fs.writeFile(cachePath, JSON.stringify(visual, null, 2), 'utf8');
        }
        described += 1;
        kind = visual.kind;
        description = descriptionMarkdown({
          caption: asset.caption,
          title: visual.title,
          summary: visual.summary,
          transcription: visual.transcription,
          keyDetails: visual.keyDetails,
        });
        altText = visual.summary || visual.title || altText;
        extractionModel = visual.extractionModel;
        promptVersion = visual.promptVersion;
        confidence = visual.confidence;
        visualMetadata = { ...visualMetadata, ...visual };
      } catch (error) {
        warnings.push(`visual_description_failed:${asset.stableId}`);
        visualMetadata = {
          ...visualMetadata,
          descriptionError:
            error instanceof Error ? error.message.slice(0, 500) : 'unknown',
        };
      }
    }

    assets.push({
      stableId: asset.stableId,
      pageNumber: asset.pageNumber,
      kind,
      caption: asset.caption,
      description: description || altText,
      altText,
      storagePath: path
        .relative(config.repositoryRoot, imagePath)
        .split(path.sep)
        .join('/'),
      mimeType: asset.mimeType,
      sha256: asset.sha256,
      width: asset.width,
      height: asset.height,
      bbox: asset.bbox,
      extractionModel,
      promptVersion,
      confidence,
      metadata: visualMetadata,
    });
  }

  return {
    markdown,
    assets,
    parserVersion: `docling_${manifest.doclingVersion}_visual_v1`,
    warnings,
  };
}
