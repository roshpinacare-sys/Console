#!/usr/bin/env node
/* FEE-LAW (R76) · חוק-העמלה הדינמית מודעת-התנודתיות · ה-Meteora-take הריבוני
 * =============================================================================
 * המנגנון שמעשיר את Meteora: עמלות-דינמיות שגדלות עם התנודתיות המדודה - ספקי-הנזילות
 * מפוצים בדיוק כשהסיכון שלהם גדל. ה-take שלנו: אותו חוק, נמדד אך ורק מהספר הרשמי
 * שלנו (dex/world.json), keyless, בלי שום קלט-חוץ, אפס המצאה:
 *
 *   σ_bps = max(twapDevBps, fairGapBps, range24Bps)   · שלוש מדידות-הפיזור של הספר עצמו
 *   fee_bps = clamp(base + K_VOL × σ, base, min(2 × base, CAP_ABS))
 *
 *   twapDevBps  · הפיזור המדוד של ה-TWAP סביב המחיר (מהספר)
 *   fairGapBps  · הפער בין ה-fair המדוד ל-poolMid (מהספר)
 *   range24Bps  · טווח 24h (high-low) יחסית למרכז הטווח (מהספר)
 *
 * בריכה בלי σ מדודה: העמלה נשארת הבסיס (כנות, לא המצאה). ספר ישן מ-30h: החוק DRY.
 * יישום: חלון-ההחלפה בקונסולה מצטט ומציג את עמלת-החוק (fail-closed לבסיס) · בריכות
 * מנוע-ה-DEX עצמן: ARMED-PENDING - ההצמדה לספר-המנוע היא שער-הבעלים (חוק STASIS,
 * כותב-יחיד: ספר-המנוע בבעלות המנוע).
 *
 * הרצה: node dex/fee-law.mjs   (runner ציבורי · node 20 · אפס מפתחות · fail-closed)
 */
'use strict';
import { readFileSync, writeFileSync } from 'node:fs';

const OUT = new URL('./fee-law.json', import.meta.url).pathname;
const WORLD = new URL('./world.json', import.meta.url).pathname;

/* קבועי-החוק · גלויים, דטרמיניסטיים, ללא מספרים-קסומים */
const K_VOL = 1;          // 1bps עמלה על כל 1bps פיזור-מדוד
const CAP_ABS_BPS = 200;  // תקרה מוחלטת
const CAP_FACTOR = 2;     // לעולם לא יותר מכפול-הבסיס
const MAX_AGE_H = 30;     // מעל זה הספר ישן - החוק DRY

const book_err = (publishedAt, msg) => ({
  ok: false, book: 'saos-fee-law/1.0', publishedAt,
  engine: 'saos-fee-law/1.0 fee-law · R76 the vol-aware dynamic fee law (the Meteora take)',
  verdict: 'DRY (fail-closed)', errors: [String(msg).slice(0, 300)],
  laws: LAWS_TEXT,
});

const LAWS_TEXT = [
  'כל הקלטות מהספר הרשמי בלבד (dex/world.json) · אפס קלט-חוץ · אפס המצאה',
  'fee_bps = clamp(base + K_VOL × σ, base, min(2 × base, 200)) · קבועי-החוק גלויים בספר',
  'σ = max(twapDevBps, fairGapBps, range24Bps) · שלוש מדידות-הפיזור של הספר עצמו',
  'בריכה בלי σ מדודה: העמלה נשארת הבסיס · החוק לא ממציא פיזור',
  'ספר ישן מ-30h: החוק DRY · fail-closed',
  'היישום בחלון-ההחלפה: חי · ההצמדה לבריכות-המנוע: ARMED-PENDING (שער-הבעלים, חוק STASIS)',
];

