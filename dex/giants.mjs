#!/usr/bin/env node
/* GIANTS-BEAT (R74) · טבלת-העושר החיה של הענקים, נמדדת keyless ממקורות-ציבוריים
 *
 * מה זה: מנוע שמודד את עמלות-הפרוטוקול והנפחים של ענקי-ה-DeFi (Uniswap, Jupiter,
 * Hyperliquid, PancakeSwap, Raydium, Curve, Meteora, Orca, MetaMask) מול השורה
 * שלנו שנמדדת מספר-המנוע החי (dex/world.json). המספרים הם המקור ל"שולחן-הענקים"
 * (giants.html) ולסולם-העקיפה: אנחנו לא מספרים סיפורים על הענקים · אנחנו מודדים אותם.
 *
 * מקורות (פומביים, בלי-מפתחות, GET בלבד):
 *   fees  https://api.llama.fi/overview/fees
 *   dexs  https://api.llama.fi/overview/dexs
 *
 * אפס-סודות · אפס-המצאה · fail-closed: גם כשמקור נופל, הספר מתפרסם עם עדות-הכישלון.
 * הרצה: node dex/giants.mjs   (runner ציבורי · ubuntu-latest · node 20)
 */
'use strict';
import { readFileSync, writeFileSync } from 'node:fs';

const OUT = new URL('./giants.json', import.meta.url).pathname;
const WORLD = new URL('./world.json', import.meta.url).pathname;
/* CR-0077 (2026-10-13, trace 1a135897157a1d75): the our-row gains the DOMAIN core ledger —
 * the owner ordered the DEX alive; the core book (Domain/agents/dex-core.json) is where the
 * two-sided ladder flow settles, so the row now merges BOTH engine books, keyless GET, with
 * a freshness guard (≤30h) — stale books never masquerade as fresh ones. */
const CORE_BOOK_URL = 'https://roshpinacare-sys.github.io/Domain/agents/dex-core.json';
const ACT_BOOK_URL = 'https://roshpinacare-sys.github.io/Domain/agents/dex-activation.json';
const UA = 'saos-giants-beat/1.0 (keyless public measurement; repo roshpinacare-sys/Console)';
const FEES_URL = 'https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true';
const DEXS_URL = 'https://api.llama.fi/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true';

/* משפחות-הענקים: התאמה לפי-תחילית שם בלבד · כל רכיב נשמר במלואו (אין הסתרה)
 * R75 THE FRONTIER LEAGUE: הליגה נפתחת מ-9 ל-28 משפחות — כל סוגי-ההון ב-DeFi:
 * DEX · אגרגטורים/אינטנטים/חוצי-שרשרות · פרפטואלים · תשואה · הלוואות · סטייקינג/סטבלים · ארנקים.
 * משפחה שלא נמצאה בפיד נופלת מעצמה (בלי-המצאה); רכיב שנמצא נשמר שלם עם הקטגוריה שלו. */
