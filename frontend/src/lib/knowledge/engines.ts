import 'server-only';

import { getKnowledgeDatabase } from './db';

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 72);
}

export async function getKnowledgeEngines() {
  const database = await getKnowledgeDatabase();
  const [engines, sources] = await Promise.all([
    database.query<Record<string, unknown>>(
      `SELECT e.id::text, e.name, e.slug, e.description, e.enabled, e.system_key,
              count(es.source_id)::integer AS source_count,
              count(es.source_id) FILTER (WHERE es.enabled)::integer AS enabled_source_count,
              coalesce(sum(s.message_count), 0)::integer AS message_count,
              coalesce(sum(s.chunk_count), 0)::integer AS chunk_count
       FROM kb.engines e
       LEFT JOIN kb.engine_sources es ON es.engine_id = e.id
       LEFT JOIN kb.sources s ON s.id = es.source_id AND s.status <> 'obsolete'
       GROUP BY e.id
       ORDER BY (e.system_key IS NULL), e.created_at, e.id`
    ),
    database.query<Record<string, unknown>>(
      `SELECT s.id::text, s.source_name, s.source_path, s.status,
              s.message_count, s.chunk_count, s.warning_count, s.byte_size,
              es.engine_id::text, es.enabled
       FROM kb.sources s
       LEFT JOIN kb.engine_sources es ON es.source_id = s.id
       WHERE s.status <> 'obsolete'
       ORDER BY s.updated_at DESC, s.id DESC`
    ),
  ]);
  return { engines: engines.rows, sources: sources.rows };
}

export async function createKnowledgeEngine(name: string, description: string) {
  const cleanName = name.trim().slice(0, 120);
  if (!cleanName) throw new Error('Engine name is required.');
  const database = await getKnowledgeDatabase();
  const base = slugify(cleanName) || 'knowledge-engine';
  const slug = `${base}-${Date.now().toString(36)}`;
  const result = await database.query<{ id: string }>(
    `INSERT INTO kb.engines (name, slug, description)
     VALUES ($1, $2, $3) RETURNING id::text`,
    [cleanName, slug, description.trim().slice(0, 500)]
  );
  return result.rows[0];
}

export async function updateKnowledgeEngine(
  id: number,
  values: { name?: string; description?: string; enabled?: boolean }
) {
  const database = await getKnowledgeDatabase();
  const result = await database.query<{ id: string }>(
    `UPDATE kb.engines SET
       name = CASE WHEN $2::text IS NULL THEN name ELSE $2 END,
       description = CASE WHEN $3::text IS NULL THEN description ELSE $3 END,
       enabled = coalesce($4::boolean, enabled), updated_at = now()
     WHERE id = $1 RETURNING id::text`,
    [
      id,
      values.name === undefined ? null : values.name.trim().slice(0, 120),
      values.description === undefined
        ? null
        : values.description.trim().slice(0, 500),
      values.enabled ?? null,
    ]
  );
  if (!result.rows[0]) throw new Error('Knowledge engine not found.');
  return result.rows[0];
}

export async function setEngineSource(params: {
  engineId: number;
  sourceId: number;
  included: boolean;
  enabled?: boolean;
}) {
  const database = await getKnowledgeDatabase();
  if (!params.included) {
    await database.query(
      `DELETE FROM kb.engine_sources WHERE engine_id = $1 AND source_id = $2`,
      [params.engineId, params.sourceId]
    );
    return { included: false };
  }
  await database.query(
    `INSERT INTO kb.engine_sources (engine_id, source_id, enabled)
     VALUES ($1, $2, $3)
     ON CONFLICT (engine_id, source_id)
     DO UPDATE SET enabled = excluded.enabled, updated_at = now()`,
    [params.engineId, params.sourceId, params.enabled ?? true]
  );
  return { included: true, enabled: params.enabled ?? true };
}
