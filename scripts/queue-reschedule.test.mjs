import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { PGlite, types } from '@electric-sql/pglite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// Run the real service and query adapter against an isolated in-memory database.
// No workspace environment, local records, or hosted credentials are loaded.
function loadModules(database) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const source = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    }).outputText;
    const localRequire = (name) => {
      if (name === 'server-only') return {};
      if (name === '@/lib/supabase/admin') {
        return {
          getSupabaseAdminClient: () =>
            load(
              path.join(root, 'frontend/src/lib/local-db/supabase-adapter.ts')
            ).getLocalSupabaseClient(),
        };
      }
      if (name === './db') return { getLocalAppDatabase: async () => database };
      if (name === '@/lib/cloud/database') return { cloudEnabled: () => false };
      if (name.startsWith('@/'))
        return load(path.join(root, 'frontend/src', `${name.slice(2)}.ts`));
      if (name.startsWith('.'))
        return load(path.resolve(path.dirname(file), `${name}.ts`));
      return require(name);
    };
    new Function('require', 'module', 'exports', source)(
      localRequire,
      module,
      module.exports
    );
    return module.exports;
  }
  return (name) => load(path.join(root, `frontend/src/lib/${name}.ts`));
}

const iso = (day) => `${day}T09:00:00.000Z`;

async function fixture(t) {
  const db = await PGlite.create({ parsers: { [types.TIMESTAMPTZ]: String } });
  t.after(() => db.close());
  const load = loadModules(db);
  await db.exec(load('local-db/schema').LOCAL_APP_SCHEMA_SQL);
  const service = load('queue/service');
  const {
    rows: [asset],
  } = await db.query(
    "INSERT INTO equipment_assets (asset_code, name) VALUES ('TEST', 'Test instrument') RETURNING id"
  );
  const add = async (start, end, position, overrides = {}) => {
    const { data } = await service.createQueueItem({
      sample_label: `Batch ${position}`,
      sample_count: 100,
      samples_per_week: 100,
      analysis_type: 'Test',
      asset_id: asset.id,
      queue_position: position,
      estimated_start_at: iso(start),
      estimated_end_at: iso(end),
      ...overrides,
    });
    return data;
  };
  return { db, load, service, add };
}

test('calendar move of an overdue queued run saves dates, cascades, and syncs the lab book', async (t) => {
  const { service, add, db } = await fixture(t);
  const first = await add('2026-10-01', '2026-11-13', 1, { sample_count: 600 });
  const next = await add('2026-11-16', '2026-11-23', 2);
  const result = await service.updateQueueItem(first.id, {
    segments: [
      {
        ...first.segments[0],
        start_at: iso('2026-11-03'),
        end_at: iso('2026-12-15'),
        user_edited: true,
      },
    ],
    cascade_future: true,
  });
  assert.equal(result.cascadeCount, 1);
  const items = await service.listQueueItems();
  const moved = items.find((item) => item.id === first.id);
  const following = items.find((item) => item.id === next.id);
  assert.equal(
    new Date(moved.estimated_start_at).toISOString(),
    iso('2026-11-03')
  );
  assert.equal(
    new Date(following.estimated_start_at).toISOString(),
    iso('2026-12-16')
  );
  assert.equal(
    new Date(following.estimated_end_at).toISOString(),
    iso('2026-12-22')
  );
  assert.equal(moved.segments[0].user_edited, true);
  const {
    rows: [entry],
  } = await db.query(
    'SELECT occurred_at, next_due_at FROM lab_book_entries WHERE id = $1',
    [following.lab_book_entry_id]
  );
  assert.equal(new Date(entry.occurred_at).toISOString(), iso('2026-12-16'));
  assert.equal(new Date(entry.next_due_at).toISOString(), iso('2026-12-22'));
});

test('editor date save cascades without a flag, including a previously edited following run', async (t) => {
  const { service, add, db } = await fixture(t);
  const first = await add('2026-11-03', '2026-11-09', 1);
  const next = await add('2026-11-10', '2026-11-16', 2);
  await db.query(
    'UPDATE sample_queue_segments SET user_edited = true WHERE queue_item_id = $1',
    [next.id]
  );
  await service.updateQueueItem(first.id, {
    sample_label: 'Editor save',
    sample_count: 100,
    samples_per_week: 100,
    segments: [{ ...first.segments[0], end_at: iso('2026-11-19') }],
  });
  const following = (await service.listQueueItems()).find(
    (item) => item.id === next.id
  );
  assert.equal(
    new Date(following.estimated_start_at).toISOString(),
    iso('2026-11-23')
  );
  assert.equal(
    new Date(following.estimated_end_at).toISOString(),
    iso('2026-11-27')
  );
});