async function main() {
  const publishedAt = new Date().toISOString();
  let world = null;
  try {
    world = JSON.parse(readFileSync(WORLD, 'utf8'));
  } catch (e) {
    writeFileSync(OUT, JSON.stringify(book_err(publishedAt, 'world.json unreadable: ' + e.message), null, 1) + '\n');
    console.log('fee-law: DRY (world.json unreadable)'); return;
  }
  const worldAt = world.publishedAt || null;
  const ageH = worldAt ? (Date.now() - Date.parse(worldAt)) / 3600000 : Infinity;
  const fresh = isFinite(ageH) && ageH <= MAX_AGE_H;
  const m = (Array.isArray(world.markets) && world.markets[0]) || null;
  if (!fresh || !m) {
    const b = book_err(publishedAt, fresh ? 'no market row in the world book' : ('world book stale: ' + (isFinite(ageH) ? ageH.toFixed(1) + 'h' : 'unknown age')));
    b.inputs = { worldAt, ageHours: isFinite(ageH) ? +ageH.toFixed(2) : null, maxAgeH: MAX_AGE_H };
    writeFileSync(OUT, JSON.stringify(b, null, 1) + '\n');
    console.log('fee-law: DRY (' + (fresh ? 'no market' : 'stale book') + ')'); return;
  }

  /* שלוש מדידות-הפיזור - כל הקלטים מהספר עצמו */
  const poolMid = Number(m.poolMid) || 0;
  const fair = Number(m.fair) || 0;
  const fairGapBps = poolMid > 0 && fair > 0 ? Math.abs(fair - poolMid) * 10000 / poolMid : 0;
  const hi = Number((m.stats24 || {}).high24) || 0;
  const lo = Number((m.stats24 || {}).low24) || 0;
  const range24Bps = hi > 0 && lo > 0 && (hi + lo) > 0 ? (hi - lo) * 10000 / ((hi + lo) / 2) : 0;
  const twapDevBps = Number(m.twapDevBps) || 0;
  const sigmaBps = Math.max(twapDevBps, fairGapBps, range24Bps);

  const clampLaw = (base, sigma) => {
    const cap = Math.min(base * CAP_FACTOR, CAP_ABS_BPS);
    return Math.min(Math.max(base + K_VOL * sigma, base), cap);
  };

  const pools = (Array.isArray(world.pools) ? world.pools : []).map((p) => {
    const base = Number(p.feeBps) || 0;
    const own = p.key === m.key; /* רק לבריכה של השוק הנמדד יש σ מהספר · לשאר: כנות - אין מדידה */
    const sigma = own ? sigmaBps : null;
    const fee = sigma == null ? base : clampLaw(base, sigma);
    return {
      key: p.key, baseBps: base,
      sigmaBps: sigma == null ? null : +sigma.toFixed(2),
      feeBps: +fee.toFixed(2),
      deltaBps: +(fee - base).toFixed(2),
      basis: own ? 'measured (twapDev ' + twapDevBps + 'bps · fairGap ' + fairGapBps.toFixed(2) + 'bps · range24 ' + range24Bps.toFixed(2) + 'bps)' : 'no measured sigma for this pool - the fee stays the base (no invention)',
    };
  });

  const changed = pools.filter((p) => p.deltaBps > 0);
  const allFeesAtOrAboveBase = pools.every((p) => p.feeBps >= p.baseBps - 1e-9); /* חוק-העמלה לעולם לא מוריד מתחת לבסיס */
  const book = {
    ok: true, book: 'saos-fee-law/1.0', publishedAt,
    engine: 'saos-fee-law/1.0 fee-law · R76 the vol-aware dynamic fee law (the Meteora take)',
    verdict: changed.length ? 'LIVE (the measured volatility raised ' + changed.length + ' pool fee(s) above base)' : 'LIVE-AT-BASE (measured volatility does not exceed the base fee right now)',
    law: {
      formula: 'fee_bps = clamp(base + K_VOL × σ, base, min(2 × base, 200))',
      formulaHe: 'עמלה = clamp(בסיס + K_VOL × σ, בסיס, מינימום(2 × בסיס, 200))',
      K_VOL, CAP_ABS_BPS, CAP_FACTOR, maxAgeH: MAX_AGE_H,
      mechanism: 'the Meteora take: fees rise with MEASURED volatility so LPs are compensated exactly when their risk rises · our σ is measured from our own official book only',
    },
    inputs: {
      worldAt, ageHours: +ageH.toFixed(2), maxAgeH: MAX_AGE_H, fresh,
      market: m.key,
      twapDevBps, fairGapBps: +fairGapBps.toFixed(2), range24Bps: +range24Bps.toFixed(2),
      sigmaBps: +sigmaBps.toFixed(2),
      stats24: { high24: hi, low24: lo, last: (m.stats24 || {}).last ?? null },
    },
    pools,
    checks: {
      allFeesAtOrAboveBase,
      note: 'self-audit law: the dynamic fee can only RAISE a fee above the book base, never lower it',
    },
    application: {
      swapWindow: 'LIVE · the Console swap window quotes and displays the law fee (fail-closed to the static base when this book is missing or older than 30h)',
      enginePools: 'ARMED-PENDING · the engine book keeps its base fees until the owner gate adopts the law (STASIS law · single-writer: the engine owns its pools)',
    },
    laws: LAWS_TEXT,
    errors: [],
  };
  writeFileSync(OUT, JSON.stringify(book, null, 1) + '\n');
  console.log('fee-law: ' + book.verdict + ' · sigma=' + sigmaBps.toFixed(2) + 'bps (twap ' + twapDevBps + ' · fairGap ' + fairGapBps.toFixed(2) + ' · range24 ' + range24Bps.toFixed(2) + ') · pools=' + pools.length + ' · raised=' + changed.length);
}

main().catch((e) => {
  try { writeFileSync(OUT, JSON.stringify(book_err(new Date().toISOString(), 'fatal: ' + (e && e.message ? e.message : e)), null, 1) + '\n'); } catch (_) {}
  console.error('fee-law fatal (book published with failure evidence):', e && e.message ? e.message : e);
});
