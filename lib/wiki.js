'use strict';
// Fetches "Acquisition" / "Drop Locations" sections from wiki.warframe.com, sanitized and cached on disk.
const fs = require('fs');
const path = require('path');

const WIKI = 'https://wiki.warframe.com';
const API = `${WIKI}/api.php?format=json&formatversion=2&redirects=1&action=parse&prop=text&page=`;
const TTL = 7 * 864e5;
const SECTIONS = /^(Acquisition|Drop Locations|Location|Locations|Obtaining|Sources)$/i;
const HEADERS = { 'User-Agent': 'AlecaLocal/1.0 (personal Warframe inventory viewer)' };

const ALLOWED = new Set(['p', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'b', 'strong', 'i', 'em', 'br', 'a', 'h3', 'h4', 'dl', 'dt', 'dd']);
// Any "<" that doesn't start an allowed tag
const STRAY_LT = new RegExp(`<(?!\\/?(?:${[...ALLOWED].join('|')})\\b)`, 'g');

class Wiki {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'wiki');
    fs.mkdirSync(this.dir, { recursive: true });
    this.inflight = new Map();
  }

  file(page) { return path.join(this.dir, page.replace(/[^\w.-]+/g, '_').slice(0, 120) + '.json'); }

  async acquisition(page) {
    const f = this.file(page);
    try {
      const c = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (Date.now() - c.at < TTL) return c;
    } catch {}
    if (this.inflight.has(page)) return this.inflight.get(page);
    const p = (async () => {
      const r = await fetch(API + encodeURIComponent(page), { headers: HEADERS, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (j.error) {
        const out = { at: Date.now(), page, missing: true, html: '' };
        fs.writeFileSync(f, JSON.stringify(out));
        return out;
      }
      const title = j.parse.title;
      const out = { at: Date.now(), page: title, url: `${WIKI}/w/${encodeURIComponent(title.replace(/ /g, '_'))}`, html: extract(j.parse.text) };
      fs.writeFileSync(f, JSON.stringify(out));
      return out;
    })().finally(() => this.inflight.delete(page));
    this.inflight.set(page, p);
    return p;
  }
}

// Pull the wanted level-2 sections out of the rendered page
function extract(html) {
  const parts = html.split(/(?=<div class="mw-heading mw-heading2")/);
  const keep = [];
  for (const part of parts) {
    const m = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(part);
    if (!m) continue;
    const title = m[1].replace(/<[^>]+>/g, '').trim();
    if (!SECTIONS.test(title)) continue;
    const body = part.slice(part.indexOf('</div>', m.index) + 6);
    keep.push(`<h3>${escapeText(title)}</h3>` + sanitize(body));
  }
  return keep.join('').slice(0, 150000);
}

function escapeText(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// Allowlist sanitizer: rebuilds every tag, keeping only safe tags and a couple of attributes
function sanitize(html) {
  html = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|sup|figure|figcaption)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<span class="mw-editsection[\s\S]*?<\/span>\s*<\/span>/g, '')
    // "This section is transcluded from ..." editor notices
    .replace(/<i>(?:(?!<\/i>)[\s\S])*?transcluded[\s\S]*?<\/i>/gi, '');
  html = html.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g, (all, close, tag, attrs) => {
    tag = tag.toLowerCase();
    if (!ALLOWED.has(tag)) return tag === 'div' && !close ? ' ' : '';
    if (close) return `</${tag}>`;
    if (tag === 'a') {
      const href = /\shref="([^"]*)"/.exec(attrs);
      let url = href ? href[1].replace(/&amp;/g, '&') : '';
      if (url.startsWith('/w/')) url = WIKI + url;
      if (!/^https:\/\/wiki\.warframe\.com\/w\/[^"'<>\s]*$/.test(url)) return '<a>';
      return `<a href="${escapeText(url)}" target="_blank" rel="noopener">`;
    }
    if (tag === 'td' || tag === 'th') {
      const span = [];
      for (const k of ['colspan', 'rowspan']) {
        const m = new RegExp(`\\s${k}="(\\d{1,2})"`).exec(attrs);
        if (m) span.push(`${k}="${m[1]}"`);
      }
      return `<${tag}${span.length ? ' ' + span.join(' ') : ''}>`;
    }
    return `<${tag}>`;
  });
  // Any stray angle brackets left over are escaped
  return html.replace(STRAY_LT, '&lt;')
    .replace(/(\s*\n){2,}/g, '\n');
}

// Pick the wiki page for an item from AlecaFrame's data
function pageFor(db, un) {
  const it = db.items.get(un);
  const fromUrl = u => (u && /\/w\/([^?#]+)/.exec(u) ? decodeURIComponent(/\/w\/([^?#]+)/.exec(u)[1]) : null);
  if (it && fromUrl(it.wikiaUrl)) return fromUrl(it.wikiaUrl);
  // Parts and blueprints are covered on the page of the item they build
  const comps = db.components.get(un);
  if (comps && comps.length && new Set(comps.map(c => c.parent.uniqueName)).size === 1) return pageFor(db, comps[0].parent.uniqueName);
  const b = db.basic.items && db.basic.items[un];
  if (b && b.wiki && !/^Blueprints?$/i.test(b.wiki)) return b.wiki;
  if (it && it.name) return it.name.replace(/<[^>]+>/g, '').trim().replace(/ /g, '_');
  return null;
}

module.exports = { Wiki, pageFor, sanitize };
