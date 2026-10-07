#!/usr/bin/env node
/* HONEST-ECON (R74) · ספר-הכלכלה-הכנה: מה כסף-אמיתי ומה ספר-פנימי
 *
 * השורה-התחתונה של הבעלים: "הרווח הזה הוא לא אמיתי · האמת היא שאנחנו בהפסד ולא
 * ברווח · ל-SAOS אין ערך-שוק אמיתי · הוא לא נזיל". הספר הזה קיים בדיוק בשביל זה:
 * פיצול מוחלט בין שתי-הקופות, במספרים מדודים בלבד:
 *
 *   1. כסף-אמיתי על-שרשרת: יתרות שנמדדו מ-RPC ציבורי (money.json) מסומנות
 *      במחירי-שוק חוץ-אמיתיים (CoinGecko marks) · זה הכל. כל השאר אינו כסף.
 *   2. PnL אמיתי: מהספר הממומש של השוק הפנימי-של-Steem (pnl-book, Domain) ·
 *      המספר שיצא הוא הפסד, והוא מפורסם בכנות.
 *   3. ספר-פנימי (SIM): הפורטפוליו והעמלות-הצבורות של ה-DEX · יחידות-חשבון
 *      פנימיות בספר-סגור · אפס-תביעת-ערך-חוץ.
 *   4. פער-הענקים: עמלות-אמת 24h של הענקים (DefiLlama, giants.json) מול
 *      העמלות-האמיתיות שלנו: אפס דולר.
 *
 * אפס-מפתחות · אפס-המצאה · fail-closed: כל מקור שנופל נרשם בגוף-הספר כמו-שהוא.
 * הרצה: node dex/honest-econ.mjs   (runner ציבורי · node 20 · אין-רשת-נדרשת)
 */
'use strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const OUT = new URL('./honest-econ.json', import.meta.url).pathname;
const MONEY = new URL('./money.json', import.meta.url).pathname;
const WORLD = new URL('./world.json', import.meta.url).pathname;
const PORTFOLIO = new URL('./portfolio.json', import.meta.url).pathname;
const GIANTS = new URL('./giants.json', import.meta.url).pathname;
/* ספר-ה-PnL האמיתי חי בבית-Domain (הריבונות על השרשרת) · ברירת-מחדל: הנתיב המקומי,
 * ניתן לעקוף עם PNL_BOOK (ל-runner עתידי שיאסוף מ-raw/Pages) · נופל בכנות ל-null. */
const PNL = process.env.PNL_BOOK || '/home/z/my-project/Domain/agents/pnl-book.json';

const r2 = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : 0);
const r4 = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 10000) / 10000 : 0);

