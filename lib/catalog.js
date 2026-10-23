'use strict';
// Item search for the Overview widget picker: stackable items, owned or not.
const FILES = new Set(['Resources', 'Misc', 'Gear', 'Fish', 'Relics', 'Components']);

function searchItems(db, model, q, limit = 25) {
  q = String(q || '').trim().toLowerCase();
  if (!q) return [];
  const found = new Map();
  for (const x of [...model.inventory, ...model.relics]) {
    if (x.name.toLowerCase().includes(q)) found.set(x.uniqueName, { uniqueName: x.uniqueName, name: x.name, image: x.image, owned: x.count });
  }
  for (const it of db.items.values()) {
    if (!FILES.has(it._file) || found.has(it.uniqueName)) continue;
    const name = db.name(it.uniqueName);
    if (name.toLowerCase().includes(q)) found.set(it.uniqueName, { uniqueName: it.uniqueName, name, image: db.image(it.uniqueName), owned: 0 });
  }
  // Owned first, then names starting with the query, then shortest names
  const rank = x => [x.owned > 0 ? 0 : 1, x.name.toLowerCase().startsWith(q) ? 0 : 1, x.name.length];
  return [...found.values()].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2] || a.name.localeCompare(b.name);
  }).slice(0, limit);
}

module.exports = { searchItems };
