# AlecaLocal

A local, offline viewer for the data AlecaFrame stores on your PC.

It decrypts `%LOCALAPPDATA%\AlecaFrame\lastData.dat` and `deltas.dat` (AES-128-CBC, key supplied locally),
combines them with AlecaFrame's cached item database (`cachedData\json`, `cachedData\custom`)
and serves a GUI at http://127.0.0.1:8787 (local only).

## Run

Requires Node.js 18+ (no npm install needed).

The AES key and IV are not included in this repository. Copy `aleca-key.example.json` to `aleca-key.json`
and fill in the 16-byte key and IV as 32-character hex strings (or set the `ALECA_KEY` / `ALECA_IV`
environment variables). `aleca-key.json` is gitignored.

Then double-click `start.bat`, or:

```
node server.js [--port 8787] [--dir "C:\path\to\AlecaFrame"] [--no-open]
```

The page refreshes by itself whenever AlecaFrame rewrites its data (after the game syncs your inventory).

## Tabs

- **Overview**: MR, currencies, forma, foundry timers, boosters, last mission, focus, intrinsics, syndicates, slots, decrypted JSON export
- **Equipment**: every owned frame/weapon/companion with rank, forma, mastered state
- **Mastery**: every masterable item with status, ownership, mastery XP left; CSV export
- **Relics**: owned relics by era/refinement/vault status with drop tables and which rewards you already own
- **Prime Sets**: owned prime parts, completable sets, ducat values
- **Sell**: spare items worth selling, priced from warframe.market (recent completed trades, checked against live listings and buy orders), with advice to sell for plat or trade to Baro for ducats
- **Mods & Arcanes**: counts, ranked copies, duplicates, tradable filter
- **Rivens**: decoded stats (estimated values at current rank and rank 8), rolls, MR, polarity, "good roll" grade
- **Inventory**: all resources, blueprints, parts and other stackables
- **Star Chart**: node completions and Steel Path progress
- **Recent Gains**: what AlecaFrame tracked in `deltas.dat`

Click any item name (in every tab) to open its detail view: where the item drops, and the drop table
for each part needed to build it. Relic sources are merged into one row per relic with Intact/Exceptional/Flawless/Radiant
chances, marked vaulted or available, and show how many of that relic you own.

When AlecaFrame has no drop data for an item or one of its parts, the detail view pulls the "Acquisition" /
"Drop Locations" section from wiki.warframe.com instead (cached in `data/wiki/` for 7 days; `--no-wiki` turns it off).

Item images load from `cdn.warframestat.us`; untick **Images** to stay fully offline.

Prices come from the public warframe.market API (about 3 requests per second, cached in `data/` for 6 hours).
The first run takes a few minutes to price everything; start with `--no-market` to skip it.