test('parent date updates cascade and unchanged editor saves preserve the schedule', async (t) => {
  const { service, add } = await fixture(t);
  const first = await add('2026-11-03', '2026-11-09', 1);
  await add('2026-11-10', '2026-11-16', 2);
  await service.updateQueueItem(first.id, {
    estimated_end_at: iso('2026-11-06'),
  });
  const before = await service.listQueueItems();
  const item = before.find((row) => row.id === first.id);
  const saved = await service.updateQueueItem(first.id, {
    segments: item.segments,
    notes: 'No date change',
    cascade_future: true,
  });
  assert.equal(saved.cascadeCount, 0);
  assert.deepEqual(
    (await service.listQueueItems()).map((row) => row.segments),
    before.map((row) => row.segments)
  );
  assert.equal(
    new Date(before[1].estimated_start_at).toISOString(),
    iso('2026-11-09')
  );
});

test('a conflict is rejected before any dates or metadata are saved', async (t) => {
  const { service, add } = await fixture(t);
  await add('2026-11-03', '2026-11-09', 1);
  const second = await add('2026-11-10', '2026-11-16', 2);
  const before = await service.listQueueItems();
  await assert.rejects(
    service.updateQueueItem(second.id, {
      sample_label: 'Must not save',
      segments: [{ ...second.segments[0], start_at: iso('2026-11-06') }],
    }),
    /overlaps preceding/
  );
  assert.deepEqual(await service.listQueueItems(), before);
});

test('status, rather than an overdue planned date, controls dragging and active-work protection', () => {
  const { queueRunDateBlockReason, planQueueDateChanges } =
    loadModules(null)('queue/reschedule');
  const start = new Date(iso('2026-10-01'));
  const end = new Date(iso('2026-11-13'));
  const today = new Date(iso('2026-10-29'));
  assert.equal(
    queueRunDateBlockReason('queued', start, end, 'move', today),
    null
  );
  assert.match(
    queueRunDateBlockReason('analysing', start, end, 'move', today),
    /only resize/
  );
  assert.match(
    queueRunDateBlockReason('completed', start, end, 'move', today),
    /Completed/
  );
  const run = {
    id: 'run',
    queue_item_id: 'item',
    run_position: 1,
    segment_order: 1,
    start_at: start.toISOString(),
    end_at: end.toISOString(),
  };
  assert.throws(
    () =>
      planQueueDateChanges(
        [{ id: 'item', status: 'analysing', segments: [run] }],
        [{ id: 'run', start: new Date(iso('2026-11-03')), end }],
        today
      ),
    /only resize/
  );
  assert.equal(
    planQueueDateChanges(
      [{ id: 'item', status: 'analysing', segments: [run] }],
      [{ id: 'run', start, end: new Date(iso('2026-11-19')) }],
      today
    ).length,
    1
  );
});

test('split runs retain runway order, recalculate following segments, and accept multiple edited anchors', () => {
  const { planQueueDateChanges } = loadModules(null)('queue/reschedule');
  const run = (id, position, start, end) => ({
    id,
    queue_item_id: 'item',
    run_position: position,
    segment_order: position,
    start_at: iso(start),
    end_at: iso(end),
  });
  const items = [
    {
      id: 'item',
      status: 'queued',
      segments: [
        run('a', 1, '2026-11-03', '2026-11-09'),
        run('b', 2, '2026-11-10', '2026-11-16'),
        run('c', 3, '2026-11-17', '2026-11-24'),
      ],
    },
  ];
  const change = (id, start, end) => ({
    id,
    start: new Date(iso(start)),
    end: new Date(iso(end)),
  });
  const result = planQueueDateChanges(items, [
    change('a', '2026-11-03', '2026-11-19'),
    change('c', '2026-12-01', '2026-12-07'),
  ]);
  assert.deepEqual(
    result.map((row) => [
      row.id,
      row.start.toISOString(),
      row.end.toISOString(),
    ]),
    [
      ['a', iso('2026-11-03'), iso('2026-11-19')],
      ['b', iso('2026-11-23'), iso('2026-11-27')],
      ['c', iso('2026-12-01'), iso('2026-12-07')],
    ]
  );
});
