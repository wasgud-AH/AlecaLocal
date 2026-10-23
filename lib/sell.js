'use strict';
// Works out which owned items are spare and worth selling, using warframe.market prices.

const REFINEMENT_SUFFIX = /(Bronze|Silver|Gold|Platinum)$/;
// Copies needed to reach rank r for arcanes: 1 + 2 + ... + (r + 1)
const arcaneCopies = r => ((r + 1) * (r + 2)) / 2;

// Candidates are built without prices so the server knows which prices to fetch.
function candidates(model, market) {
  const out = [];
  const seen = new Set();
  const push = c => { if (c.excess > 0) out.push(c); seen.add(c.uniqueName); };

  // Prime parts and sets
  for (const p of model.primes) {
    const wantToBuild = !p.ownedItem && !p.mastered;
    const parts = [];
    for (const c of p.components) {
      const m = market.lookup(c.tradeUniqueName);
      const crafted = c.owned - c.tradable; // already-crafted parts count toward the build but can't be sold
      const keep = wantToBuild ? Math.max(0, Math.min(c.tradable, c.need - crafted)) : 0;
      const part = {
        kind: 'Prime part', uniqueName: c.tradeUniqueName, name: m ? m.name : `${p.name} ${c.name}`,
        slug: m && m.slug, opts: {}, owned: c.tradable, keep, excess: c.tradable - keep, ducats: c.ducats,
        need: c.need, set: p.uniqueName,
        why: wantToBuild ? `Keeping ${keep} to build ${p.name}` : (p.mastered ? `${p.name} mastered` : `${p.name} owned`),
        priority: 0,
      };
      parts.push(part);
      push(part);
    }
    const sets = Math.min(...parts.map(x => Math.floor(Math.max(0, x.excess) / x.need)));
    const sm = market.lookup(p.uniqueName);
    if (sets > 0 && sm && sm.tags.includes('set')) {
      out.push({
        kind: 'Prime set', uniqueName: p.uniqueName + '#set', name: sm.name, slug: sm.slug, opts: {},
        owned: sets, keep: 0, excess: sets, ducats: parts.reduce((s, x) => s + x.ducats * x.need, 0),
        parts: parts.map(x => ({ uniqueName: x.uniqueName, need: x.need })),
        why: `Spare parts make ${sets} full set${sets > 1 ? 's' : ''}`, priority: 0,
      });
    }
  }

  // Mods & arcanes: only unranked copies are sold
  for (const mod of model.mods) {
    const m = market.lookup(mod.uniqueName);
    if (!m || !mod.unranked) continue;
    const maxRank = mod.maxRank || m.maxRank || 0;
    let keep, why;
    if (mod.isArcane) {
      const have = mod.unranked + mod.ranked.reduce((s, r) => s + arcaneCopies(r), 0);
      const target = arcaneCopies(maxRank);
      const excess = Math.min(mod.unranked, Math.max(0, have - target));
      keep = mod.unranked - excess;
      why = `Keeping enough for one rank ${maxRank} (${target} copies)`;
    } else {
      keep = mod.ranked.length ? 0 : 1;
      why = mod.ranked.length ? 'You have a ranked copy' : 'Keeping 1 copy';
    }
    push({
      kind: mod.isArcane ? 'Arcane' : 'Mod', uniqueName: mod.uniqueName, name: m.name, slug: m.slug,
      opts: { rank: 0 }, owned: mod.unranked, keep, excess: mod.unranked - keep, ducats: 0, why,
      priority: mod.isArcane ? 1 : 3,
    });
  }

  // Relics
  for (const r of model.relics) {
    const m = market.lookup(r.uniqueName.replace(REFINEMENT_SUFFIX, ''));
    if (!m) continue;
    push({
      kind: 'Relic', uniqueName: r.uniqueName, name: `${m.name} (${r.refinement || 'Intact'})`, slug: m.slug,
      opts: { subtype: (r.refinement || 'intact').toLowerCase() }, owned: r.count, keep: 0, excess: r.count,
      ducats: 0, why: r.vaulted ? 'Vaulted relic' : 'Relic', priority: 2,
    });
  }

  // Anything else in the inventory that is listed on warframe.market (parts, lenses, Ayatan, gems, ...)
  const mastery = new Map(model.mastery.map(x => [x.uniqueName, x]));
  for (const it of model.inventory) {
    if (seen.has(it.uniqueName) || it.category === 'Prime Parts') continue;
    const m = market.lookup(it.uniqueName);
    if (!m || m.tags.includes('set')) continue;
    let keep = 0, why = it.category;
    const target = it.builds && mastery.get(it.builds.uniqueName);
    if (target && target.status !== 'mastered' && !target.owned) {
      keep = Math.min(it.count, it.builds.need);
      why = `Keeping ${keep} to build ${target.name}`;
    } else if (target) {
      why = `${target.name} ${target.status === 'mastered' ? 'mastered' : 'owned'}`;
    }
    const kind = m.tags.includes('ayatan_sculpture') || m.tags.includes('ayatan_star') ? 'Ayatan'
      : m.tags.includes('component') || m.tags.includes('blueprint') ? 'Part / blueprint'
      : m.tags.includes('lens') ? 'Focus lens' : m.tags.includes('scene') ? 'Captura scene' : 'Other';
    push({
      kind, uniqueName: it.uniqueName, name: m.name, slug: m.slug, opts: {}, owned: it.count, keep,
      excess: it.count - keep, ducats: 0, why, priority: 2,
    });
  }

  return out.filter(c => c.slug);
}

