'use strict';
// Run with: node --test
const test = require('node:test');
const assert = require('node:assert');
const { sanitize } = require('./lib/wiki');
const sell = require('./lib/sell');

test('sanitize drops scripts, event handlers and non-wiki links', () => {
  const out = sanitize('<img src=x onerror=alert(1)><script>alert(2)</script><a href="javascript:alert(3)">x</a>'
    + '<p onclick="alert(4)">ok</p><a href="/w/Gauss">Gauss</a>');
  assert.doesNotMatch(out, /onerror|onclick|<script|javascript:/i);
  assert.match(out, /<p>ok<\/p>/);
  assert.match(out, /<a href="https:\/\/wiki\.warframe\.com\/w\/Gauss" target="_blank" rel="noopener">Gauss<\/a>/);
});

// Minimal model and market: one prime part on the market, nothing else
const market = { lookup: un => (un.startsWith('P/') || un.startsWith('A/') ? { slug: un, name: un, tags: [], maxRank: 5 } : null) };
const model = prime => ({
  primes: [{ uniqueName: 'Prime', name: 'Prime', ownedItem: 0, mastered: false, ...prime,
    components: [{ tradeUniqueName: 'P/Barrel', name: 'Barrel', owned: 3, tradable: 3, need: 2, ducats: 15 }] }],
  mods: [], relics: [], mastery: [], inventory: [],
});
const part = cands => cands.find(c => c.uniqueName === 'P/Barrel');

test('keeps the parts needed to build an unbuilt prime', () => {
  const p = part(sell.candidates(model({}), market));
  assert.strictEqual(p.keep, 2);
  assert.strictEqual(p.excess, 1);
});

test('keeps no parts once the prime is mastered', () => {
  const p = part(sell.candidates(model({ mastered: true }), market));
  assert.strictEqual(p.keep, 0);
  assert.strictEqual(p.excess, 3);
});

test('keeps enough arcane copies for one max rank', () => {
  const m = { primes: [], relics: [], mastery: [], inventory: [],
    mods: [{ uniqueName: 'A/Energize', isArcane: true, maxRank: 5, unranked: 25, ranked: [] }] };
  const a = sell.candidates(m, market)[0];
  assert.strictEqual(a.keep, 21); // 1 + 2 + ... + 6 copies for rank 5
  assert.strictEqual(a.excess, 4);
});

test('price run retries 429s and network errors without reporting a failure', async () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const { Market } = require('./lib/market');
  const m = new Market(fs.mkdtempSync(path.join(os.tmpdir(), 'wfm-')));
  const replies = [
    () => ({ ok: false, status: 429 }),
    () => { throw new TypeError('fetch failed'); },
    () => ({ ok: true, json: async () => ({ data: { sell: [{ platinum: 10 }], buy: [] } }) }),
    () => ({ ok: true, json: async () => ({ payload: {} }) }),
  ];
  const realFetch = global.fetch;
  global.fetch = async () => replies.shift()();
  try {
    m.queue.push({ k: 'x||', slug: 'x' });
    m.queued.add('x||');
    await m.run();
  } finally {
    global.fetch = realFetch;
  }
  assert.deepStrictEqual([m.done, m.failed, m.error], [1, 0, null]);
  assert.strictEqual(m.prices['x||'].sell, 10);
});
