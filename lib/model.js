'use strict';
// Turns the decrypted AlecaFrame inventory + item DB into view-ready data.
const { cleanName, prettifyPath } = require('./db');

const EQUIP_CATEGORIES = {
  Suits: 'Warframes',
  LongGuns: 'Primary',
  Pistols: 'Secondary',
  Melee: 'Melee',
  SpaceSuits: 'Archwing',
  SpaceGuns: 'Arch-Gun',
  SpaceMelee: 'Arch-Melee',
  Sentinels: 'Sentinels',
  SentinelWeapons: 'Companion Weapons',
  KubrowPets: 'Companions',
  MoaPets: 'Companions',
  MechSuits: 'Necramechs',
  OperatorAmps: 'Amps',
  Hoverboards: 'K-Drives',
};
const FRAME_TYPE_INV = new Set(['Suits', 'SpaceSuits', 'Sentinels', 'KubrowPets', 'MoaPets', 'MechSuits', 'Hoverboards']);
const FRAME_TYPE_DB = new Set(['Warframes', 'Archwing', 'Sentinels', 'Pets']);

// group: display group; max: highest rank; cumulative: Standing is a running total across ranks
const F = 'Factions', OW = 'Open world & amps', ST = 'Story', OT = 'Other';
const SYNDICATE_INFO = {
  SteelMeridianSyndicate: { name: 'Steel Meridian', group: F, max: 5, cumulative: true },
  ArbitersSyndicate: { name: 'Arbiters of Hexis', group: F, max: 5, cumulative: true },
  CephalonSudaSyndicate: { name: 'Cephalon Suda', group: F, max: 5, cumulative: true },
  PerrinSyndicate: { name: 'The Perrin Sequence', group: F, max: 5, cumulative: true },
  RedVeilSyndicate: { name: 'Red Veil', group: F, max: 5, cumulative: true },
  NewLokaSyndicate: { name: 'New Loka', group: F, max: 5, cumulative: true },
  CetusSyndicate: { name: 'Ostrons', group: OW, max: 5, cumulative: true },
  QuillsSyndicate: { name: 'The Quills', group: OW, max: 5, cumulative: true },
  SolarisSyndicate: { name: 'Solaris United', group: OW, max: 5, cumulative: true },
  VoxSyndicate: { name: 'Vox Solaris', group: OW, max: 5, cumulative: true },
  VentKidsSyndicate: { name: 'Ventkids', group: OW, max: 5, cumulative: true },
  EntratiSyndicate: { name: 'Entrati', group: ST, max: 5, cumulative: true },
  NecraloidSyndicate: { name: 'Necraloid', group: ST, max: 3, cumulative: true },
  ZarimanSyndicate: { name: 'The Holdfasts', group: ST, max: 5, cumulative: true },
  EntratiLabSyndicate: { name: 'Cavia', group: ST, max: 5, cumulative: true },
  HexSyndicate: { name: 'The Hex', group: ST, max: 5, cumulative: true },
  KahlSyndicate: { name: "Kahl's Garrison", group: ST, max: 5 },
  NightcapJournalSyndicate: { name: 'Nightcap', group: ST },
  ConclaveSyndicate: { name: 'Conclave', group: OT, max: 5, cumulative: true },
  LibrarySyndicate: { name: 'Simaris', group: OT },
  EventSyndicate: { name: 'Operational Supply', group: OT },
};
const SYNDICATE_GROUPS = [F, OW, ST, OT];
// Standing needed within each rank (rank 0 spans -5,000..5,000)
const RANK_CAP = [5000, 22000, 44000, 70000, 99000, 132000];
const rankStart = r => (r <= 0 ? 0 : RANK_CAP.slice(0, r).reduce((s, x) => s + x, 0));
const SYNDICATES = Object.fromEntries(Object.entries(SYNDICATE_INFO).map(([k, v]) => [k, v.name]));

const RIVEN_ROLL_MAX = 0x3fffffff;
// Focus schools and riven polarities share these AP_ tags
const POLARITIES = { AP_ATTACK: 'Madurai', AP_DEFENSE: 'Vazarin', AP_TACTIC: 'Naramon', AP_POWER: 'Zenurik', AP_WARD: 'Unairu' };