function priceRequests(cands) {
  return [...cands].sort((a, b) => a.priority - b.priority).map(c => ({ slug: c.slug, ...c.opts }));
}

// Recent traded price, never above the cheapest listing you'd compete with.
// Without trade history, only trust a buy order or a listing price that several sellers agree on.
function unitValue(p) {
  if (!p) return null;
  let v;
  if (p.traded != null) v = p.sell != null ? Math.min(p.traded, p.sell) : p.traded;
  else if (p.buy != null) v = p.buy;
  else if (p.sellers >= 3) v = p.sell;
  else return null;
  return Math.round(v * 10) / 10;
}

function recommend(cands, market) {
  const rows = cands.map(c => {
    const p = market.price(c.slug, c.opts);
    return { ...c, price: p, value: unitValue(p) };
  });

  // Sell spare parts as a set when the set is worth more than its parts
  const byUn = new Map(rows.filter(r => r.kind === 'Prime part').map(r => [r.uniqueName, r]));
  for (const s of rows.filter(r => r.kind === 'Prime set')) {
    const parts = s.parts.map(x => ({ ...x, row: byUn.get(x.uniqueName) }));
    const partsValue = parts.every(x => x.row && x.row.value != null)
      ? parts.reduce((t, x) => t + x.row.value * x.need, 0) : null;
    if (s.value != null && (partsValue == null || s.value >= partsValue)) {
      s.why += partsValue != null ? ` · set ${s.value}p vs parts ${partsValue}p` : '';
      for (const x of parts) if (x.row) {
        x.row.excess -= s.excess * x.need;
        x.row.why += ` · ${s.excess * x.need} go into the set`;
      }
    } else {
      s.excess = 0;
    }
  }

  return rows.filter(r => r.excess > 0).map(r => {
    let verdict;
    if (!r.price) verdict = 'pending';
    else if (r.value == null) verdict = 'no-market';
    else if (r.ducats && r.ducats / Math.max(r.value, 1) >= 15) verdict = 'ducats';
    else if (r.value < 3) verdict = 'low';
    else verdict = 'sell';
    return {
      kind: r.kind, name: r.name, slug: r.slug, uniqueName: r.uniqueName, owned: r.owned, keep: r.keep,
      excess: r.excess, ducats: r.ducats, why: r.why, verdict,
      value: r.value, sell: r.price && r.price.sell, buy: r.price && r.price.buy,
      sellers: r.price ? r.price.sellers : null, buyers: r.price ? r.price.buyers : null,
      traded: r.price && r.price.traded, volume: r.price ? r.price.volume : null,
      total: r.value != null ? Math.round(r.value * r.excess) : null,
      totalDucats: r.ducats * r.excess,
      priceAt: r.price && r.price.at,
      url: `https://warframe.market/items/${r.slug}`,
    };
  });
}

module.exports = { candidates, priceRequests, recommend };