const FAMILIES = [
  /* DEXs */
  { id: 'uniswap',     name: 'Uniswap',         tier: 'dex',        match: (n) => n.startsWith('Uniswap') },
  { id: 'pancakeswap', name: 'PancakeSwap',     tier: 'dex',        match: (n) => n.startsWith('PancakeSwap') },
  { id: 'raydium',     name: 'Raydium',         tier: 'dex',        match: (n) => n.startsWith('Raydium') },
  { id: 'curve',       name: 'Curve',           tier: 'dex',        match: (n) => n.startsWith('Curve') },
  { id: 'meteora',     name: 'Meteora',         tier: 'dex',        match: (n) => n.startsWith('Meteora') },
  { id: 'orca',        name: 'Orca',            tier: 'dex',        match: (n) => n.startsWith('Orca') },
  { id: 'aerodrome',   name: 'Aerodrome',       tier: 'dex',        match: (n) => n.startsWith('Aerodrome') },
  /* אגרגטורים · אינטנטים · חוצי-שרשרות */
  { id: 'jupiter',     name: 'Jupiter',         tier: 'aggregator', match: (n) => n.startsWith('Jupiter') },
  { id: '1inch',       name: '1inch',           tier: 'aggregator', match: (n) => n.startsWith('1inch') },
  { id: '0x',          name: '0x Protocol',     tier: 'aggregator', match: (n) => n.startsWith('0x ') || n === '0x' || n.startsWith('0x Protocol') },
  { id: 'cow',         name: 'CoW Protocol',    tier: 'aggregator', match: (n) => n.startsWith('CoW ') || n.startsWith('CoWSwap') || n.startsWith('CoW Protocol') },
  { id: 'lifi',        name: 'Li.Fi',           tier: 'aggregator', match: (n) => n.startsWith('Li.Fi') || n.startsWith('LiFi') },
  { id: 'thorchain',   name: 'THORChain',       tier: 'aggregator', match: (n) => n.startsWith('THORChain') },
  /* פרפטואלים */
  { id: 'hyperliquid', name: 'Hyperliquid',     tier: 'perps',      match: (n) => n.startsWith('Hyperliquid') },
  { id: 'dydx',        name: 'dYdX',            tier: 'perps',      match: (n) => n.startsWith('dYdX') },
  { id: 'gmx',         name: 'GMX',             tier: 'perps',      match: (n) => n.startsWith('GMX') },
  /* תשואה */
  { id: 'pendle',      name: 'Pendle',          tier: 'yield',      match: (n) => n.startsWith('Pendle') },
  /* הלוואות */
  { id: 'aave',        name: 'Aave',            tier: 'lending',    match: (n) => n.startsWith('Aave ') || n === 'Aave' },
  { id: 'morpho',      name: 'Morpho',          tier: 'lending',    match: (n) => n.startsWith('Morpho') },
  { id: 'kamino',      name: 'Kamino',          tier: 'lending',    match: (n) => n.startsWith('Kamino') },
  /* סטייקינג · סטבלים */
  { id: 'lido',        name: 'Lido',            tier: 'staking',    match: (n) => n.startsWith('Lido') },
  { id: 'ethena',      name: 'Ethena',          tier: 'staking',    match: (n) => n.startsWith('Ethena') },
  { id: 'sky',         name: 'Sky',             tier: 'staking',    match: (n) => n === 'Sky' || n.startsWith('Sky ') },
  /* ארנקים */
  { id: 'metamask',    name: 'MetaMask',        tier: 'wallet',     match: (n) => n.startsWith('MetaMask') },
  { id: 'trust',       name: 'Trust Wallet',    tier: 'wallet',     match: (n) => n.startsWith('Trust Wallet') || n === 'Trust Wallet' },
  { id: 'phantom',     name: 'Phantom',         tier: 'wallet',     match: (n) => n.startsWith('Phantom') },
  { id: 'coinbase',    name: 'Coinbase Wallet', tier: 'wallet',     match: (n) => n.startsWith('Coinbase Wallet') },
  { id: 'okx',         name: 'OKX',             tier: 'wallet',     match: (n) => n.startsWith('OKX') }
];

const r2 = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : 0);

async function jget(url, ms = 25000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: ac.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + url);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/* שורת-הרשת שלנו: נמדדת מספר-המנוע החי · מילי-יחידות (1000 µ = 1 אסימון) */
async function fetchJsonKeyless(url, errors, tag) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: ac.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) {
    errors.push((tag || 'keyless') + ': ' + (e && e.message ? e.message : String(e)));
    return null;
  } finally { clearTimeout(t); }
}

