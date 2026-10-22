'use strict';
// AlecaLocal: decrypts AlecaFrame's local data and serves a GUI on 127.0.0.1.
// Usage: node server.js [--port 8787] [--dir <AlecaFrame folder>] [--no-open] [--no-market] [--no-wiki]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { decryptFile } = require('./lib/decrypt');
const { loadDb } = require('./lib/db');
const { buildModel } = require('./lib/model');
const { Market } = require('./lib/market');
const sell = require('./lib/sell');
const { itemDetails } = require('./lib/details');
const detailCache = {};
const { Wiki, pageFor } = require('./lib/wiki');
const wiki = new Wiki(path.join(__dirname, 'data'));

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PORT = Number(arg('--port', process.env.PORT || 8787));
const ALECA_DIR = arg('--dir', process.env.ALECA_DIR || path.join(process.env.LOCALAPPDATA || '', 'AlecaFrame'));
const PUBLIC = path.join(__dirname, 'public');
const LAST = path.join(ALECA_DIR, 'lastData.dat');
const DELTAS = path.join(ALECA_DIR, 'deltas.dat');

let db = null;
let state = { model: null, error: null, raw: {} };
const clients = new Set();
const broadcast = msg => { for (const res of clients) res.write(`data: ${JSON.stringify(msg)}\n\n`); };

const NO_MARKET = args.includes('--no-market');
const market = new Market(path.join(__dirname, 'data'), status => broadcast({ type: 'market', status }));
let sellCands = [];
let marketReady = null;

async function refreshMarket(force) {
  if (NO_MARKET || !state.model) return;
  marketReady = marketReady || market.loadIndex();
  if (!(await marketReady)) { marketReady = null; return; }
  sellCands = sell.candidates(state.model, market);
  market.want(sell.priceRequests(sellCands), force);
  broadcast({ type: 'market', status: market.status() });
}

function fileInfo(f) {
  try { const s = fs.statSync(f); return { path: f, size: s.size, modified: s.mtimeMs }; } catch { return { path: f, missing: true }; }
}

function reload(reason) {
  const t0 = Date.now();
  try {
    if (!db) db = loadDb(ALECA_DIR);
    const lastText = decryptFile(LAST);
    const last = JSON.parse(lastText);
    let deltasText = null, deltas = null;
    try { deltasText = decryptFile(DELTAS); deltas = JSON.parse(deltasText); } catch (e) { console.warn('deltas.dat:', e.message); }
    let username = null;
    try { username = fs.readFileSync(path.join(ALECA_DIR, 'lastUsername.txt'), 'utf8').trim(); } catch {}
    const model = buildModel(db, last, deltas, { username, files: { lastData: fileInfo(LAST), deltas: fileInfo(DELTAS) } });
    state = { model, error: null, raw: { lastData: lastText, deltas: deltasText } };
    console.log(`[${new Date().toLocaleTimeString()}] loaded (${reason}) in ${Date.now() - t0} ms`);
  } catch (e) {
    state = { ...state, error: e.message };
    console.error('Load failed:', e.message);
  }
  broadcast({ type: 'data', updated: Date.now(), error: state.error });
  refreshMarket(false);
}

// Watch for AlecaFrame rewriting its data (it does after each inventory sync)
let pending = null;
for (const f of [LAST, DELTAS]) {
  fs.watchFile(f, { interval: 2000 }, (cur, prev) => {
    if (cur.mtimeMs === prev.mtimeMs) return;
    clearTimeout(pending);
    pending = setTimeout(() => reload('file changed'), 1000);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };

function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/api/model') {
    if (!state.model) return send(res, 503, JSON.stringify({ error: state.error || 'not loaded' }));
    return send(res, 200, JSON.stringify(state.model));
  }
  if (p === '/api/reload') { db = url.searchParams.has('db') ? null : db; reload('manual'); return send(res, 200, JSON.stringify({ ok: !state.error, error: state.error })); }
  if (p === '/api/item') {
    if (!state.model) return send(res, 503, JSON.stringify({ error: 'not loaded' }));
    const un = (url.searchParams.get('un') || '').replace(/#set$/, '');
    const d = itemDetails(db, state.model, un, detailCache);
    return d ? send(res, 200, JSON.stringify(d)) : send(res, 404, JSON.stringify({ error: 'unknown item' }));
  }
  if (p === '/api/wiki') {
    if (args.includes('--no-wiki')) return send(res, 404, JSON.stringify({ error: 'wiki lookups disabled' }));
    const page = pageFor(db, (url.searchParams.get('un') || '').replace(/#set$/, ''));
    if (!page) return send(res, 404, JSON.stringify({ error: 'no wiki page known' }));
    wiki.acquisition(page)
      .then(w => send(res, 200, JSON.stringify(w)))
      .catch(e => send(res, 502, JSON.stringify({ error: e.message })));
    return;
  }
  if (p === '/api/sell') {
    return send(res, 200, JSON.stringify({
      disabled: NO_MARKET, status: market.status(), rows: market.indexAt ? sell.recommend(sellCands, market) : [],
    }));
  }
  if (p === '/api/sell/refresh') { refreshMarket(true); return send(res, 200, '{"ok":true}'); }
  if (p === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 3000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (p === '/api/export') {
    const which = url.searchParams.get('file') === 'deltas' ? 'deltas' : 'lastData';
    let text = state.raw[which];
    if (!text) return send(res, 404, JSON.stringify({ error: 'not available' }));
    const obj = JSON.parse(text);
    if (which === 'lastData' && typeof obj.InventoryJson === 'string') obj.InventoryJson = JSON.parse(obj.InventoryJson);
    return send(res, 200, JSON.stringify(obj, null, 2), 'application/json; charset=utf-8',
      { 'Content-Disposition': `attachment; filename="${which}.decrypted.json"` });
  }

  const imgMatch = p.match(/^\/aleca-img\/([\w-]+\.png)$/);
  const file = imgMatch
    ? path.join(ALECA_DIR, 'cachedData', 'custom', 'img', imgMatch[1])
    : path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p));
  if (!imgMatch && !file.startsWith(PUBLIC)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, buf, MIME[path.extname(file)] || 'application/octet-stream');
  });
});

console.log('AlecaFrame folder:', ALECA_DIR);
reload('startup');
server.listen(PORT, '127.0.0.1', () => {
  const u = `http://127.0.0.1:${PORT}/`;
  console.log('AlecaLocal running at', u);
  if (!args.includes('--no-open')) exec(process.platform === 'win32' ? `start "" "${u}"` : `xdg-open ${u}`);
});
