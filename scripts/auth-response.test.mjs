import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { NextRequest } = require('next/server');

function load(relativePath, fetchImpl = globalThis.fetch) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'fetch', 'process', compiled)(
    require, module, module.exports, fetchImpl,
    { env: { IRMS_AUTH_URL: 'https://auth.example/api/irms' } },
  );
  return module.exports;
}

const { readSignInResponse } = load('../frontend/src/lib/auth/client.ts');
const unavailable = /sign-in service is temporarily unavailable/;

for (const [label, body, status] of [
  ['plain-text server error', 'Internal Server Error', 500],
  ['HTML gateway error', '<html>Bad Gateway</html>', 502],
  ['HTML with success status', '<html>Login</html>', 200],
  ['empty response', '', 200],
  ['null JSON', 'null', 200],
  ['missing user', '{}', 200],
  ['invalid user', '{"user":{"id":null}}', 200],
]) {
  test(`login safely handles ${label}`, async () => {
    await assert.rejects(readSignInResponse(new Response(body, { status })), unavailable);
  });
}

test('login preserves credential and throttling errors', async () => {
  for (const [status, detail] of [[401, 'Invalid username or password.'], [429, 'Too many sign-in attempts.']]) {
    await assert.rejects(readSignInResponse(Response.json({ detail }, { status })), { message: detail });
  }
});

test('login handles structured validation errors without object coercion', async () => {
  await assert.rejects(readSignInResponse(Response.json({ detail: [{ msg: 'required' }] }, { status: 422 })), /Check your username and password/);
});

test('login accepts a successful authenticated response', async () => {
  await readSignInResponse(Response.json({ user: { id: 'test-user' } }));
});

async function proxy(fetchImpl, origin = 'https://dashboard.example') {
  const route = load('../frontend/src/app/api/auth/[action]/route.ts', fetchImpl);
  return route.POST(new NextRequest('https://dashboard.example/api/auth/login', {
    method: 'POST', headers: { origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'test', password: 'test-only' }),
  }), { params: Promise.resolve({ action: 'login' }) });
}

test('proxy returns safe JSON for upstream failures without retrying login', async () => {
  for (const upstream of [
    () => new Response('Internal Server Error', { status: 500 }),
    () => new Response('<html>Gateway error</html>', { status: 502 }),
    () => new Response('null'),
    () => Response.json({ detail: 'private database diagnostics' }, { status: 500 }),
    () => { throw new Error('connection failed'); },
  ]) {
    let calls = 0;
    const response = await proxy(async () => { calls++; return upstream(); });
    assert.equal(calls, 1);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match((await response.json()).error, /sign-in service/);
  }
});

test('proxy preserves successful session cookie and forwards credentials', async () => {
  const cookie = 'irms_session=test-session; Path=/; HttpOnly; Secure; SameSite=Strict';
  const response = await proxy(async (url, options) => {
    assert.equal(url, 'https://auth.example/api/irms/auth/login');
    assert.equal(options.headers.origin, 'https://auth.example');
    assert.deepEqual(JSON.parse(options.body), { username: 'test', password: 'test-only' });
    return Response.json({ user: { id: 'test-user' } }, { headers: { 'set-cookie': cookie } });
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('set-cookie'), cookie);
  await readSignInResponse(response);
});

test('proxy preserves invalid-password response', async () => {
  const response = await proxy(async () => Response.json({ detail: 'Invalid username or password.' }, { status: 401 }));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { detail: 'Invalid username or password.' });
});

test('proxy rejects cross-origin login without contacting upstream', async () => {
  const response = await proxy(async () => assert.fail('upstream must not be called'), 'https://other.example');
  assert.equal(response.status, 403);
});