function measureOurs(errors, coreBook, actBook) {
  try {
    const w = JSON.parse(readFileSync(WORLD, 'utf8'));
    const m = (w.markets || []).find((x) => x.key === 'SAOS/USDS');
    const p = (w.pools || []).find((x) => x.key === 'SAOS/USDS');
    const pools = w.pools || [];
    const feesAccruedMu = pools.reduce((s, x) => s + (x.feeAccruedTreasury || 0) + (x.lpFeesMu || 0), 0);
    const poolTvlMu = p ? (p.ra || 0) + (p.rb || 0) : 0;
    const feeRateBps = p && typeof p.feeBps === 'number' ? p.feeBps : null;
    // the CORE ledger merge (CR-0077): all-time fee meters from the live core pools + the
    // measured rolling-24h volume/fees/fills from the ignition book — freshness-guarded.
    let coreFeesAllTimeMu = 0, corePools = 0, coreSeq = null, coreAt = null, coreFresh = false;
    if (coreBook && Array.isArray(coreBook.pools) && coreBook.genesisDone) {
      const ageH = (Date.now() - Date.parse(coreBook.at || '')) / 3600000;
      coreFresh = isFinite(ageH) && ageH <= 30;
      coreSeq = coreBook.seq || null; coreAt = coreBook.at || null;
      corePools = coreBook.pools.filter((x) => x && !x.planned).length;
      if (coreFresh) coreFeesAllTimeMu = coreBook.pools.reduce((s, x) => s + (Number(x.feeMeter) || 0), 0);
    }
    let m24 = null;
    if (actBook && actBook.measure24h && typeof actBook.measure24h.fills === 'number') {
      const ageH = (Date.now() - Date.parse(actBook.at || '')) / 3600000;
      if (isFinite(ageH) && ageH <= 30) m24 = actBook.measure24h;
    }
    return {
      name: 'SAOS DEX (ריבוני · keyless)',
      lastPriceUsds: m && m.poolMid ? r2(m.poolMid / 1000) : null,
      poolTvlUsds: poolTvlMu ? r2(poolTvlMu / 1000) : null,
      feesAccruedMu: feesAccruedMu + coreFeesAllTimeMu,
      feeRateBps,
      pools: pools.length + corePools,
      coreLedger: { merged: corePools > 0, seq: coreSeq, at: coreAt, fresh: coreFresh, feesAllTimeMu: coreFeesAllTimeMu },
      vol24h: m24 ? r4((Number(m24.volumeInMu) || 0) / 1e6) : null,
      fees24h: m24 ? r4((Number(m24.fees24hMu) || 0) / 1e6) : null,
      fills24h: m24 ? m24.fills : null,
      source: 'dex/world.json (' + (w.publishedAt || '?') + ') + Domain/agents/dex-core.json (core ledger' + (coreFresh ? ', fresh seq ' + coreSeq : ', stale-or-absent') + ') + dex-activation.json (24h measure' + (m24 ? ', fresh' : ', stale-or-absent') + ')',
      note: 'מדידה מספרי-המנוע החיים (world + core + activation) · עמלות-צבירה במילי-יחידות-פנימיות (SIM) · נפח/עמלות-24ש׳ נמדדים מהפנקס-החי כשהוא טרי (≤30ש׳) · לא ממציאים כלום · אפס-תביעת-ערך-חוץ'
    };
  } catch (e) {
    errors.push('ours: ' + (e && e.message ? e.message : String(e)));
    return { name: 'SAOS DEX', source: 'dex/world.json', error: 'world book unreadable at beat time' };
  }
}

function aggregate(feesProtos, dexProtos) {
  const dexByName = new Map((dexProtos || []).map((p) => [p.name, p]));
  const fams = FAMILIES.map((f) => ({ ...f, components: [] }));
  for (const p of feesProtos || []) {
    const name = typeof p.name === 'string' ? p.name : '';
    const fam = fams.find((f) => f.match(name));
    if (!fam) continue;
    const dv = dexByName.get(name) || {};
    fam.components.push({
      name,
      category: p.category || dv.category || null,
      fees24h: r2(p.total24h),
      fees30d: r2(p.total30d),
      feesAllTime: r2(p.totalAllTime),
      vol24h: r2(dv.total24h),
      vol30d: r2(dv.total30d)
    });
  }
  const out = [];
  for (const f of fams) {
    if (!f.components.length) continue;
    const sum = (k) => r2(f.components.reduce((s, c) => s + (c[k] || 0), 0));
    const cats = [...new Set(f.components.map((c) => c.category).filter(Boolean))];
    out.push({
      id: f.id,
      name: f.name,
      tier: f.tier || 'dex',
      category: cats.join(' + ') || null,
      fees24h: sum('fees24h'),
      fees30d: sum('fees30d'),
      feesAllTime: sum('feesAllTime'),
      vol24h: sum('vol24h'),
      vol30d: sum('vol30d'),
      components: f.components
    });
  }
  out.sort((a, b) => b.fees30d - a.fees30d);
  return out;
}

