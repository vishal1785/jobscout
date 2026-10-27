/**
 * A local stand-in for the deployment, so the cloud path can be tested
 * without deploying: the real api/ handlers on :7788, over a fake Upstash
 * REST API on :7777. Keys: REPORT_KEY=read-key, PUBLISH_KEY=write-key.
 *
 *   node test/fake-vercel.mjs &
 *   CI=true JOBSCOUT_SITE=http://127.0.0.1:7788 PUBLISH_KEY=write-key node src/index.ts
 *   curl "http://127.0.0.1:7788/r?k=read-key"
 */
import { createServer } from 'node:http';

process.env.KV_REST_API_URL = 'http://127.0.0.1:7777';
process.env.KV_REST_API_TOKEN = 'test-token';
process.env.REPORT_KEY = 'read-key';
process.env.PUBLISH_KEY = 'write-key';

const store = (await import('../api/store.js')).default;
const report = (await import('../api/report.js')).default;
const triage = (await import('../api/triage.js')).default;

const db = new Map();
const hashes = new Map();
createServer(async (req, res) => {
  if (req.headers.authorization !== 'Bearer test-token') { res.statusCode = 401; return res.end('no'); }
  const [, verb, key] = new URL(req.url, 'http://x').pathname.split('/');
  // Upstash's other form: POST / with the command as a JSON array (the hash
  // commands /api/triage uses)
  if (!verb && req.method === 'POST') {
    const parts = [];
    for await (const c of req) parts.push(Buffer.from(c));
    const [cmd, name, field, value] = JSON.parse(Buffer.concat(parts).toString('utf8'));
    const h = hashes.get(name) ?? new Map();
    hashes.set(name, h);
    if (cmd === 'HSET') { h.set(field, value); return res.end(JSON.stringify({ result: 1 })); }
    if (cmd === 'HDEL') return res.end(JSON.stringify({ result: h.delete(field) ? 1 : 0 }));
    if (cmd === 'HGETALL') return res.end(JSON.stringify({ result: [...h].flat() }));
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: `unsupported ${cmd}` }));
  }
  if (verb === 'get') return res.end(JSON.stringify({ result: db.get(decodeURIComponent(key)) ?? null }));
  const parts = [];
  for await (const c of req) parts.push(Buffer.from(c));
  db.set(decodeURIComponent(key), Buffer.concat(parts).toString('utf8'));
  res.end(JSON.stringify({ result: 'OK' }));
}).listen(7777);

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => res.end(JSON.stringify(o));
  res.send = (b) => res.end(b);
  if (path === '/api/store') return store(req, res);
  if (path === '/api/report' || path === '/r') return report(req, res);
  if (path === '/api/triage') return triage(req, res);
  res.statusCode = 404;
  res.end('not found');
}).listen(7788, () => console.log('fake vercel on :7788, fake upstash on :7777'));