function date(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  if (v.$date) return Number(v.$date.$numberLong ?? v.$date);
  return null;
}

function oid(v) { return v && v.$oid ? v.$oid : v; }

function parseFp(s) {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}

function rankFromXp(xp, frameType, maxRank) {
  const per = frameType ? 1000 : 500;
  return Math.min(maxRank, Math.floor(Math.sqrt((xp || 0) / per)));
}

function xpForRank(rank, frameType) {
  return (frameType ? 1000 : 500) * rank * rank;
}

function buildModel(db, last, deltas, meta) {
  const inv = typeof last.InventoryJson === 'string' ? JSON.parse(last.InventoryJson) : (last.InventoryJson || last);
  const { name, image, ducats, items } = db;
  const maxOverrides = (db.basic && db.basic.maxLevelOverrides) || {};

  // Owned counts across stackable containers
  const owned = new Map();
  const add = (un, n) => owned.set(un, (owned.get(un) || 0) + n);
  for (const k of ['MiscItems', 'Recipes', 'Consumables', 'LevelKeys', 'FusionTreasures', 'ShipDecorations']) {
    for (const x of inv[k] || []) add(x.ItemType, x.ItemCount || 0);
  }

  const xpInfo = new Map();
  for (const x of inv.XPInfo || []) xpInfo.set(x.ItemType, x.XP || 0);

  const dbFrameType = (un, fallbackInvCat) => {
    const it = items.get(un);
    if (it) return FRAME_TYPE_DB.has(it.category) || it.type === 'K-Drive Component';
    if (fallbackInvCat) return FRAME_TYPE_INV.has(fallbackInvCat);
    return /\/Powersuits\/|SentinelPowersuits|KubrowPet|MoaPet|Hoverboard/.test(un);
  };

  // ---- Equipment ----
  const equipment = [];
  const ownedEquip = new Map();
  for (const [invKey, label] of Object.entries(EQUIP_CATEGORIES)) {
    for (const x of inv[invKey] || []) {
      let un = x.ItemType;
      // Modular items (kitguns, zaws, amps, moas, k-drives) are identified by their masterable part
      if (Array.isArray(x.ModularParts) && x.ModularParts.length) {
        const key = x.ModularParts.find(p => items.get(p) && items.get(p).masterable) || x.ModularParts[0];
        un = key;
      }
      const frameType = FRAME_TYPE_INV.has(invKey);
      const maxRank = maxOverrides[un] || maxOverrides[x.ItemType] || 30;
      const it = items.get(un);
      const xpMastery = xpInfo.get(un) || 0;
      ownedEquip.set(un, (ownedEquip.get(un) || 0) + 1);
      equipment.push({
        id: oid(x.ItemId),
        uniqueName: un,
        name: name(un),
        customName: x.ItemName || null,
        category: label,
        image: image(un),
        xp: x.XP || 0,
        rank: rankFromXp(x.XP, frameType, maxRank),
        maxRank,
        forma: x.Polarized || 0,
        mastered: rankFromXp(xpMastery, frameType, maxRank) >= maxRank,
        masteryReq: it ? it.masteryReq || 0 : 0,
        isPrime: !!(it && it.isPrime),
        modular: !!(x.ModularParts && x.ModularParts.length),
        archonShards: Array.isArray(x.ArchonCrystalUpgrades) ? x.ArchonCrystalUpgrades.filter(s => s && s.Color).map(s => s.Color) : [],
      });
    }
  }

  // ---- Mastery ----
  const masteryList = [];
  const seenMasterable = new Set();
  for (const it of items.values()) {
    if (!it.masterable) continue;
    seenMasterable.add(it.uniqueName);
    const frameType = dbFrameType(it.uniqueName);
    const maxRank = maxOverrides[it.uniqueName] || 30;
    const xp = xpInfo.get(it.uniqueName) || 0;
    const rank = rankFromXp(xp, frameType, maxRank);
    const perRank = frameType ? 200 : 100;
    masteryList.push({
      uniqueName: it.uniqueName,
      name: cleanName(it.name),
      category: it.category === 'Pets' ? 'Companions' : (it._file === 'SentinelWeapons' ? 'Companion Weapons' : it.category),
      type: it.type,
      image: image(it.uniqueName),
      rank, maxRank,
      xp, xpNeeded: xpForRank(maxRank, frameType),
      masteryEarned: rank * perRank,
      masteryTotal: maxRank * perRank,
      status: rank >= maxRank ? 'mastered' : xp > 0 ? 'leveling' : 'unranked',
      owned: ownedEquip.get(it.uniqueName) || 0,
      masteryReq: it.masteryReq || 0,
      isPrime: !!it.isPrime,
      vaulted: !!it.vaulted,
    });
  }
  const nodeXP = (db.basic && db.basic.nodeXP) || {};
  let nodesDone = 0, spNodesDone = 0;
  const missions = [];
  for (const m of inv.Missions || []) {
    const node = db.solNodes[m.Tag];
    const xp = nodeXP[m.Tag] || 0;
    const onChart = m.Tag in nodeXP;
    if (m.Completes > 0 && onChart) nodesDone++;
    if (m.Tier && onChart) spNodesDone++;
    missions.push({
      tag: m.Tag,
      name: node ? node.value : m.Tag,
      type: node ? node.type : '',
      enemy: node ? node.enemy : '',
      completes: m.Completes || 0,
      steelPath: !!m.Tier,
      xp,
    });
  }
  const skills = inv.PlayerSkills || {};
  const intrinsics = Object.entries(skills)
    .filter(([k]) => k.startsWith('LPS_'))
    .map(([k, v]) => ({
      key: k,
      group: k.startsWith('LPS_DRIFT_') ? 'Drifter' : 'Railjack',
      name: prettifyPath(k.replace(/^LPS_(DRIFT_)?/, '').toLowerCase().replace(/^./, c => c.toUpperCase())),
      level: v,
    }));

  // ---- Relics ----
  const relics = [];
  for (const [un, count] of owned) {
    if (!un.includes('/Projections/') || count <= 0) continue;
    const it = items.get(un);
    const full = it ? cleanName(it.name) : prettifyPath(un);
    const m = full.match(/^(\S+)\s+(\S+)\s+(Intact|Exceptional|Flawless|Radiant)$/i);
    relics.push({
      uniqueName: un,
      name: full,
      era: m ? m[1] : (full.split(' ')[0] || ''),
      code: m ? m[2] : '',
      refinement: m ? m[3] : '',
      count,
      vaulted: !!(it && it.vaulted),
      // AlecaFrame ships era icons (lith.png, meso.png, ...) in cachedData/custom/img
      image: m ? `/aleca-img/${m[1].toLowerCase()}.png` : image(un),
      rewards: ((it && it.rewards) || []).map(r => {
        const run = r.item && r.item.uniqueName;
        return {
          name: r.item ? cleanName(r.item.name) : '?',
          uniqueName: run,
          rarity: r.rarity,
          chance: r.chance,
          owned: run ? owned.get(run) || 0 : 0,
          ducats: run ? ducats(run) : 0,
        };
      }),
    });
  }

  // ---- Prime sets ----
  const primes = [];
  for (const it of items.values()) {
    if (!it.isPrime || !Array.isArray(it.components)) continue;
    const parts = it.components.filter(c => c.primeSellingPrice != null);
    if (!parts.length) continue;
    const comps = parts.map(c => {
      const bpName = /Component$/.test(c.uniqueName) ? c.uniqueName.replace(/Component$/, 'Blueprint') : null;
      const bpOwned = bpName ? owned.get(bpName) || 0 : 0;
      const crafted = owned.get(c.uniqueName) || 0;
      const need = c.itemCount || 1;
      return {
        name: cleanName(c.name), uniqueName: c.uniqueName, need, owned: crafted + bpOwned,
        // Only blueprints of Warframe parts can be traded, crafted parts can't
        tradeUniqueName: bpName || c.uniqueName, tradable: bpName ? bpOwned : crafted,
        ducats: c.primeSellingPrice || 0, image: c.imageName ? db.image(c.uniqueName) : null,
        relics: (c.drops || []).filter(d => /Relic/.test(d.location || '')).map(d => ({ relic: d.location, rarity: d.rarity, chance: d.chance })),
      };
    });
    const craftable = Math.min(...comps.map(c => Math.floor(c.owned / c.need)));
    const partsOwned = comps.reduce((s, c) => s + c.owned, 0);
    const xp = xpInfo.get(it.uniqueName) || 0;
    const frameType = dbFrameType(it.uniqueName);
    primes.push({
      uniqueName: it.uniqueName,
      name: cleanName(it.name),
      category: it.category === 'Pets' ? 'Companions' : it.category,
      image: image(it.uniqueName),
      vaulted: !!it.vaulted,
      ownedItem: ownedEquip.get(it.uniqueName) || 0,
      mastered: rankFromXp(xp, frameType, maxOverrides[it.uniqueName] || 30) >= (maxOverrides[it.uniqueName] || 30),
      components: comps,
      fullSets: craftable,
      partsOwned,
      partsDucats: comps.reduce((s, c) => s + c.owned * c.ducats, 0),
    });
  }

  // ---- Mods & arcanes ----
  const modMap = new Map();
  const modEntry = un => {
    if (!modMap.has(un)) {
      const it = items.get(un);
      modMap.set(un, {
        uniqueName: un,
        name: name(un),
        image: image(un),
        isArcane: !!(it && it._file === 'Arcanes'),
        type: it ? it.type || '' : '',
        rarity: it ? it.rarity || '' : '',
        polarity: it ? it.polarity || '' : '',
        compatName: it ? it.compatName || '' : '',
        maxRank: it ? it.fusionLimit ?? (it.levelStats ? it.levelStats.length - 1 : 0) : 0,
        tradable: !!(it && it.tradable),
        unranked: 0,
        ranked: [],
      });
    }
    return modMap.get(un);
  };
  let veiledRivens = 0;
  for (const x of inv.RawUpgrades || []) {
    if (x.ItemType.includes('/Randomized/')) { veiledRivens += x.ItemCount || 0; continue; }
    modEntry(x.ItemType).unranked += x.ItemCount || 0;
  }
  const rivensOut = [];
  for (const x of inv.Upgrades || []) {
    const fp = parseFp(x.UpgradeFingerprint);
    if (x.ItemType.includes('/Randomized/')) {
      if (fp.compat) rivensOut.push(decodeRiven(db, x, fp));
      else veiledRivens++;
      continue;
    }
    modEntry(x.ItemType).ranked.push(fp.lvl || 0);
  }
  const mods = [...modMap.values()].map(m => ({
    ...m,
    total: m.unranked + m.ranked.length,
    maxed: m.ranked.filter(r => r >= m.maxRank && m.maxRank > 0).length,
    ranked: m.ranked.sort((a, b) => b - a),
  }));

  // ---- Inventory (resources, blueprints, misc) ----
  const inventory = [];
  for (const [un, count] of owned) {
    if (un.includes('/Projections/') || count <= 0) continue;
    const it = items.get(un);
    let category = it ? it.category || it._file : '';
    if (category === 'Components' && !((it.parentUniqueNames || []).length === 1)) category = 'Resources';
    if (!category || category === 'Misc') {
      if (un.includes('/Recipes/')) category = 'Blueprints';
      else if (un.includes('/Restoratives/')) category = 'Gear';
      else if (un.includes('/ShipDecos/')) category = 'Decorations';
      else if (/\/(MiscItems|Gems|Resources|RailjackMiscItems|Research)\//.test(un)) category = 'Resources';
      else if (un.includes('/FusionTreasures/')) category = 'Ayatan';
      else category = 'Misc';
    }
    if (db.components.has(un) && ducats(un)) category = 'Prime Parts';
    // Parts and blueprints that build exactly one item, so selling can respect unbuilt gear
    const comps = db.components.get(un);
    const builds = comps && comps.length === 1 && comps[0].parent.masterable
      ? { uniqueName: comps[0].parent.uniqueName, need: comps[0].comp.itemCount || 1 } : null;
    inventory.push({
      uniqueName: un, name: name(un), count, category, image: image(un),
      tradable: !!(it && it.tradable) || !!ducats(un), ducats: ducats(un), builds,
    });
  }

  // ---- Account overview ----
  const misc = un => owned.get(un) || 0;
  // Nightwave seasons (RadioLegion*) pile up one entry per season, so they're left out
  const affiliations = (inv.Affiliations || []).filter(a => !a.Tag.startsWith('RadioLegion')).map(a => {
    const info = SYNDICATE_INFO[a.Tag] || {};
    const title = a.Title || 0;
    const standing = a.Standing || 0;
    const out = {
      tag: a.Tag,
      name: info.name || a.Tag.replace(/Syndicate$/, '').replace(/([a-z])([A-Z])/g, '$1 $2'),
      group: info.group || OT,
      title,
      maxRank: info.max ?? null,
      standing,
      rankStanding: null, // progress inside the current rank
      rankCap: null,
    };
    if (info.cumulative && title >= 0) {
      out.rankStanding = title === 0 ? standing : standing - rankStart(title);
      out.rankCap = RANK_CAP[Math.min(title, RANK_CAP.length - 1)];
    }
    out.maxRankReached = out.maxRank != null && title >= out.maxRank;
    // Reaching the top rank counts as maxed; leftover standing only matters for spending
    out.maxed = out.maxRankReached;
    return out;
  }).sort((a, b) => SYNDICATE_GROUPS.indexOf(a.group) - SYNDICATE_GROUPS.indexOf(b.group)
    || b.title - a.title || b.standing - a.standing);

  const pendingRecipes = (inv.PendingRecipes || []).map(r => ({
    uniqueName: r.ItemType, name: name(r.ItemType).replace(/ Blueprint$/, ''), completes: date(r.CompletionDate),
  }));
  const boosters = (inv.Boosters || []).map(b => ({
    name: prettifyPath(b.ItemType).replace(/ Booster$/, '') + ' Booster', expires: date(b.ExpiryDate),
  })).filter(b => b.expires > Date.now());


  const account = {
    username: meta.username || null,
    masteryRank: inv.PlayerLevel ?? null,
    created: date(inv.Created),
    lastRegion: inv.LastRegionPlayed || null,
    credits: inv.RegularCredits || 0,
    platinum: (inv.PremiumCredits || 0) + (inv.PremiumCreditsFree || 0),
    endo: inv.FusionPoints || 0,
    ducats: misc('/Lotus/Types/Items/MiscItems/PrimeBucks'),
    aya: misc('/Lotus/Types/Items/MiscItems/SchismKey'),
    regalAya: misc('/Lotus/Types/Items/MiscItems/PrimeTokens') || inv.PrimeTokens || 0,
    forma: misc('/Lotus/Types/Items/MiscItems/Forma'),
    formaUmbra: misc('/Lotus/Types/Items/MiscItems/FormaUmbra'),
    formaAura: misc('/Lotus/Types/Items/MiscItems/FormaAura'),
    formaStance: misc('/Lotus/Types/Items/MiscItems/FormaStance'),
    tradesRemaining: inv.TradesRemaining ?? null,
    giftsRemaining: inv.GiftsRemaining ?? null,
    dailyStanding: inv.DailyAffiliation ?? null,
    dailyFocus: inv.DailyFocus ?? null,
    focus: Object.entries(inv.FocusXP || {}).map(([k, v]) => ({ school: POLARITIES[k] || k, xp: v })),
    slots: {
      warframe: inv.SuitBin, weapon: inv.WeaponBin, sentinel: inv.SentinelBin, riven: inv.RandomModBin, amp: inv.OperatorAmpBin,
    },
    mastery: {
      nodesDone, spNodesDone, totalNodes: Object.keys(nodeXP).length,
      itemsMastered: masteryList.filter(m => m.status === 'mastered').length,
      itemsTotal: masteryList.length,
    },
    intrinsics,
    affiliations,
    pendingRecipes,
    boosters,
    lastMission: {
      rewards: (last.MissionRewards || []).map(r => ({ name: name(r.TypeName), count: r.ItemCount || 1 })),
      credits: Array.isArray(last.TotalCredits) ? last.TotalCredits[0] : last.TotalCredits,
      standing: (last.AffiliationMods || []).map(a => ({ name: SYNDICATES[a.Tag] || a.Tag, standing: a.Standing })),
    },
  };

  // ---- Deltas (session gains AlecaFrame tracks) ----
  const deltaList = [];
  if (deltas && deltas.currentDeltas) {
    for (const [un, n] of Object.entries(deltas.currentDeltas)) {
      if (!n) continue;
      deltaList.push({ uniqueName: un, name: name(un), delta: n, now: owned.get(un) || 0, image: image(un) });
    }
    deltaList.sort((a, b) => b.delta - a.delta);
  }

  return {
    generatedAt: Date.now(),
    files: meta.files,
    account,
    equipment,
    mastery: masteryList,
    relics,
    primes,
    mods,
    rivens: rivensOut,
    veiledRivens,
    inventory,
    missions,
    deltas: deltaList,
  };
}

function decodeRiven(db, x, fp) {
  const rv = db.rivens || {};
  const data = (rv.dataByRivenInternalID || {})[x.ItemType] || {};
  const stats = data.rivenStats || {};
  const weapon = (rv.weaponStats || {})[fp.compat] || {};
  const disp = weapon.omegaAtt || 1;
  const buffs = fp.buffs || [];
  const curses = fp.curses || [];
  const mods = (rv.modifiersBasedOnTraitCount || []).find(m => m.goodModifiersCount === buffs.length && m.badModifiersCount === curses.length);
  const goodMult = mods ? mods.goodModifierMultiplier : 1;
  const badMult = mods ? Math.abs(mods.badModifierMultiplier) : 1;
  const rank = fp.lvl || 0;

  const fmt = (b, mult, sign) => {
    const s = stats[b.Tag] || {};
    const roll = (b.Value || 0) / RIVEN_ROLL_MAX;
    const at = r => (s.baseValue || 0) * 10 * (r + 1) * 100 * disp * mult * (0.9 + 0.2 * roll);
    const label = cleanName((s.localizationString || b.Tag + ' |val|').replace('|val|', '#'));
    const show = v => (sign < 0 ? '-' : '+') + v.toFixed(1);
    return {
      tag: b.Tag,
      text: label.replace('#', show(at(rank))),
      maxText: label.replace('#', show(at(8))),
      roll: Math.round(roll * 100),
      short: cleanName(s.shortString || b.Tag),
    };
  };
  const pos = buffs.map(b => fmt(b, goodMult, 1));
  const neg = curses.map(b => fmt(b, badMult, -1));

  const pre = buffs.map(b => (stats[b.Tag] || {}).prefixTag || '?');
  const suf = buffs.map(b => (stats[b.Tag] || {}).suffixTag || '?');
  let rivenName = '';
  if (buffs.length === 1) rivenName = suf[0];
  else if (buffs.length) rivenName = pre.slice(0, -1).join('-') + suf[suf.length - 1];
  rivenName = rivenName.charAt(0).toUpperCase() + rivenName.slice(1);

  // "Good roll" check using AlecaFrame's community roll data
  let grade = null;
  const gr = weapon.goodRolls;
  if (gr && gr.goodAttrs) {
    const tags = buffs.map(b => b.Tag);
    const posGood = gr.goodAttrs.some(g => {
      const ok = new Set([...(g.mandatory || []), ...(g.optional || [])]);
      return (g.mandatory || []).every(t => tags.includes(t)) && tags.every(t => ok.has(t));
    });
    const negOk = curses.every(c => (gr.acceptedBadAttrs || []).includes(c.Tag));
    grade = posGood && negOk ? 'good' : posGood ? 'good-pos' : 'meh';
  }

  return {
    id: oid(x.ItemId),
    weapon: db.name(fp.compat),
    weaponUniqueName: fp.compat,
    name: `${db.name(fp.compat)} ${rivenName}`,
    type: data.veiledName || db.name(x.ItemType),
    rank,
    mr: fp.lvlReq || 0,
    rerolls: fp.rerolls || 0,
    polarity: POLARITIES[fp.pol] || '',
    disposition: disp,
    positives: pos,
    negatives: neg,
    grade,
  };
}

module.exports = { buildModel };
