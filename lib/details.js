'use strict';
// Item detail view: an item's own drop table plus the drop tables of every piece needed to build it.
const { cleanName } = require('./db');

// Shared crafting resources (Orokin Cell, Kuva, ...) have huge drop lists; they're shown collapsed.
const isResource = (db, un) => {
  const it = db.items.get(un);
  if (it && (it._file === 'Resources' || /\/MiscItems\//.test(un))) return true;
  const comps = db.components.get(un);
  return !!(comps && new Set(comps.map(c => c.parent.uniqueName)).size > 3);
};

function relicInfo(db, model) {
  const vaulted = new Map();
  for (const it of db.items.values()) {
    if (it._file !== 'Relics') continue;
    const m = cleanName(it.name).match(/^(\S+ \S+) (Intact|Exceptional|Flawless|Radiant)$/);
    if (m) vaulted.set(m[1], !!it.vaulted);
  }
  const owned = new Map();
  for (const r of model.relics) {
    const k = `${r.era} ${r.code}`;
    if (!owned.has(k)) owned.set(k, []);
    owned.get(k).push(`${r.count}× ${r.refinement}`);
  }
  return { vaulted, owned };
}

function ownedMap(model) {
  const m = new Map();
  for (const x of model.inventory) m.set(x.uniqueName, x.count);
  for (const x of model.equipment) m.set(x.uniqueName, (m.get(x.uniqueName) || 0) + 1);
  for (const x of model.mods) m.set(x.uniqueName, x.total);
  return m;
}

function drops(list, relics) {
  const seen = new Set();
  const byRelic = new Map();
  const out = [];
  for (const d of list || []) {
    const k = `${d.location}|${d.chance}|${d.type}`;
    if (seen.has(k)) continue;
    seen.add(k);
    // Relic drops are listed once per refinement: "Lith Q3 Relic", "Lith Q3 Relic (Radiant)", ...
    const rm = /^(.+) Relic(?: \((Exceptional|Flawless|Radiant)\))?$/.exec(d.location || '');
    if (!rm) { out.push({ location: d.location, chance: d.chance, rarity: d.rarity, type: d.type }); continue; }
    let e = byRelic.get(rm[1]);
    if (!e) {
      e = {
        location: rm[1] + ' Relic', chance: null, rarity: d.rarity, type: d.type, relic: rm[1], refinements: {},
        vaulted: relics.vaulted.get(rm[1]) ?? null, owned: relics.owned.get(rm[1]) || null,
      };
      byRelic.set(rm[1], e);
      out.push(e);
    }
    const ref = rm[2] || 'Intact';
    e.refinements[ref] = d.chance;
    if (ref === 'Intact') e.chance = d.chance;
  }
  for (const e of byRelic.values()) if (e.chance == null) e.chance = Math.min(...Object.values(e.refinements));
  return out
    // Owned relics first, then unvaulted relics, then by chance
    .sort((a, b) => (!!b.owned - !!a.owned) || ((a.vaulted === true) - (b.vaulted === true)) || (b.chance || 0) - (a.chance || 0));
}

function itemDetails(db, model, un, cache) {
  if (!cache.relics || cache.model !== model) {
    cache.model = model;
    cache.relics = relicInfo(db, model);
    cache.owned = ownedMap(model);
  }
  const { relics, owned } = cache;
  let it = db.items.get(un);
  const asComp = db.components.get(un);
  // A part or blueprint: describe it via its component entry and point to what it builds
  const compEntry = asComp && asComp[0].comp;
  if (!it && !compEntry) return null;

  const base = it || compEntry;
  const out = {
    uniqueName: un,
    name: db.name(un),
    image: db.image(un),
    category: it ? it.category || it._file : 'Component',
    type: base.type || '',
    description: cleanName(base.description || ''),
    vaulted: !!base.vaulted,
    masteryReq: base.masteryReq || 0,
    owned: owned.get(un) || 0,
    ducats: db.ducats(un),
    tradable: !!base.tradable,
    drops: drops(base.drops && base.drops.length ? base.drops : compEntry && compEntry.drops, relics),
    marketCost: base.marketCost || null,
    bpCost: base.bpCost || null,
    buildPrice: base.buildPrice || null,
    buildTime: base.buildTime || null,
    components: [],
    usedIn: [],
  };

  if (Array.isArray(base.components)) {
    for (const c of base.components) {
      const bp = /Component$/.test(c.uniqueName) ? c.uniqueName.replace(/Component$/, 'Blueprint') : null;
      const resource = isResource(db, c.uniqueName);
      out.components.push({
        uniqueName: c.uniqueName,
        name: resource ? cleanName(c.name) : db.name(c.uniqueName),
        need: c.itemCount || 1,
        owned: (owned.get(c.uniqueName) || 0) + (bp ? owned.get(bp) || 0 : 0),
        resource,
        ducats: c.primeSellingPrice || 0,
        // Resources keep their drop table on their own item entry
        drops: drops(c.drops && c.drops.length ? c.drops : (db.items.get(c.uniqueName) || {}).drops, relics),
      });
    }
  }

  if (asComp) {
    const seen = new Set();
    for (const { parent, comp } of asComp) {
      if (seen.has(parent.uniqueName)) continue;
      seen.add(parent.uniqueName);
      out.usedIn.push({ uniqueName: parent.uniqueName, name: cleanName(parent.name), need: comp.itemCount || 1 });
    }
    out.usedIn.sort((a, b) => a.name.localeCompare(b.name));
  }
  return out;
}

module.exports = { itemDetails };
