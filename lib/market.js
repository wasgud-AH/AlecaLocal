'use strict';
// warframe.market client: item index + top orders, cached on disk and rate limited.
const fs = require('fs');
const path = require('path');

const API = 'https://api.warframe.market/v2';
const API_V1 = 'https://api.warframe.market/v1';
const HISTORY_DAYS = 14;
const PRICE_VERSION = 2; // bump to invalidate cached prices when their shape changes
const HEADERS = { Accept: 'application/json', Language: 'en', Platform: 'pc', Crossplay: 'true', 'User-Agent': 'AlecaLocal/1.0' };
const INDEX_TTL = 24 * 3600e3;
const PRICE_TTL = 6 * 3600e3;
const GAP_MS = 350; // warframe.market allows ~3 requests/second

class Market {
  constructor(dataDir, onProgress) {
    this.dir = dataDir;
    fs.mkdirSync(dataDir, { recursive: true });
    this.indexFile = path.join(dataDir, 'wfm-items.json');
    this.priceFile = path.join(dataDir, 'wfm-prices.json');
    this.byRef = new Map();
    this.prices = readJson(this.priceFile, {});
    this.queue = [];
    this.queued = new Set();
    this.running = false;
    this.done = 0;
    this.failed = 0;
    this.error = null;
    this.indexAt = 0;
    this.onProgress = onProgress || (() => {});
    this.saveTimer = null;
  }

  async loadIndex(force) {
    let cached = readJson(this.indexFile, null);
    if (force || !cached || Date.now() - cached.at > INDEX_TTL) {
      try {
        const j = await getJson(`${API}/items`);
        cached = { at: Date.now(), items: j.data };
        fs.writeFileSync(this.indexFile, JSON.stringify(cached));
      } catch (e) {
        this.error = 'Item list: ' + e.message;
        if (!cached) return false;
      }
    }
    this.byRef = new Map();
    for (const it of cached.items) {
      if (it.gameRef) this.byRef.set(it.gameRef, {
        slug: it.slug, name: it.i18n && it.i18n.en ? it.i18n.en.name : it.slug, tags: it.tags || [],
        ducats: it.ducats || 0, maxRank: it.maxRank, subtypes: it.subtypes,
      });
    }
    this.indexAt = cached.at;
    return true;
  }

  lookup(gameRef) { return this.byRef.get(gameRef) || null; }

  static key(slug, opts = {}) { return [slug, opts.rank ?? '', opts.subtype ?? ''].join('|'); }

  price(slug, opts) {
    const p = this.prices[Market.key(slug, opts)];
    return p && p.v === PRICE_VERSION ? p : null;
  }

  // Queue price fetches for any keys that are missing or stale
  want(requests, force) {
    for (const r of requests) {
      const k = Market.key(r.slug, r);
      const p = this.prices[k];
      if (!force && p && p.v === PRICE_VERSION && Date.now() - p.at < PRICE_TTL) continue;
      if (this.queued.has(k)) continue;
      this.queued.add(k);
      this.queue.push({ k, ...r });
    }
    if (!this.running && this.queue.length) this.run();
  }

  status() {
    return {
      running: this.running, pending: this.queue.length, done: this.done, failed: this.failed,
      error: this.error, indexAt: this.indexAt, cached: Object.keys(this.prices).length,
    };
  }

  async run() {
    this.running = true;
    this.done = 0;
    this.failed = 0;
    this.error = null;
    let lastNotify = 0;
    while (this.queue.length) {
      const r = this.queue.shift();
      try {
        const qs = new URLSearchParams();
        if (r.rank != null) qs.set('rank', r.rank);
        if (r.subtype) qs.set('subtype', r.subtype);
        const slug = encodeURIComponent(r.slug);
        const top = await getJson(`${API}/orders/item/${slug}/top${qs.size ? '?' + qs : ''}`);
        await sleep(GAP_MS);
        let stats = null;
        try { stats = await getJson(`${API_V1}/items/${slug}/statistics`); } catch (e) { if (e.status === 429) throw e; }
        this.prices[r.k] = summarize(top.data || {}, stats && stats.payload, r);
        this.done++;
      } catch (e) {
        this.failed++;
        this.error = `${r.slug}: ${e.message}`;
        if (e.status === 429) { this.queue.unshift(r); await sleep(5000); continue; }
      }
      this.queued.delete(r.k);
      this.scheduleSave();
      if (Date.now() - lastNotify > 1500) { lastNotify = Date.now(); this.onProgress(this.status()); }
      await sleep(GAP_MS);
    }
    this.running = false;
    this.save();
    this.onProgress(this.status());
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save(); }, 5000);
  }

  save() {
    try { fs.writeFileSync(this.priceFile, JSON.stringify(this.prices)); } catch {}
  }
}

// "top" returns the 5 cheapest online sell orders and 5 highest online buy orders;
// statistics holds daily completed-trade prices, which resist one-off troll listings.
function summarize(data, stats, opts) {
  const sells = (data.sell || []).map(o => o.platinum).sort((a, b) => a - b);
  const buys = (data.buy || []).map(o => o.platinum).sort((a, b) => b - a);
  const cutoff = Date.now() - HISTORY_DAYS * 864e5;
  const days = ((stats && stats.statistics_closed && stats.statistics_closed['90days']) || []).filter(e =>
    Date.parse(e.datetime) >= cutoff
    && (!opts.subtype || e.subtype === opts.subtype)
    && (opts.rank == null || e.mod_rank == null || e.mod_rank === opts.rank));
  const volume = days.reduce((s, e) => s + (e.volume || 0), 0);
  const traded = volume ? days.reduce((s, e) => s + (e.median ?? e.avg_price) * (e.volume || 0), 0) / volume : null;
  return {
    v: PRICE_VERSION,
    at: Date.now(),
    sell: sells.length ? sells[0] : null,
    buy: buys.length ? buys[0] : null,
    sellers: sells.length,
    buyers: buys.length,
    traded: traded != null ? Math.round(traded * 10) / 10 : null,
    volume, // units traded in the last HISTORY_DAYS days
  };
}

async function getJson(url) {
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(15000) });
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  return r.json();
}

function readJson(f, d) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = { Market };