async function main() {
  const runAt = new Date().toISOString();
  const errors = [];
  const sources = {};
  let families = [];
  let feesProtos = null;
  let dexProtos = null;
  try {
    const fees = await jget(FEES_URL);
    feesProtos = fees.protocols || [];
    sources.fees = { url: 'api.llama.fi/overview/fees', protocols: feesProtos.length };
  } catch (e) {
    errors.push('fees: ' + (e && e.message ? e.message : String(e)));
  }
  try {
    const dexs = await jget(DEXS_URL);
    dexProtos = dexs.protocols || [];
    sources.dexs = { url: 'api.llama.fi/overview/dexs', protocols: dexProtos.length };
  } catch (e) {
    errors.push('dexs: ' + (e && e.message ? e.message : String(e)));
  }
  if (feesProtos) families = aggregate(feesProtos, dexProtos || []);
  // CR-0077: the our-row merges the Domain core ledger + ignition 24h measure (keyless GET,
  // fail-SOFT — an unreachable source degrades to null and is RECEIPTED in ours.mergeErrors;
  // it must NOT flip the book-wide ok flag, the DefiLlama sources own that truth)
  const oursErrors = [];
  const coreBook = await fetchJsonKeyless(CORE_BOOK_URL, oursErrors, 'core-book');
  const actBook = await fetchJsonKeyless(ACT_BOOK_URL, oursErrors, 'activation-book');
  const ours = measureOurs(errors, coreBook, actBook);
  if (oursErrors.length) ours.mergeErrors = oursErrors; // honest receipt, never silent

  const book = {
    ok: errors.length === 0,
    book: 'saos-giants/1.0',
    publishedAt: new Date().toISOString(),
    beat: {
      engine: 'saos-giants/1.1 giants-beat · R75 frontier league (28 families across every wealth class)',
      runAt,
      cadenceMin: 1440,
      sources,
      method: 'public GET measurement · no keys · no invention · families matched by name prefix, components kept whole · ours measured from the live engine books (world + Domain core ledger + ignition 24h)'
    },
    families,
    ours: Object.assign({ tier: 'ours' }, ours),
    errors
  };
  writeFileSync(OUT, JSON.stringify(book, null, 2) + '\n');
  const top = families[0];
  console.log(
    'giants-beat: ' + families.length + ' families · top30d: ' +
    (top ? top.name + ' $' + top.fees30d.toLocaleString('en-US') : 'n/a') +
    ' · ours: ' + (ours.lastPriceUsds ? 'SAOS @' + ours.lastPriceUsds : 'unmeasured') +
    (errors.length ? ' · ERRORS: ' + errors.join(' | ') : ' · clean')
  );
}

main().catch((e) => {
  /* fail-closed: גם כשל-כולל מפרסם עדות (ה-runner לא נופל בשקט) */
  try {
    writeFileSync(OUT, JSON.stringify({
      ok: false,
      book: 'saos-giants/1.0',
      publishedAt: new Date().toISOString(),
      beat: { engine: 'saos-giants/1.0 giants-beat · R74', runAt: new Date().toISOString(), method: 'fail-closed publish' },
      families: [],
      errors: ['fatal: ' + (e && e.message ? e.message : String(e))]
    }, null, 2) + '\n');
  } catch (_) { /* nothing else to do */ }
  console.error('giants-beat fatal (book published with failure evidence):', e && e.message ? e.message : e);
  process.exit(0);
});
