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
const UA = 'saos-giants-beat/1.0 (keyless public measurement; repo roshpinacare-sys/Console)';
const FEES_URL = 'https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true';
const DEXS_URL = 'https://api.llama.fi/overview/dexs?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true';

/* משפחות-הענקים: התאמה לפי-תחילית שם בלבד · כל רכיב נשמר במלואו (אין הסתרה) */
const FAMILIES = [
  { id: 'uniswap',     name: 'Uniswap',     match: (n) => n.startsWith('Uniswap') },
  { id: 'jupiter',     name: 'Jupiter',     match: (n) => n.startsWith('Jupiter') },
  { id: 'hyperliquid', name: 'Hyperliquid', match: (n) => n.startsWith('Hyperliquid') },
  { id: 'pancakeswap', name: 'PancakeSwap', match: (n) => n.startsWith('PancakeSwap') },
  { id: 'raydium',     name: 'Raydium',     match: (n) => n.startsWith('Raydium') },
  { id: 'curve',       name: 'Curve',       match: (n) => n.startsWith('Curve') },
  { id: 'meteora',     name: 'Meteora',     match: (n) => n.startsWith('Meteora') },
  { id: 'orca',        name: 'Orca',        match: (n) => n.startsWith('Orca') },
  { id: 'metamask',    name: 'MetaMask',    match: (n) => n.startsWith('MetaMask') }
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
function measureOurs(errors) {
  try {
    const w = JSON.parse(readFileSync(WORLD, 'utf8'));
    const m = (w.markets || []).find((x) => x.key === 'SAOS/USDS');
    const p = (w.pools || []).find((x) => x.key === 'SAOS/USDS');
    const pools = w.pools || [];
    const feesAccruedMu = pools.reduce((s, x) => s + (x.feeAccruedTreasury || 0) + (x.lpFeesMu || 0), 0);
    const poolTvlMu = p ? (p.ra || 0) + (p.rb || 0) : 0;
    const feeRateBps = p && typeof p.feeBps === 'number' ? p.feeBps : null;
    return {
      name: 'SAOS DEX (ריבוני · keyless)',
      lastPriceUsds: m && m.poolMid ? r2(m.poolMid / 1000) : null,
      poolTvlUsds: poolTvlMu ? r2(poolTvlMu / 1000) : null,
      feesAccruedMu,
      feeRateBps,
      pools: pools.length,
      source: 'dex/world.json · publishedAt ' + (w.publishedAt || '?'),
      note: 'מדידה מהספר החי · עמלות-צבירה הן מצטבר-כל-הזמנים במילי-יחידות · לא ממציאים עמלות-24h שהספר לא מפרסם'
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
  const ours = measureOurs(errors);

  const book = {
    ok: errors.length === 0,
    book: 'saos-giants/1.0',
    publishedAt: new Date().toISOString(),
    beat: {
      engine: 'saos-giants/1.0 giants-beat · R74 keyless wealth league',
      runAt,
      cadenceMin: 1440,
      sources,
      method: 'public GET measurement · no keys · no invention · families matched by name prefix, components kept whole · ours measured from the live engine book'
    },
    families,
    ours,
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