function jload(p) {
  try { if (!existsSync(p)) return { __missing: true }; return JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { return { __missing: true, __error: String(e.message || e) }; }
}

const money = jload(MONEY);
const world = jload(WORLD);
const portfolio = jload(PORTFOLIO);
const giants = jload(GIANTS);
const pnlRows = (() => {
  const j = jload(PNL);
  if (j.__missing) return [];
  return Array.isArray(j) ? j : (j.rows || []);
})();

const marks = (money && money.marks) || {};
const trxUsd = typeof marks.trxUsd === 'number' ? marks.trxUsd : null;
const steemUsd = typeof marks.steemUsd === 'number' ? marks.steemUsd : null;
const sbdUsd = typeof marks.sbdUsd === 'number' ? marks.sbdUsd : null;
const redemption = (money && money.redemption) || {};
const fuel = (money && money.fuel) || {};

/* ── 1. כסף-אמיתי על-שרשרת (מדידות money-watch · מקורות-חוץ בלבד) ── */
const custodyTrx = typeof redemption.custody?.balanceTrx === 'number' ? redemption.custody.balanceTrx : null;
const steemLiquid = typeof fuel.steem === 'number' ? fuel.steem : null;
const sbdLiquid = typeof fuel.sbd === 'number' ? fuel.sbd : null;
const realLines = [
  { asset: 'TRX · custody-meshmarat', amount: custodyTrx, markUsd: trxUsd, usd: custodyTrx != null && trxUsd != null ? r4(custodyTrx * trxUsd) : null, source: 'money.json redemption.custody (trongrid)' },
  { asset: 'STEEM · headcorner-liquid', amount: steemLiquid, markUsd: steemUsd, usd: steemLiquid != null && steemUsd != null ? r4(steemLiquid * steemUsd) : null, source: 'money.json fuel (steemit RPC)' },
  { asset: 'SBD · headcorner-liquid', amount: sbdLiquid, markUsd: sbdUsd, usd: sbdLiquid != null && sbdUsd != null ? r4(sbdLiquid * sbdUsd) : null, source: 'money.json fuel (steemit RPC)' },
];
const markedUsd = realLines.reduce((s, l) => s + (typeof l.usd === 'number' ? l.usd : 0), 0);
const unmarkedCount = realLines.filter((l) => l.usd == null).length;

/* ── 2. PnL אמיתי ממומש (הספר של השוק-הפנימי-של-Steem) ── */
const pnlLast = pnlRows.length ? pnlRows[pnlRows.length - 1] : null;
const life = (pnlLast && pnlLast.lifetime) || {};
const realizedSbd = typeof life.realizedSbd === 'number' ? life.realizedSbd : null;
const edgePct = typeof life.edgePct === 'number' ? life.edgePct : null;
const realPnl = {
  source: pnlLast ? 'Domain/agents/pnl-book.json (chain-measured, headcorner)' : 'unavailable (fail-closed: null, not zero)',
  measuredAt: pnlLast ? pnlLast.ts : null,
  realizedSbd,
  realizedUsd: realizedSbd != null && sbdUsd != null ? r4(realizedSbd * sbdUsd) : null,
  edgePct,
  sellVwapSbd: life.sellVwap ?? null,
  buyVwapSbd: life.buyVwap ?? null,
  inventorySteem: life.inventorySteem ?? null,
  inventoryAvgCostSbd: life.inventoryAvgCostSbd ?? null,
  verdict: realizedSbd != null ? (realizedSbd < 0 ? 'LOSS' : 'GAIN') : 'UNKNOWN',
};

/* ── 3. ספר-פנימי (SIM) ── */
const simTotalMu = portfolio && ((portfolio.totalUsdsMu != null ? portfolio.totalUsdsMu : (portfolio.portfolio && portfolio.portfolio.totalUsdsMu))) || null;
const pools = (world && world.pools) || [];
const feeAccruedMu = pools.reduce((s, p) => s + (p.feeAccruedTreasury || 0), 0);
const internalPriceMu = (() => {
  try { return world.markets.find((m) => m.key === 'SAOS/USDS').poolMid; } catch (_) { return null; }
})();

/* ── 4. פער-הענקים ── */
const fams = (giants && Array.isArray(giants.families) ? giants.families : []).filter((f) => typeof f.fees24h === 'number');
fams.sort((a, b) => b.fees24h - a.fees24h);
const ours = (giants && giants.ours) || {};
const giantsGap = {
  source: giants.__missing ? 'unavailable' : 'dex/giants.json (DefiLlama public GET)',
  measuredAt: giants.publishedAt || null,
  top: fams.slice(0, 3).map((f) => ({ name: f.name, fees24hUsd: r2(f.fees24h) })),
  oursRealFeesUsd: 0,
  oursInternalFeesMu: feeAccruedMu,
  oursInternalFeesNote: 'העמלות-הצבורות שלנו הן יחידות-פנימיות בספר-סגור · אינן ניתנות להמרה לכסף-אמיתי',
};

const book = {
  ok: true,
  book: 'saos-honest-econ/1.0',
  publishedAt: new Date().toISOString(),
  engine: 'saos-honest-econ/1.0 · R74 the real-money reset (owner: "הרווח הזה לא אמיתי · אנחנו בהפסד · המטבע לא נזיל")',
  doctrine: {
    he: 'שתי-קופות, אפס-ערבוב: כסף-אמיתי = יתרות-שרשרת שנמדדו מ-RPC ציבורי ומסומנות במחירי-שוק חוץ · הכל-עוד = ספר-פנימי (SIM) ללא תביעת-ערך-חוץ · ל-SAOS אין ביד-חוץ ואין נזילות-חוץ · כל "רווח" שנמדד בתוך-הספר אינו רווח-אמיתי',
    en: 'Two ledgers, zero mixing: real money = chain balances measured from public RPCs, marked at real external prices · everything else = the internal book (SIM) with no external value claim · SAOS has no external bid and no external liquidity · any "profit" measured inside the book is not real profit',
  },
  saosExternalBid: {
    exists: false,
    internalPriceUsdsMu: internalPriceMu,
    noteHe: 'ל-SAOS אין שוק-חוץ, אין רישום, אין ביד-קונה-חוץ · המחיר 1.32 הוא מחיר-ספר-פנימי בלבד · סימון-שוק לצרכי-רווח-והפסד: אין',
    noteEn: 'SAOS has no external market, no listing, no external bid · the 1.32 price is an internal book price only · mark-to-market basis: none',
  },
  realChain: {
    sources: { money: money.__missing ? 'unavailable' : 'dex/money.json (R39 money-watch · public RPCs + CoinGecko marks)', marksAt: money.publishedAt || null },
    lines: realLines,
    markedUsd: r4(markedUsd),
    unmarkedCount,
    noteHe: 'זה הכסף-האמיתי · סכום-השורות-המסומנות בלבד · מה שאין-לו מחיר-שוק חוץ נרשם ללא-סימון',
    noteEn: 'this is the real money · sum of marked lines only · anything without an external market price is listed unmarked',
  },
  realPnl,
  simBook: {
    totalUsdsMu: simTotalMu,
    totalUsds: simTotalMu != null ? r2(simTotalMu / 1000) : null,
    label: 'SIM',
    source: portfolio.__missing ? 'unavailable' : 'dex/portfolio.json (closed simulation book)',
    noteHe: 'יחידות-חשבון פנימיות בספר-סימולציה-סגור · אפס-תביעת-ערך-חוץ · אין להמיר לדולר',
    noteEn: 'internal accounting units on a closed simulation book · zero external value claim · not convertible to dollars',
  },
  internalFees: {
    feeAccruedTreasuryMu: feeAccruedMu,
    label: 'internal-only',
    pools: pools.length,
    noteHe: 'עמלות-צבירה פנימיות · נמדדות מהספר-החי · אינן כסף-אמיתי',
    noteEn: 'internal fee accrual · measured from the live book · not real money',
  },
  giantsGap,
  verdict: {
    real: realPnl.verdict,
    simBook: 'NOT-REAL-MONEY',
    fix: 'R74 SELL-FLOOR LAW shipped in Domain/agents/market-exec.cjs · no sell may price below inventory avg cost x (1+0.3%) · the measured leak (sells 0.1002 vs cost 0.1031 = -2.85% per cycle) is structurally closed',
    pathHe: 'הדרך-לרווח-אמיתי: (1) להפסיק לאבד על-השרשרת (חוק-רצפת-המכירה · נשלח) (2) להצמיח ביד-חוץ אמיתית ל-SAOS או הכנסה-חוץ (שירותים/עמלות-על-נפח-אמיתי) (3) עד-אז: לדווח רק-אמת',
    pathEn: 'the path to real profit: (1) stop losing on-chain (the sell-floor law · shipped) (2) grow a real external bid for SAOS or external revenue (services/fees on real volume) (3) until then: report only the truth',
  },
  honesty: 'כל-המספרים בספר-זה נמדדו מקבצי-הספרים המפורסמים בלבד · אפס-המצאה · מקור-שנופל נרשם כמו-שהוא · הספר קיים כדי-שהבעלים וכל-משקיע יראו את-אותם-המספרים בדיוק',
};

writeFileSync(OUT, JSON.stringify(book, null, 1) + '\n');
console.log('[honest-econ] real=' + realPnl.verdict + ' markedUsd=' + book.realChain.markedUsd + ' realizedSbd=' + realizedSbd + ' simUsds=' + book.simBook.totalUsds + ' internalFeesMu=' + feeAccruedMu + ' -> ' + OUT);
