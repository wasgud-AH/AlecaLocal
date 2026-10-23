'use strict';
/* AlecaLocal front-end: renders /api/model into tabbed views. */

const TABS = [
  ['overview', 'Overview'], ['equipment', 'Equipment'], ['mastery', 'Mastery'], ['relics', 'Relics'],
  ['primes', 'Prime Sets'], ['crafting', 'Weapon Recipes'], ['sell', 'Sell'], ['mods', 'Mods & Arcanes'], ['rivens', 'Rivens'], ['inventory', 'Inventory'],
  ['starchart', 'Star Chart'], ['recent', 'Recent Gains'],
];

const store = {
  get(k, d) { try { const v = localStorage.getItem('al.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('al.' + k, JSON.stringify(v)); } catch {} },
};

const S = {
  model: null,
  tab: store.get('tab', 'overview'),
  q: '',
  images: store.get('images', true),
  f: store.get('filters', {}), // per-tab filter state
  sort: {},
  sell: null, // { rows, status } from /api/sell
  widgets: store.get('widgets', []), // tracked items on Overview: [{ un, name, image, goal }]
};

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => (n == null ? '—' : Number(n).toLocaleString());
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const fdate = t => (t ? new Date(t).toLocaleString() : '—');
const match = (...xs) => !S.q || xs.some(x => String(x ?? '').toLowerCase().includes(S.q));

function filt(key, def) { const t = S.f[S.tab] || {}; return key in t ? t[key] : def; }
function setFilt(key, val) { S.f[S.tab] = { ...(S.f[S.tab] || {}), [key]: val }; store.set('filters', S.f); render(); }

function img(url, label) {
  if (S.images && url) return `<img loading="lazy" src="${esc(url)}" alt="" onerror="this.outerHTML='<div class=thumb>${esc((label || '?')[0])}</div>'">`;
  return `<div class="thumb">${esc((label || '?')[0])}</div>`;
}

// Name that opens the item detail dialog (drop tables for the item and its parts)
function link(un, text) {
  if (!un) return esc(text);
  return `<a class="item" data-item="${esc(un)}">${esc(text)}</a>`;
}

function chips(key, options, def) {
  const cur = filt(key, def);
  return options.map(([v, l]) => `<span class="chip ${cur === v ? 'on' : ''}" data-f="${esc(key)}" data-v="${esc(JSON.stringify(v))}">${esc(l)}</span>`).join('');
}

function countBar(shown, total) { return `<span class="count">${num(shown)} of ${num(total)}</span>`; }

function sortRows(rows, key, cols) {
  const s = S.sort[key];
  if (!s) return rows;
  const col = cols.find(c => c.k === s.k);
  const get = col.sortVal || (r => r[s.k]);
  return [...rows].sort((a, b) => {
    const x = get(a), y = get(b);
    const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
    return s.dir * r;
  });
}

// cols: [{k, l, n (numeric), r (render fn), sortVal}]
function table(key, rows, cols) {
  rows = sortRows(rows, key, cols);
  const s = S.sort[key] || {};
  const head = cols.map(c => `<th class="${c.n ? 'n' : ''}" data-sort="${key}|${c.k}">${esc(c.l)}${s.k === c.k ? (s.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
  const body = rows.slice(0, 2000).map(r => `<tr>${cols.map(c => `<td class="${c.n ? 'n' : ''}">${c.r ? c.r(r) : esc(r[c.k])}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>${rows.length ? '' : '<div class="empty">Nothing matches.</div>'}`;
}

function downloadCsv(name, rows, cols) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [cols.map(c => q(c[1])).join(','), ...rows.map(r => cols.map(c => q(r[c[0]])).join(','))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------------- views ---------------- */

const V = {};

V.overview = m => {
  const a = m.account, ms = a.mastery;
  const stat = (k, v, s = '') => `<div class="stat"><div class="k">${esc(k)}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  const slot = (l, b) => b ? `<tr><td>${l}</td><td class="n">${num(b.Slots)}</td><td class="n">${num(b.Extra)}</td></tr>` : '';
  const now = Date.now();
  const foundry = a.pendingRecipes.length ? a.pendingRecipes.map(r => {
    const left = r.completes - now;
    return `<tr><td>${esc(r.name)}</td><td class="n">${left <= 0 ? '<span class="tag good">Ready</span>' : esc(dur(left))}</td></tr>`;
  }).join('') : '<tr><td class="muted">Nothing building</td></tr>';
  return `${widgetRow(m)}
  <div class="stats">
    ${stat('Mastery Rank', esc(a.masteryRank ?? '—'))}
    ${stat('Platinum', num(a.platinum))}
    ${stat('Credits', num(a.credits))}
    ${stat('Endo', num(a.endo))}
    ${stat('Ducats', num(a.ducats))}
    ${stat('Aya', num(a.aya), `Regal Aya: ${num(a.regalAya)}`)}
    ${stat('Forma', num(a.forma), `Umbra ${num(a.formaUmbra)} · Aura ${num(a.formaAura)} · Stance ${num(a.formaStance)}`)}
    ${stat('Trades left today', num(a.tradesRemaining), `Gifts: ${num(a.giftsRemaining)}`)}
    ${stat('Daily standing left', num(a.dailyStanding), `Focus left: ${num(a.dailyFocus)}`)}
    ${stat('Items mastered', `${num(ms.itemsMastered)} / ${num(ms.itemsTotal)}`, `${pct(ms.itemsMastered, ms.itemsTotal)}%`)}
    ${stat('Star chart', `${num(ms.nodesDone)} / ${num(ms.totalNodes)}`, `Steel Path: ${num(ms.spNodesDone)}`)}
    ${stat('Rivens', num(m.rivens.length), `Veiled: ${num(m.veiledRivens)}`)}
  </div>
  <div class="cols" style="margin-top:16px">
    <div class="panel"><h2 style="margin-top:0">Foundry</h2><table>${foundry}</table>
      ${a.boosters.length ? `<h2>Active boosters</h2><table>${a.boosters.map(b => `<tr><td>${esc(b.name)}</td><td class="n">${esc(dur(b.expires - now))}</td></tr>`).join('')}</table>` : ''}
    </div>
    <div class="panel"><h2 style="margin-top:0">Last mission</h2>
      <div class="kv"><span class="k">Credits</span><span>${num(a.lastMission.credits)}</span></div>
      <ul class="rewards">${a.lastMission.rewards.map(r => `<li><span>${esc(r.name)}</span><span>×${num(r.count)}</span></li>`).join('') || '<li class="muted">No rewards recorded</li>'}</ul>
      <ul class="rewards">${a.lastMission.standing.map(r => `<li><span>${esc(r.name)}</span><span class="pos">+${num(r.standing)}</span></li>`).join('')}</ul>
    </div>
    <div class="panel"><h2 style="margin-top:0">Focus</h2><table>${a.focus.map(f => `<tr><td>${esc(f.school)}</td><td class="n">${num(f.xp)}</td></tr>`).join('')}</table>
      <h2>Intrinsics</h2><table>${a.intrinsics.map(i => `<tr><td>${esc(i.group)}</td><td>${esc(i.name)}</td><td class="n">${num(i.level)}</td></tr>`).join('')}</table>
    </div>
    <div class="panel"><h2 style="margin-top:0">Syndicates</h2>${syndicateTable(a.affiliations)}</div>
    <div class="panel"><h2 style="margin-top:0">Slots</h2>
      <table><tr><th>Type</th><th class="n">Free</th><th class="n">Purchased</th></tr>
      ${slot('Warframe', a.slots.warframe)}${slot('Weapon', a.slots.weapon)}${slot('Companion', a.slots.sentinel)}${slot('Riven', a.slots.riven)}${slot('Amp', a.slots.amp)}</table>
      <h2>Account</h2><div class="kv">
        ${a.username ? `<span class="k">Username</span><span>${esc(a.username)}</span>` : ''}
        <span class="k">Created</span><span>${fdate(a.created)}</span>
        <span class="k">Last region</span><span>${esc(a.lastRegion || '—')}</span>
        <span class="k">Data file updated</span><span>${fdate(m.files.lastData && m.files.lastData.modified)}</span>
      </div>
      <div class="bar"><a href="/api/export?file=lastData"><button>Export lastData.json</button></a><a href="/api/export?file=deltas"><button>Export deltas.json</button></a></div>
    </div>
  </div>`;
};

/* ---------------- tracked-item widgets ---------------- */

function ownedCount(m, un) {
  const x = m.inventory.find(i => i.uniqueName === un) || m.relics.find(r => r.uniqueName === un);
  return x ? x.count : 0;
}

function widgetRow(m) {
  const card = (w, i) => {
    const n = ownedCount(m, w.un);
    const d = m.deltas.find(x => x.uniqueName === w.un);
    return `<div class="stat widget" draggable="true" tabindex="0" data-widx="${i}" title="Drag, or Alt+←/→, to reorder">
      <button class="wdel" data-wdel="${i}" title="Stop tracking" aria-label="Stop tracking ${esc(w.name)}">×</button>
      <div class="whead">${img(w.image, w.name)}<div class="k">${link(w.un, w.name)}</div></div>
      <div class="v">${num(n)}${w.goal ? `<span class="muted" style="font-size:14px;font-weight:400"> / ${num(w.goal)}</span>` : ''}</div>
      ${w.goal ? `<div class="meter"><i class="${n >= w.goal ? 'full' : ''}" style="width:${Math.min(100, pct(n, w.goal))}%"></i></div>` : ''}
      <div class="s">${d ? `<span class="${d.delta < 0 ? 'neg' : 'pos'}">${d.delta > 0 ? '+' : ''}${num(d.delta)} recently</span> · ` : ''}<a class="item" data-wgoal="${i}">${w.goal ? 'Edit goal' : 'Set goal'}</a></div>
    </div>`;
  };
  return `<h2 style="margin-top:4px">Tracked items</h2>
  <div class="stats" style="margin-bottom:16px">${S.widgets.map(card).join('')}<button class="stat wadd" id="widgetAdd">+ Track an item</button></div>`;
}

function saveWidgets(focusIdx) {
  store.set('widgets', S.widgets);
  render();
  if (focusIdx != null) { const el = document.querySelector(`[data-widx="${focusIdx}"]`); if (el) el.focus(); }
}

function moveWidget(from, to) {
  if (to < 0 || to >= S.widgets.length || from === to) return;
  const [w] = S.widgets.splice(from, 1);
  S.widgets.splice(to, 0, w);
  saveWidgets(to);
}

let pickTimer, pickSeq = 0, pickRows = [];
function openPicker() {
  $('#pickQ').value = '';
  $('#pickList').innerHTML = '<div class="empty">Type an item name, e.g. Moonflesh.</div>';
  $('#widgetPicker').showModal();
  $('#pickQ').focus();
}

async function searchPick(q) {
  const seq = ++pickSeq;
  if (!q) { $('#pickList').innerHTML = ''; return; }
  try {
    const r = await fetch('/api/catalog?q=' + encodeURIComponent(q));
    const rows = await r.json();
    if (!r.ok) throw new Error(rows.error || r.statusText);
    if (seq !== pickSeq) return; // a newer search is on its way
    pickRows = rows;
    const tracked = new Set(S.widgets.map(w => w.un));
    $('#pickList').innerHTML = rows.length ? `<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(220px,1fr))">${rows.map((x, i) =>
      `<div class="card click" data-pick="${i}">${img(x.image, x.name)}<div class="body"><div class="t">${esc(x.name)}</div>
        <div class="m">${x.owned ? `Own ${num(x.owned)}` : 'Not owned'}${tracked.has(x.uniqueName) ? ' · <span class="pos">tracked</span>' : ''}</div></div></div>`).join('')}</div>`
      : '<div class="empty">No items match.</div>';
  } catch (e) {
    if (seq === pickSeq) $('#pickList').innerHTML = `<div class="empty">Search failed: ${esc(e.message)}</div>`;
  }
}

$('#pickQ').addEventListener('input', e => { clearTimeout(pickTimer); pickTimer = setTimeout(() => searchPick(e.target.value.trim()), 150); });

document.addEventListener('click', e => {
  if (e.target.id === 'widgetPicker' || e.target.id === 'pickClose') { $('#widgetPicker').close(); return; }
  const t = e.target.closest('#widgetAdd,[data-wdel],[data-wgoal],[data-pick]');
  if (!t) return;
  if (t.id === 'widgetAdd') openPicker();
  else if (t.dataset.wdel) { S.widgets.splice(+t.dataset.wdel, 1); saveWidgets(); }
  else if (t.dataset.wgoal) {
    const w = S.widgets[+t.dataset.wgoal];
    const v = prompt(`Goal for ${w.name} (leave empty for none)`, w.goal || '');
    if (v === null) return;
    w.goal = parseInt(v.replace(/\D/g, ''), 10) || 0;
    saveWidgets();
  } else if (t.dataset.pick) {
    const x = pickRows[+t.dataset.pick];
    if (!S.widgets.some(w => w.un === x.uniqueName)) S.widgets.push({ un: x.uniqueName, name: x.name, image: x.image, goal: 0 });
    $('#widgetPicker').close();
    saveWidgets();
  }
});

let dragIdx = null;
const clearDrop = () => document.querySelectorAll('.wover,.dragging').forEach(x => x.classList.remove('wover', 'dragging'));
document.addEventListener('dragstart', e => {
  const w = e.target.closest && e.target.closest('[data-widx]');
  if (!w) return;
  dragIdx = +w.dataset.widx;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', ''); // Firefox won't start a drag without data
  w.classList.add('dragging');
});
document.addEventListener('dragover', e => {
  const w = dragIdx != null && e.target.closest && e.target.closest('[data-widx]');
  if (!w) return;
  e.preventDefault();
  document.querySelectorAll('.wover').forEach(x => x !== w && x.classList.remove('wover'));
  w.classList.add('wover');
});
document.addEventListener('drop', e => {
  const w = dragIdx != null && e.target.closest && e.target.closest('[data-widx]');
  if (!w) return;
  e.preventDefault();
  const from = dragIdx;
  dragIdx = null;
  clearDrop();
  moveWidget(from, +w.dataset.widx);
});
document.addEventListener('dragend', () => { dragIdx = null; clearDrop(); });
document.addEventListener('keydown', e => {
  const w = e.target.dataset && e.target.dataset.widx;
  if (w == null || !e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
  e.preventDefault();
  moveWidget(+w, +w + (e.key === 'ArrowLeft' ? -1 : 1));
});

function syndicateTable(list) {
  const groups = [...new Set(list.map(s => s.group))];
  const row = s => {
    const status = s.maxed ? '<span class="tag good">Maxed</span>'
      : s.title < 0 ? '<span class="tag bad">Hostile</span>'
      : s.rankCap != null && s.rankStanding >= s.rankCap ? '<span class="tag gold">Ready to rank up</span>' : '';
    const standing = s.rankCap != null
      ? `${num(s.rankStanding)} / ${num(s.rankCap)}<div class="meter"><i class="${s.rankStanding >= s.rankCap ? 'full' : ''}" style="width:${Math.max(0, Math.min(100, pct(s.rankStanding, s.rankCap)))}%"></i></div>`
      : `<span class="${s.standing < 0 ? 'neg' : ''}">${s.standing ? num(s.standing) : '—'}</span>`;
    return `<tr><td>${esc(s.name)}</td><td class="n">${num(s.title)}${s.maxRank != null ? ` / ${s.maxRank}` : ''}</td>
      <td class="n">${standing}</td><td>${status}</td></tr>`;
  };
  return groups.map(g => {
    const rows = list.filter(s => s.group === g);
    const maxed = rows.filter(s => s.maxed).length;
    return `<h2 style="font-size:13px;margin:12px 0 4px">${esc(g)} <span class="muted" style="font-weight:400">· ${maxed}/${rows.length} maxed</span></h2>
      <table><tr><th>Syndicate</th><th class="n">Rank</th><th class="n">Standing in rank</th><th></th></tr>${rows.map(row).join('')}</table>`;
  }).join('');
}

function dur(ms) {
  if (ms <= 0) return 'done';
  const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, mi = Math.floor(ms / 6e4) % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${mi}m` : `${mi}m`;
}

function categoryChips(rows, key = 'cat') {
  const cats = [...new Set(rows.map(r => r.category))].sort();
  return chips(key, [['all', 'All'], ...cats.map(c => [c, c])], 'all');
}

V.equipment = m => {
  const cat = filt('cat', 'all'), st = filt('st', 'all');
  const rows = m.equipment.filter(e => (cat === 'all' || e.category === cat)
    && (st === 'all' || (st === 'needed' ? e.neededFor.length > 0 : st === 'mastered' ? e.mastered : !e.mastered))
    && match(e.name, e.customName, e.category));
  const sortBy = filt('sort', 'name');
  rows.sort(sortBy === 'rank' ? (a, b) => b.rank - a.rank : sortBy === 'forma' ? (a, b) => b.forma - a.forma : (a, b) => a.name.localeCompare(b.name));
  return `<div class="bar">${categoryChips(m.equipment)}</div>
  <div class="bar">${chips('st', [['all', 'Any'], ['mastered', 'Mastered'], ['unmastered', 'Not mastered'], ['needed', 'Needed for crafting']], 'all')}
    <select data-fsel="sort">${[['name', 'Sort: name'], ['rank', 'Sort: rank'], ['forma', 'Sort: forma']].map(([v, l]) => `<option value="${v}" ${sortBy === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    ${countBar(rows.length, m.equipment.length)}</div>
  <div class="grid">${rows.map(e => `<div class="card ${e.mastered ? 'mastered' : ''}">${img(e.image, e.name)}<div class="body">
    <div class="t" title="${esc(e.name)}">${link(e.uniqueName, e.customName || e.name)}</div>
    <div class="m">${esc(e.category)} · Rank ${e.rank}/${e.maxRank}${e.forma ? ` · ${e.forma} forma` : ''}</div>
    <div>${e.mastered ? '<span class="tag good">Mastered</span>' : ''}${e.isPrime ? '<span class="tag gold">Prime</span>' : ''}${e.archonShards.length ? `<span class="tag">${e.archonShards.length} shards</span>` : ''}</div>
    ${e.neededFor.length ? `<div class="m" title="Crafting these uses up this weapon">Keep for: ${e.neededFor.map(n => link(n.uniqueName, n.name) + (n.need > 1 ? ` (needs ${n.need})` : '')).join(', ')}</div>` : ''}
    <div class="meter"><i class="${e.rank >= e.maxRank ? 'full' : ''}" style="width:${pct(e.rank, e.maxRank)}%"></i></div>
  </div></div>`).join('')}</div>${rows.length ? '' : '<div class="empty">Nothing matches.</div>'}`;
};

V.mastery = m => {
  const cat = filt('cat', 'all'), st = filt('st', 'todo'), own = filt('own', 'any');
  const rows = m.mastery.filter(x => (cat === 'all' || x.category === cat)
    && (st === 'all' || (st === 'todo' ? x.status !== 'mastered' : x.status === st))
    && (own === 'any' || (own === 'owned' ? x.owned > 0 : x.owned === 0))
    && match(x.name, x.category, x.type));
  const remaining = rows.reduce((s, x) => s + (x.masteryTotal - x.masteryEarned), 0);
  const cols = [
    { k: 'name', l: 'Item', r: x => `${link(x.uniqueName, x.name)} ${x.isPrime ? '<span class="tag gold">Prime</span>' : ''}${x.vaulted ? '<span class="tag warn">Vaulted</span>' : ''}` },
    { k: 'category', l: 'Category' },
    { k: 'status', l: 'Status', r: x => x.status === 'mastered' ? '<span class="tag good">Mastered</span>' : x.status === 'leveling' ? '<span class="tag warn">Leveling</span>' : '<span class="tag">Unranked</span>' },
    { k: 'rank', l: 'Rank', n: 1, r: x => `${x.rank}/${x.maxRank}` },
    { k: 'owned', l: 'Owned', n: 1, r: x => x.owned ? '✔' : '' },
    { k: 'masteryReq', l: 'MR req', n: 1 },
    { k: 'left', l: 'Mastery XP left', n: 1, sortVal: x => x.masteryTotal - x.masteryEarned, r: x => num(x.masteryTotal - x.masteryEarned) },
  ];
  return `<div class="bar">${categoryChips(m.mastery)}</div>
  <div class="bar">${chips('st', [['todo', 'Not mastered'], ['unranked', 'Never used'], ['leveling', 'Leveling'], ['mastered', 'Mastered'], ['all', 'All']], 'todo')}
    ${chips('own', [['any', 'Owned or not'], ['owned', 'Owned'], ['notowned', 'Not owned']], 'any')}
    <button id="csvMastery">Export CSV</button>
    <span class="count">${num(rows.length)} items · ${num(remaining)} mastery XP available</span></div>
  ${table('mastery', rows, cols)}`;
};

V.relics = m => {
  const era = filt('era', 'all'), ref = filt('ref', 'all'), vault = filt('vault', 'all');
  const eras = [...new Set(m.relics.map(r => r.era))].sort();
  const rows = m.relics.filter(r => (era === 'all' || r.era === era) && (ref === 'all' || r.refinement === ref)
    && (vault === 'all' || (vault === 'vaulted' ? r.vaulted : !r.vaulted))
    && match(r.name, ...r.rewards.map(x => x.name)));
  rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const total = rows.reduce((s, r) => s + r.count, 0);
  return `<div class="bar">${chips('era', [['all', 'All eras'], ...eras.map(e => [e, e])], 'all')}</div>
  <div class="bar">${chips('ref', [['all', 'Any refinement'], ['Intact', 'Intact'], ['Exceptional', 'Exceptional'], ['Flawless', 'Flawless'], ['Radiant', 'Radiant']], 'all')}
  ${chips('vault', [['all', 'All'], ['vaulted', 'Vaulted'], ['unvaulted', 'Available']], 'all')}
  <span class="count">${num(rows.length)} kinds · ${num(total)} relics</span></div>
  <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">${rows.map(r => `<div class="card relic">
    <div class="head">${img(r.image, r.era)}<div class="body"><div class="t">${esc(r.name)} <span class="muted">×${r.count}</span></div>
      <div>${r.vaulted ? '<span class="tag warn">Vaulted</span>' : '<span class="tag good">Available</span>'}</div></div></div>
    <ul class="rewards">${r.rewards.sort((a, b) => b.chance - a.chance).map(x => `<li><span class="r-${esc(x.rarity)}">${link(x.uniqueName, x.name)}</span>
      <span class="muted">${x.owned ? `<span class="tag good">own ${x.owned}</span>` : ''}${x.ducats ? x.ducats + 'd · ' : ''}${x.chance}%</span></li>`).join('')}</ul>
  </div>`).join('')}</div>${rows.length ? '' : '<div class="empty">Nothing matches.</div>'}`;
};

V.primes = m => {
  const st = filt('st', 'parts'), cat = filt('cat', 'all');
  const rows = m.primes.filter(p => (cat === 'all' || p.category === cat)
    && (st === 'all' || (st === 'sets' ? p.fullSets > 0 : st === 'parts' ? p.partsOwned > 0 : st === 'missing' ? !p.ownedItem && !p.mastered : true))
    && match(p.name, p.category));
  rows.sort((a, b) => b.fullSets - a.fullSets || b.partsOwned - a.partsOwned || a.name.localeCompare(b.name));
  const ducatsAll = m.primes.reduce((s, p) => s + p.partsDucats, 0);
  return `<div class="bar">${categoryChips(m.primes)}</div>
  <div class="bar">${chips('st', [['parts', 'Have parts'], ['sets', 'Full sets'], ['missing', 'Not owned / not mastered'], ['all', 'All']], 'parts')}
    <span class="count">${num(rows.length)} primes · all owned parts worth ${num(ducatsAll)} ducats</span></div>
  <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${rows.map(p => `<div class="card relic">
    <div class="head">${img(p.image, p.name)}<div class="body"><div class="t">${link(p.uniqueName, p.name)}</div>
      <div>${p.fullSets ? `<span class="tag good">${p.fullSets} full set${p.fullSets > 1 ? 's' : ''}</span>` : ''}${p.ownedItem ? '<span class="tag">Owned</span>' : ''}${p.mastered ? '<span class="tag good">Mastered</span>' : ''}${p.vaulted ? '<span class="tag warn">Vaulted</span>' : ''}
      ${p.partsDucats ? `<span class="tag gold">${num(p.partsDucats)} ducats</span>` : ''}</div></div></div>
    <ul class="rewards">${p.components.map(c => `<li><span class="${c.owned >= c.need ? 'pos' : 'muted'}">${link(c.tradeUniqueName || c.uniqueName, c.name)}${c.need > 1 ? ` ×${c.need}` : ''}</span>
      <span title="${esc(c.relics.map(r => `${r.relic} (${r.rarity})`).join('\n'))}">${c.owned}/${c.need} · ${c.ducats}d</span></li>`).join('')}</ul>
  </div>`).join('')}</div>${rows.length ? '' : '<div class="empty">Nothing matches.</div>'}`;
};

V.crafting = m => {
  const st = filt('st', 'todo');
  const todo = c => !c.owned && c.status !== 'mastered';
  const rows = m.craftChains.filter(c => (st === 'all' || (st === 'todo' ? todo(c) : st === 'ready' ? todo(c) && c.ready : !todo(c)))
    && match(c.name, c.category, ...c.requires.map(r => r.name)));
  const statusTag = c => c.status === 'mastered' ? '<span class="tag good">Mastered</span>'
    : c.owned ? '<span class="tag">Owned</span>'
    : c.ready ? '<span class="tag gold">Ready to build</span>'
    : c.weaponsReady ? '<span class="tag warn">Weapons ready · missing other materials</span>'
    : `<span class="tag bad">Missing weapons</span>${c.materialsReady ? '' : '<span class="tag warn">Missing other materials</span>'}`;
  const material = x => `<li><span>${x.uniqueName ? link(x.uniqueName, x.name) : esc(x.name)}${x.need > 1 ? ` ×${num(x.need)}` : ''}</span>
    <span class="neg">have ${num(x.owned)}/${num(x.need)}</span></li>`;
  const req = r => {
    const have = r.owned >= r.need;
    const note = r.owned && r.status !== 'mastered' ? ' <span class="tag warn">level it first</span>'
      : r.status === 'mastered' ? ' <span class="tag good">mastered</span>' : '';
    return `<li><span>${link(r.uniqueName, r.name)}${r.need > 1 ? ` ×${r.need}` : ''}${note}
        ${r.madeFrom ? `<div class="muted" style="font-size:11px">made from ${esc(r.madeFrom.join(' + '))}</div>` : ''}</span>
      <span class="${have ? 'pos' : 'neg'}">have ${r.owned}/${r.need}</span></li>`;
  };
  return `<div class="bar">${chips('st', [['todo', 'Not built yet'], ['ready', 'Ready to build'], ['done', 'Owned or mastered'], ['all', 'All']], 'todo')}
    ${countBar(rows.length, m.craftChains.length)}</div>
  <p class="muted" style="font-size:12px;margin:0 0 10px">These items use up other weapons when crafted. Mastery from a consumed weapon is kept, so level each one to 30 before using it.
    "Ready to build" also needs the blueprint, every other part and resource, and the credits.</p>
  <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${rows.map(c => `<div class="card relic">
    <div class="head">${img(c.image, c.name)}<div class="body"><div class="t">${link(c.uniqueName, c.name)}</div>
      <div class="m">${esc(c.category)}</div><div>${statusTag(c)}</div></div></div>
    <div class="muted" style="font-size:11px;margin-top:6px">Weapons</div>
    <ul class="rewards" style="margin-top:0">${c.requires.map(req).join('')}</ul>
    ${c.status !== 'mastered' && !c.owned && !c.materialsReady ? `<div class="muted" style="font-size:11px;margin-top:6px">Other materials still missing</div>
    <ul class="rewards" style="margin-top:0">${c.materials.filter(x => x.owned < x.need).map(material).join('')}</ul>` : ''}
  </div>`).join('')}</div>${rows.length ? '' : '<div class="empty">Nothing matches.</div>'}`;
};

const VERDICTS = {
  sell: ['Sell for plat', 'good'], ducats: ['Ducats (Baro)', 'gold'], low: ['Low value', ''],
  'no-market': ['No buyers/sellers online', 'bad'], pending: ['Price loading…', 'warn'],
};

V.sell = () => {
  const d = S.sell;
  if (!d) { loadSell(); return '<div class="empty">Loading market data…</div>'; }
  if (d.disabled) return '<div class="empty">Market prices are turned off (server started with --no-market).</div>';
  const st = d.status;
  const kind = filt('kind', 'all'), verdict = filt('verdict', 'sell');
  const rows = d.rows.filter(r => (kind === 'all' || r.kind === kind) && (verdict === 'all' || r.verdict === verdict) && match(r.name, r.kind));
  const sum = (v, f) => d.rows.filter(r => r.verdict === v).reduce((s, r) => s + (r[f] || 0), 0);
  const kinds = [...new Set(d.rows.map(r => r.kind))].sort();
  const progress = st.running
    ? `Fetching prices from warframe.market… ${num(st.done)} done, ${num(st.pending)} left`
    : st.indexAt ? `Prices cached for ${num(st.cached)} items · refreshed every 6 h` : 'Could not reach warframe.market';
  if (!S.sort.sell) S.sort.sell = { k: 'total', dir: -1 };
  const cols = [
    { k: 'name', l: 'Item', r: r => `${link(r.uniqueName, r.name)} <a href="${esc(r.url)}" target="_blank" rel="noopener" class="muted" title="Open on warframe.market">↗</a>` },
    { k: 'kind', l: 'Type' },
    { k: 'excess', l: 'Spare', n: 1, r: r => `${num(r.excess)}<span class="muted"> / ${num(r.owned)}</span>` },
    { k: 'value', l: 'Price each', n: 1, sortVal: r => r.value ?? -1,
      r: r => `${r.value == null ? '—' : num(r.value) + 'p'}<div class="muted" style="font-size:11px">traded ${r.traded ?? '—'} · listed ${r.sell ?? '—'} · buy ${r.buy ?? '—'}</div>` },
    { k: 'volume', l: 'Sold (14d)', n: 1, sortVal: r => r.volume ?? -1,
      r: r => r.volume == null ? '—' : `${num(r.volume)}${r.verdict === 'sell' && r.volume < 3 ? '<div><span class="tag warn">slow</span></div>' : ''}` },
    { k: 'total', l: 'Total', n: 1, sortVal: r => r.total ?? -1, r: r => r.total == null ? '—' : `<b>${num(r.total)}p</b>` },
    { k: 'ducats', l: 'Ducats', n: 1, sortVal: r => r.totalDucats, r: r => r.ducats ? `${num(r.totalDucats)}<div class="muted" style="font-size:11px">${r.ducats} each</div>` : '' },
    { k: 'verdict', l: 'Advice', r: r => `<span class="tag ${VERDICTS[r.verdict][1]}">${VERDICTS[r.verdict][0]}</span>` },
    { k: 'why', l: 'Why it is spare', r: r => `<span class="muted">${esc(r.why)}</span>` },
  ];
  return `<div class="stats">
    <div class="stat"><div class="k">Worth selling</div><div class="v">${num(sum('sell', 'total'))}p</div><div class="s">${num(d.rows.filter(r => r.verdict === 'sell').length)} items, at recent trade prices</div></div>
    <div class="stat"><div class="k">Better as ducats</div><div class="v">${num(sum('ducats', 'totalDucats'))}</div><div class="s">${num(d.rows.filter(r => r.verdict === 'ducats').length)} prime items worth ≥15 ducats per plat</div></div>
    <div class="stat"><div class="k">Low value</div><div class="v">${num(sum('low', 'total'))}p</div><div class="s">Under 3p each</div></div>
  </div>
  <div class="bar"><span class="muted">${esc(progress)}${st.error && !st.running ? ' · last error: ' + esc(st.error) : ''}</span>
    <button id="refreshPrices" style="margin-left:auto" ${st.running ? 'disabled' : ''}>Refresh prices</button></div>
  <div class="bar">${chips('verdict', [['sell', 'Sell for plat'], ['ducats', 'Ducats'], ['low', 'Low value'], ['all', 'Everything spare']], 'sell')}</div>
  <div class="bar">${chips('kind', [['all', 'All types'], ...kinds.map(k => [k, k])], 'all')}${countBar(rows.length, d.rows.length)}</div>
  <p class="muted" style="font-size:12px;margin:0 0 8px">Price each is the volume-weighted price of completed trades over the last 14 days, capped at the cheapest listing from a player in game right now. With no trade history it uses the best buy order, or the cheapest listing only when at least 3 sellers are online. Parts and blueprints are kept when you haven't built or mastered the item they make; one copy of each mod and enough arcanes for one max rank are kept. Equipped and ranked mods are never counted.</p>
  ${table('sell', rows, cols)}`;
};

let sellTimer = null, sellLoading = false;
async function loadSell() {
  if (sellLoading) return;
  sellLoading = true;
  try {
    S.sell = await (await fetch('/api/sell')).json();
  } catch (e) {
    S.sell = { rows: [], status: { error: e.message } };
  }
  sellLoading = false;
  if (S.tab === 'sell') render();
}
function queueSellReload() {
  if (sellTimer) return;
  sellTimer = setTimeout(() => { sellTimer = null; if (S.tab === 'sell') loadSell(); else S.sell = null; }, 2000);
}

V.mods = m => {
  const kind = filt('kind', 'all'), tr = filt('tr', 'all');
  const rows = m.mods.filter(x => (kind === 'all' || (kind === 'arcane' ? x.isArcane : !x.isArcane))
    && (tr === 'all' || (tr === 'dupes' ? x.total > 1 : x.tradable))
    && match(x.name, x.type, x.compatName, x.rarity));
  const cols = [
    { k: 'name', l: 'Name', r: x => `<span class="r-${esc(x.rarity)}">${link(x.uniqueName, x.name)}</span>` },
    { k: 'type', l: 'Type' },
    { k: 'rarity', l: 'Rarity' },
    { k: 'polarity', l: 'Polarity' },
    { k: 'total', l: 'Owned', n: 1 },
    { k: 'unranked', l: 'Unranked', n: 1 },
    { k: 'rankedStr', l: 'Ranked copies', sortVal: x => x.ranked[0] ?? -1, r: x => x.ranked.length ? x.ranked.map(r => `<span class="tag ${r >= x.maxRank ? 'good' : ''}">R${r}</span>`).join('') : '' },
    { k: 'maxRank', l: 'Max', n: 1 },
    { k: 'tradable', l: 'Tradable', r: x => x.tradable ? '✔' : '' },
  ];
  return `<div class="bar">${chips('kind', [['all', 'Mods + Arcanes'], ['mod', 'Mods'], ['arcane', 'Arcanes']], 'all')}
    ${chips('tr', [['all', 'All'], ['tradable', 'Tradable'], ['dupes', 'Duplicates']], 'all')}${countBar(rows.length, m.mods.length)}</div>
  ${table('mods', rows, cols)}`;
};

V.rivens = m => {
  const rows = m.rivens.filter(r => match(r.name, r.weapon, r.type));
  const grade = g => g === 'good' ? '<span class="tag good">Good roll</span>' : g === 'good-pos' ? '<span class="tag warn">Good positives</span>' : g ? '<span class="tag">Meh</span>' : '';
  return `<div class="bar"><span class="muted">Values are estimated with AlecaFrame's riven data; disposition shown per weapon.</span>
    <span class="count">${num(rows.length)} unveiled · ${num(m.veiledRivens)} veiled</span></div>
  <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${rows.map(r => `<div class="card relic">
    <div class="t">${esc(r.name)}</div>
    <div class="m">${esc(r.type)} · MR ${r.mr} · Rank ${r.rank}/8 · ${r.rerolls} rolls · ${esc(r.polarity)} · Dispo ${r.disposition.toFixed(2)}</div>
    <div>${grade(r.grade)}</div>
    <ul class="rewards">${r.positives.map(p => `<li><span class="pos">${esc(p.text)}</span><span class="muted" title="At rank 8">${esc(p.maxText.split(' ')[0])} @R8</span></li>`).join('')}
    ${r.negatives.map(p => `<li><span class="neg">${esc(p.text)}</span><span class="muted">${esc(p.maxText.split(' ')[0])} @R8</span></li>`).join('')}</ul>
  </div>`).join('')}</div>${rows.length ? '' : '<div class="empty">No rivens.</div>'}`;
};

V.inventory = m => {
  const cat = filt('cat', 'all'), tr = filt('tr', 'all');
  const rows = m.inventory.filter(x => (cat === 'all' || x.category === cat) && (tr === 'all' || x.tradable) && match(x.name, x.category));
  const cols = [
    { k: 'name', l: 'Item', r: x => link(x.uniqueName, x.name) },
    { k: 'category', l: 'Category' },
    { k: 'count', l: 'Count', n: 1, r: x => num(x.count) },
    { k: 'ducats', l: 'Ducats ea.', n: 1, r: x => x.ducats || '' },
    { k: 'tradable', l: 'Tradable', r: x => x.tradable ? '✔' : '' },
  ];
  if (!S.sort.inventory) S.sort.inventory = { k: 'count', dir: -1 };
  return `<div class="bar">${categoryChips(m.inventory)}</div>
  <div class="bar">${chips('tr', [['all', 'All'], ['tradable', 'Tradable only']], 'all')}${countBar(rows.length, m.inventory.length)}</div>
  ${table('inventory', rows, cols)}`;
};

V.starchart = m => {
  const sp = filt('sp', 'all');
  const rows = m.missions.filter(x => (sp === 'all' || (sp === 'sp' ? x.steelPath : !x.steelPath)) && match(x.name, x.type, x.enemy, x.tag));
  const cols = [
    { k: 'name', l: 'Node' }, { k: 'type', l: 'Mission' }, { k: 'enemy', l: 'Faction' },
    { k: 'completes', l: 'Completions', n: 1 },
    { k: 'steelPath', l: 'Steel Path', r: x => x.steelPath ? '<span class="tag good">✔</span>' : '' },
    { k: 'xp', l: 'Mastery XP', n: 1 },
  ];
  return `<div class="bar">${chips('sp', [['all', 'All'], ['sp', 'Steel Path done'], ['nosp', 'Steel Path not done']], 'all')}${countBar(rows.length, m.missions.length)}</div>
  ${table('starchart', rows, cols)}`;
};

V.recent = m => {
  const rows = m.deltas.filter(x => match(x.name));
  const cols = [
    { k: 'name', l: 'Item', r: x => link(x.uniqueName, x.name) },
    { k: 'delta', l: 'Gained', n: 1, r: x => `<span class="${x.delta < 0 ? 'neg' : 'pos'}">${x.delta > 0 ? '+' : ''}${num(x.delta)}</span>` },
    { k: 'now', l: 'Now owned', n: 1, r: x => num(x.now) },
  ];
  return `<div class="bar"><span class="muted">Items AlecaFrame tracked as gained since its last baseline (deltas.dat).</span>${countBar(rows.length, m.deltas.length)}</div>
  ${table('recent', rows, cols)}`;
};

/* ---------------- item detail dialog ---------------- */

const detailHistory = [];

function dropTable(drops, limit = 12) {
  if (!drops.length) return '';
  const row = d => `<tr><td>${esc(d.location)}${d.relic ? ' ' + (d.owned ? `<span class="tag good">own ${esc(d.owned.join(', '))}</span>` : '')
    + (d.vaulted === true ? '<span class="tag warn">Vaulted</span>' : d.vaulted === false ? '<span class="tag good">Available</span>' : '') : ''}</td>
    <td class="r-${esc(d.rarity)}">${esc(d.rarity || '')}</td><td class="n">${d.chance != null ? d.chance + '%' : ''}${d.refinements && d.refinements.Radiant != null
      ? `<div class="muted" style="font-size:11px" title="Intact / Exceptional / Flawless / Radiant">${['Intact', 'Exceptional', 'Flawless', 'Radiant'].map(r => d.refinements[r] ?? '–').join(' / ')}%</div>` : ''}</td></tr>`;
  const head = '<tr><th>Source</th><th>Rarity</th><th class="n">Chance</th></tr>';
  const first = drops.slice(0, limit).map(row).join('');
  const rest = drops.slice(limit);
  return `<table class="drops">${head}${first}</table>${rest.length ? `<details><summary class="muted">Show ${rest.length} more sources</summary><table class="drops">${rest.map(row).join('')}</table></details>` : ''}`;
}

function noDrops(d) {
  const bits = [];
  if (d.bpCost) bits.push(`Blueprint sold in the Market for ${num(d.bpCost)} credits`);
  if (d.marketCost) bits.push(`Buyable in the Market for ${num(d.marketCost)} platinum`);
  return `<p class="muted">${bits.length ? esc(bits.join(' · ')) : 'No drop data: usually from a quest, vendor, syndicate, Dojo research or crafting.'}</p>`;
}

function renderDetail(d) {
  const tags = [
    d.owned ? `<span class="tag good">Owned ${num(d.owned)}</span>` : '<span class="tag">Not owned</span>',
    d.vaulted ? '<span class="tag warn">Vaulted</span>' : '',
    d.masteryReq ? `<span class="tag">MR ${d.masteryReq}</span>` : '',
    d.ducats ? `<span class="tag gold">${d.ducats} ducats</span>` : '',
    d.tradable ? '<span class="tag">Tradable</span>' : '',
  ].join('');
  const parts = d.components.map(c => {
    const done = c.owned >= c.need;
    return `<details class="part" ${!c.resource && c.drops.length ? 'open' : ''}>
      <summary>${c.resource ? esc(c.name) : link(c.uniqueName, c.name)}${c.need > 1 ? ` ×${num(c.need)}` : ''}
        <span class="tag ${done ? 'good' : ''}">have ${num(c.owned)}/${num(c.need)}</span>
        ${c.ducats ? `<span class="tag gold">${c.ducats}d</span>` : ''}
        <span class="muted" style="margin-left:auto;font-size:12px">${c.drops.length ? `${c.drops.length} source${c.drops.length > 1 ? 's' : ''}` : 'no drop data'}</span></summary>
      ${c.drops.length ? dropTable(c.drops, c.resource ? 8 : 12) : ''}
    </details>`;
  }).join('');
  return `<div class="dnav">
      <button id="detailBack" ${detailHistory.length > 1 ? '' : 'style="visibility:hidden"'}>← Back</button>
      <button id="detailClose">Close</button></div>
    <div class="dhead">${img(d.image, d.name)}<div><h3>${esc(d.name)}</h3>
      <div class="muted">${esc([d.category, d.type].filter(Boolean).join(' · '))}</div><div>${tags}</div></div></div>
    ${d.description ? `<p class="muted" style="font-size:13px">${esc(d.description)}</p>` : ''}
    <h2>Drops</h2>${d.drops.length ? dropTable(d.drops) : (d.components.length ? '<p class="muted">The item itself doesn\'t drop; build it from the parts below.</p>' : noDrops(d))}
    ${d.components.length ? `<h2>Parts${d.buildPrice ? ` <span class="muted" style="font-size:12px;font-weight:400">· ${num(d.buildPrice)} credits to build</span>` : ''}</h2>${parts}` : ''}
    ${wikiNeeded(d).length ? `<h2>From the Warframe Wiki</h2>
      <p class="muted" style="font-size:12px;margin:0 0 6px">AlecaFrame has no drop data for: ${esc(wikiNeeded(d).join(', '))}.</p>
      <div id="wikiBox" class="wiki"><div class="muted">Loading wiki…</div></div>` : ''}
    ${d.usedIn.length ? `<h2>Used to build</h2><div>${d.usedIn.slice(0, 40).map(u => `<span class="tag">${link(u.uniqueName, u.name)}${u.need > 1 ? ' ×' + num(u.need) : ''}</span>`).join(' ')}${d.usedIn.length > 40 ? ` <span class="muted">+${d.usedIn.length - 40} more</span>` : ''}</div>` : ''}`;
}

// Names of the item and its (non-resource) parts that have no drop data
function wikiNeeded(d) {
  const missing = d.components.filter(c => !c.resource && !c.drops.length).map(c => c.name);
  if (!d.drops.length && !d.components.length) missing.unshift(d.name);
  return missing;
}

async function loadWiki(un) {
  const box = $('#wikiBox');
  if (!box) return;
  try {
    const r = await fetch('/api/wiki?un=' + encodeURIComponent(un));
    const w = await r.json();
    if (!r.ok) throw new Error(w.error || r.statusText);
    if ($('#wikiBox') !== box) return; // dialog moved on
    // w.html is sanitized server-side to plain tables, lists and wiki links
    box.innerHTML = w.html
      ? `${w.html}<p class="muted" style="font-size:11px">Source: <a href="${esc(w.url)}" target="_blank" rel="noopener">${esc(w.page)}</a> on the Warframe Wiki (CC BY-SA)</p>`
      : `<div class="muted">The wiki page "${esc(w.page)}" ${w.missing ? 'doesn\'t exist' : 'has no acquisition section'}.</div>`;
  } catch (e) {
    box.innerHTML = `<div class="muted">Couldn't load the wiki: ${esc(e.message)}</div>`;
  }
}

async function openDetail(un, push = true) {
  const dlg = $('#detail');
  if (push) detailHistory.push(un);
  $('#detailBody').innerHTML = '<div class="empty">Loading…</div>';
  if (!dlg.open) dlg.showModal();
  try {
    const r = await fetch('/api/item?un=' + encodeURIComponent(un));
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || r.statusText);
    $('#detailBody').innerHTML = renderDetail(d);
    if (wikiNeeded(d).length) loadWiki(un);
  } catch (e) {
    $('#detailBody').innerHTML = `<div class="dnav"><span></span><button id="detailClose">Close</button></div><div class="empty">No details for this item (${esc(e.message)}).</div>`;
  }
  dlg.scrollTop = 0;
}

document.addEventListener('click', e => {
  const a = e.target.closest('[data-item]');
  if (a) { e.preventDefault(); openDetail(a.dataset.item); return; }
  if (e.target.id === 'detailClose' || e.target.id === 'detail') { $('#detail').close(); return; }
  if (e.target.id === 'detailBack') { detailHistory.pop(); openDetail(detailHistory[detailHistory.length - 1], false); }
});
$('#detail').addEventListener('close', () => { detailHistory.length = 0; });

/* ---------------- shell ---------------- */

function render() {
  $('#tabs').innerHTML = TABS.map(([k, l]) => `<button class="${S.tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('');
  if (!S.model) return;
  const y = window.scrollY;
  $('#view').innerHTML = (V[S.tab] || V.overview)(S.model);
  window.scrollTo(0, y);
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab],[data-f],[data-sort],#csvMastery,#refreshPrices');
  if (!t) return;
  if (t.id === 'refreshPrices') { t.disabled = true; fetch('/api/sell/refresh').then(() => setTimeout(loadSell, 500)); return; }
  if (t.dataset.tab) {
    S.tab = t.dataset.tab; store.set('tab', S.tab); window.scrollTo(0, 0);
    if (S.tab === 'sell') loadSell();
    render();
  }
  else if (t.dataset.f) setFilt(t.dataset.f, JSON.parse(t.dataset.v));
  else if (t.dataset.sort) {
    const [key, k] = t.dataset.sort.split('|');
    const cur = S.sort[key];
    S.sort[key] = { k, dir: cur && cur.k === k ? -cur.dir : (k === 'name' ? 1 : -1) };
    render();
  } else if (t.id === 'csvMastery') {
    const rows = S.model.mastery.filter(x => x.status !== 'mastered').map(x => ({ ...x, left: x.masteryTotal - x.masteryEarned }));
    downloadCsv('unmastered-items.csv', rows, [['category', 'Category'], ['name', 'Item'], ['rank', 'Rank'], ['owned', 'Owned'], ['left', 'MasteryXP']]);
  }
});
document.addEventListener('change', e => {
  if (e.target.dataset.fsel) setFilt(e.target.dataset.fsel, e.target.value);
});
let qTimer;
$('#search').addEventListener('input', e => { clearTimeout(qTimer); qTimer = setTimeout(() => { S.q = e.target.value.trim().toLowerCase(); render(); }, 120); });
$('#imgToggle').checked = S.images;
$('#imgToggle').addEventListener('change', e => { S.images = e.target.checked; store.set('images', S.images); render(); });
$('#reloadBtn').addEventListener('click', async () => { status('Reloading…'); await fetch('/api/reload'); load(); });

function status(msg, err) { const el = $('#status'); el.textContent = msg; el.className = err ? 'err' : ''; }

async function load() {
  try {
    const r = await fetch('/api/model');
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.statusText);
    S.model = j;
    status(`Loaded ${new Date(j.generatedAt).toLocaleTimeString()} · AlecaFrame data from ${fdate(j.files.lastData && j.files.lastData.modified)} · auto-refreshes when AlecaFrame writes new data`);
    render();
  } catch (e) {
    status('Could not load data: ' + e.message, true);
    render();
  }
}

const es = new EventSource('/api/events');
es.onmessage = ev => {
  const d = JSON.parse(ev.data);
  if (d.type === 'market') return queueSellReload();
  if (d.error) status('Reload failed: ' + d.error, true);
  else { load(); queueSellReload(); }
};

render();
load();
