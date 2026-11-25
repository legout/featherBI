import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'skill/featherbi/scripts/featherbi.mjs');
const fixture = path.join(root, 'fixtures/hand/pivot-table.yaml');
const secret = 'unique-secret-81-please-never-print';
const token = 'unique-session-token-81-never-print';
const run = (args, env = {}) => new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [cli, 'build', ...args], { cwd: root, env: { ...process.env, AWS_ACCESS_KEY_ID: 'test-access-81', AWS_SECRET_ACCESS_KEY: secret, AWS_SESSION_TOKEN: token, ...env } });
  let stdout = '', stderr = '';
  p.stdout.on('data', b => stdout += b); p.stderr.on('data', b => stderr += b);
  p.on('error', reject); p.on('close', code => resolve({ code, stdout, stderr }));
});
const absent = async file => assert.rejects(readFile(file), { code: 'ENOENT' });
const clean = async (t) => { const dir = await mkdtemp(path.join(os.tmpdir(), 'remote-81-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; };
async function store(t, { head = 404, cors = true, get = 206 } = {}) {
  const requests = [], objects = new Map();
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks); const key = new URL(req.url, 'http://localhost').pathname;
    requests.push({ method: req.method, key, headers: req.headers, body });
    if (req.method === 'HEAD' && head === 301) res.writeHead(key === '/moved' ? 200 : 301, { Location: '/moved' }).end();
    else if (req.method === 'HEAD') res.writeHead(head === 403 ? 403 : objects.has(key) ? 200 : head).end();
    else if (req.method === 'PUT') { objects.set(key, body); res.writeHead(200).end(); }
    else { res.writeHead(get, cors ? { 'Access-Control-Allow-Origin': '*' } : {}); res.end('x'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { requests, endpoint: `http://127.0.0.1:${server.address().port}` };
}

test('AWS published SigV4 query example', async () => {
  const { presign } = await import('../skill/featherbi/scripts/lib/s3.mjs');
  const url = await presign({ method: 'GET', url: 'https://examplebucket.s3.amazonaws.com/test.txt', expiresSec: 86400, now: new Date('2013-05-24T00:00:00Z'), env: { AWS_ACCESS_KEY_ID: 'AKIAIOSFODNN7EXAMPLE', AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', AWS_REGION: 'us-east-1' } });
  assert.equal(String(url), 'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
});

test('uploads exact snapshot once and preflights; credentials remain secret', async t => {
  const dir = await clean(t), s = await store(t), out = path.join(dir, 'dash.html');
  const split = path.join(dir, 'split');
  const baseline = await run([fixture, '--split', '--out', split]); assert.equal(baseline.code, 0, baseline.stderr);
  const bytes = await readFile(path.join(split, 'sales.parquet'));
  const args = [fixture, '--remote', 's3://bucket/prefix', '--out', out];
  for (let i = 0; i < 2; i++) {
    const r = await run(args, { AWS_ENDPOINT_URL: s.endpoint });
    assert.equal(r.code, 0, r.stderr);
    const html = await readFile(out, 'utf8');
    for (const text of [html, r.stdout, r.stderr]) assert.ok(!text.includes(secret));
    for (const text of [r.stdout, r.stderr]) assert.ok(!text.includes(token));
    const data = JSON.parse(html.match(/<script type="application\/json" id="dashboard">(.*?)<\/script>/s)[1]);
    const urls = Object.values(data.remote.tables).map(table => new URL(table.url));
    assert.ok(urls.length > 0);
    for (const url of urls) assert.equal(url.searchParams.get('X-Amz-Security-Token'), token);
  }
  const puts = s.requests.filter(r => r.method === 'PUT');
  assert.equal(puts.length, 1); assert.deepEqual(puts[0].body, bytes);
  assert.equal(puts[0].key, `/bucket/prefix/${createHash('sha256').update(bytes).digest('hex')}.parquet`);
  assert.equal(s.requests.filter(r => r.method === 'HEAD').length, 2);
  const gets = s.requests.filter(r => r.method === 'GET'); assert.equal(gets.length, 2);
  for (const get of gets) { assert.equal(get.headers.range, 'bytes=0-0'); assert.equal(get.headers.origin, 'null'); }
  // A '#' in the prefix is path data: the object keeps its hash filename (or the target is rejected before any request).
  const before = s.requests.length;
  const hashed = await run([fixture, '--remote', 's3://bucket/issue#81', '--out', out], { AWS_ENDPOINT_URL: s.endpoint });
  if (hashed.code !== 0) assert.equal(s.requests.length, before);
  else for (const req of s.requests.slice(before)) assert.match(req.key, /^\/bucket\/issue%2381\/[0-9a-f]{64}\.parquet$/);
});
for (const [name, options, message] of [['HEAD 403', { head: 403 }, /403/], ['HEAD 301', { head: 301 }, /301/], ['missing CORS', { cors: false }, /cors/i], ['preflight 200', { get: 200 }, /cors/i]]) {
  test(`${name} fails without HTML or credential leaks`, async t => {
    const dir = await clean(t), s = await store(t, options), out = path.join(dir, 'dash.html');
    const r = await run([fixture, '--remote', 's3://bucket/prefix', '--out', out], { AWS_ENDPOINT_URL: s.endpoint });
    assert.notEqual(r.code, 0); assert.match(r.stderr, message); await absent(out);
    assert.ok(!r.stdout.includes(secret) && !r.stderr.includes(secret) && !r.stdout.includes(token) && !r.stderr.includes(token));
    if (options.head) assert.equal(s.requests.filter(r => r.method === 'PUT').length, 0);
  });
}
for (const [name, args] of [
  ['offline', ['--remote', 's3://bucket/prefix', '--offline']],
  ['split', ['--remote', 's3://bucket/prefix', '--split']],
  ['non-S3 target', ['--remote', 'https://example.com/path']],
  ['under 1h', ['--remote', 's3://bucket/prefix', '--expires', '0h']],
  ['over 7d', ['--remote', 's3://bucket/prefix', '--expires', '8d']],
  ['invalid duration', ['--remote', 's3://bucket/prefix', '--expires', '1m']],
]) test(`rejects ${name}`, async t => {
  const dir = await clean(t), out = path.join(dir, 'dash.html');
  const r = await run([fixture, ...args, '--out', out]); assert.notEqual(r.code, 0); await absent(out);
  assert.doesNotMatch(r.stderr, /Unknown option '--remote'/);
});

test('reports remote size, warns above 200 MB, and skips embedded warning', async t => {
  const dir = await clean(t), s = await store(t), config = path.join(dir, 'big.yaml'), out = path.join(dir, 'dash.html');
  await writeFile(config, `title: Big\nname: big\nsources:\n  big:\n    read: "(SELECT random() AS x FROM range(36000000))"\ntiles:\n  - { type: kpi, title: Rows, sql: "SELECT COUNT(*) AS value FROM big" }\n`);
  const r = await run([config, '--remote', 's3://bucket/prefix', '--out', out], { AWS_ENDPOINT_URL: s.endpoint });
  assert.equal(r.code, 0, r.stderr);
  const bytes = s.requests.find(r => r.method === 'PUT').body.length; assert.ok(bytes > 200 * 1024 * 1024);
  assert.match(r.stdout + r.stderr, /200\s*MB/i); assert.match(r.stdout + r.stderr, /download/i);
  assert.doesNotMatch(r.stdout + r.stderr, /25\s*MB/i);
});
