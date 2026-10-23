'use strict';
// Loads AlecaFrame's cached (plaintext) item database from cachedData/.
const fs = require('fs');
const path = require('path');

function readJson(file) {
  let s = fs.readFileSync(file, 'utf8');
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  // solNodes.json starts with // comment lines
  s = s.replace(/^\s*\/\/.*$/gm, '');
  return JSON.parse(s);
}

function tryReadJson(file, fallback) {
  try { return readJson(file); } catch { return fallback; }
}

function cleanName(s) {
  if (!s) return s;
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function prettifyPath(un) {
  const last = String(un).split('/').filter(Boolean).pop() || String(un);
  return last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}

// Warframe parts are listed as the crafted "...Component"; the tradable item is its "...Blueprint"
function bpOf(un) {
  return /Component$/.test(un) ? un.replace(/Component$/, 'Blueprint') : null;
}

function imageUrl(imageName) {
  if (!imageName) return null;
  if (/^https?:/i.test(imageName)) return imageName;
  return 'https://cdn.warframestat.us/img/' + imageName;
}

function loadDb(alecaDir) {
  const cache = path.join(alecaDir, 'cachedData');
  const jsonDir = path.join(cache, 'json');
  const customDir = path.join(cache, 'custom');

  const patches = tryReadJson(path.join(customDir, 'dataFilePatches.json'), {});
  const items = new Map();
  const files = fs.readdirSync(jsonDir).filter(f => f.endsWith('.json') && f !== 'lang.json');
  for (const f of files) {
    const fileKey = f.replace(/\.json$/, '');
    let list = tryReadJson(path.join(jsonDir, f), []);
    if (!Array.isArray(list)) continue;
    const p = patches[fileKey] || [];
    const removed = new Set(p.filter(x => x.type === 'Remove').map(x => x.uniqueName));
    const patchData = new Map(p.filter(x => x.type === 'Patch').map(x => [x.uniqueName, x.data]));
    for (const it of list) {
      if (!it || !it.uniqueName || removed.has(it.uniqueName)) continue;
      if (patchData.has(it.uniqueName)) Object.assign(it, patchData.get(it.uniqueName));
      it._file = fileKey;
      if (!items.has(it.uniqueName)) items.set(it.uniqueName, it);
    }
  }

  // Index components (prime parts, blueprints) back to their parent item.
  const components = new Map();
  for (const it of items.values()) {
    if (!Array.isArray(it.components)) continue;
    for (const c of it.components) {
      if (!c.uniqueName) continue;
      const keys = [c.uniqueName];
      if (bpOf(c.uniqueName)) keys.push(bpOf(c.uniqueName));
      for (const k of keys) {
        if (!components.has(k)) components.set(k, []);
        components.get(k).push({ parent: it, comp: c });
      }
    }
  }

  const basic = tryReadJson(path.join(customDir, 'basic.json'), { items: {}, nodeXP: {}, maxLevelOverrides: {} });
  const solNodes = tryReadJson(path.join(customDir, 'solNodes.json'), {});
  const rivens = tryReadJson(path.join(customDir, 'rivensV2.json'), {});

  function name(un) {
    if (!un) return '';
    const it = items.get(un);
    if (it && it.name) {
      // Components.json names parts bare ("Chassis"); qualify single-parent parts
      const parents = it._file === 'Components' && it.parentUniqueNames;
      if (parents && parents.length === 1 && items.get(parents[0])) {
        return cleanName(items.get(parents[0]).name + ' ' + it.name);
      }
      return cleanName(it.name);
    }
    const b = basic.items && basic.items[un];
    if (b && b.name) return cleanName(b.name);
    const comps = components.get(un);
    if (comps && comps.length) {
      const { parent, comp } = comps[0];
      // Shared resources (e.g. Orokin Cell) are named on their own
      if (comps.length > 1 && !comp.primeSellingPrice) return cleanName(comp.name);
      const bp = /Blueprint$/.test(un) && !/Blueprint$/.test(comp.uniqueName) ? ' Blueprint' : '';
      return cleanName(parent.name + ' ' + comp.name + bp);
    }
    return prettifyPath(un);
  }

  function image(un) {
    const it = items.get(un);
    if (it && it.imageName) return imageUrl(it.imageName);
    const comps = components.get(un);
    if (comps && comps.length && comps[0].comp.imageName) return imageUrl(comps[0].comp.imageName);
    return null;
  }

  function ducats(un) {
    const comps = components.get(un);
    if (!comps) return 0;
    for (const { comp } of comps) if (comp.primeSellingPrice) return comp.primeSellingPrice;
    return 0;
  }

  return { items, components, basic, solNodes, rivens, name, image, ducats };
}

module.exports = { loadDb, cleanName, prettifyPath, imageUrl, bpOf };
