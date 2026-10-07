#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// LINE-AGREEMENT · agents/line-agreement.mjs — ספר מול שרשרת (R68)
//
// המנוע השלישי בשכבת "מנועי-הרשת על השרשרת", והשער הכי חשוב שבה:
// הספר הנגזר (mirror.json — תוצר הלב הענן) טוען טענות על הרשת.
// המפקד העצמאי (weave/census.json — תוצר קריאת-השרשרת הישירה) מחזיק
// את העובדות מהשרשרת עצמה. המנוע הזה מציב את שניהם זה מול זה:
//
//   · headHash: ה-hash הראשי שהספר מכריז מול העוגן האחרון על השרשרת
//   · checkpoints: מספר-ה-checkpoints בספר מול cp# המקסים על השרשרת
//   · attestations: ספירת-העדויות בספר מול העוגן האחרון על השרשרת
//
// פסקי-דין כנים: AGREE · DIVERGE · LEDGER-STALE · CENSUS-STALE.
// סטייה בין הספר לשרשרת היא הממצא הכי כבד שרשת-אמת יכולת להרים —
// היא נרשמת בספר משלה ומקומעת ב-workflow (ריצה אדומה ב-DIVERGE).
//
// פלט: weave/agreement.json (סופר אחד: המנוע הזה בלבד, BLOC r144-h).
// ─────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "node:fs";

const LEDGER_AGE_MAX_H = 48;  // אותה דוקטרינת-חיים כמו שיקוף הספרים
const CENSUS_AGE_MAX_H = 3;   // המפקד רץ כל שעתיים — 3ש' הוא פיגור
const CHAIN_AHEAD_LAG = 60;   // R67-C: weave-mirror יומי (18:57Z) — השרשרת מתקדמת ~1.8cp/ש' ⇒ 24ש' ≈ 43cp + סובלנות. החלון-מקומי: 60 עוגנים ≈ 43ש' מכסה את גיל-הספר המרבי (48ש' LEDGER_AGE_MAX_H נשפט לפני זה)
const log = (m) => console.log(`[line-agreement] ${m}`);

const r1 = (v) => Math.round(v * 10) / 10;

function ageHours(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return NaN;
  return (Date.now() - t) / 3600000;
}

function readBook(path, name) {
  if (!existsSync(path)) return { missing: true, name };
  try {
    const doc = JSON.parse(readFileSync(path, "utf8"));
    return { missing: false, name, doc };
  } catch (e) {
    return { missing: true, name, error: String(e.message || e).slice(0, 100) };
  }
}

const ledger = readBook("mirror.json", "mirror.json");
const census = readBook("weave/census.json", "weave/census.json");

if (ledger.missing) throw new Error("ledger book (mirror.json) unreadable — cannot judge agreement");
if (census.missing) throw new Error("chain census (weave/census.json) unreadable — run weave-census first");

const ledgerAge = ageHours(ledger.doc.generatedAt);
const censusAge = ageHours(census.doc.generatedAt);
log(`ledger ${r1(ledgerAge)}h old · census ${r1(censusAge)}h old`);

// ── שערי-טריות: ספר עייף לא נשפט מול שרשרת חיה, ומפקד עייף לא שופט
if (Number.isFinite(censusAge) && censusAge > CENSUS_AGE_MAX_H) {
  const book = {
    format: "weave-agreement-v1",
    generatedAt: new Date().toISOString(),
    verdict: "CENSUS-STALE",
    note: `census book is ${r1(censusAge)}h old (> ${CENSUS_AGE_MAX_H}h) — agreement refuses to judge on a dead measurement`,
    ledger: { ageHours: r1(ledgerAge) },
    census: { ageHours: r1(censusAge) },
    checks: [],
  };
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(new URL("../weave/", import.meta.url), { recursive: true });
  writeFileSync(new URL("../weave/agreement.json", import.meta.url), JSON.stringify(book, null, 2) + "\n");
  log(`CENSUS-STALE — honest refusal, no verdict invented`);
  process.exit(0);
}

// ── הטענות ──
// הספר נוצר בזמן T; השרשרת ממשיכה להתקדם אחרי T. לכן השיפוט הוא
// מונוטוני: השרשרת חייבת להיות בגובה הספר או מעט מעליו (בתוך סובלנות-
// פיגור), וה-headHash שהספר מכריז חייב להיות עדות על השרשרת.
const ledgerClaims = {
  headHash: String(ledger.doc.stats && ledger.doc.stats.headHash || ""),
  checkpoints: ledger.doc.stats && typeof ledger.doc.stats.checkpoints === "number" ? ledger.doc.stats.checkpoints : null,
  attestations: ledger.doc.stats && typeof ledger.doc.stats.attestations === "number" ? ledger.doc.stats.attestations : null,
};
const chainLatest = census.doc.latest || {};
const chainRows = Array.isArray(census.doc.rows) ? census.doc.rows : [];
const chainClaims = {
  headHash: String(chainLatest.headHash || ""),
  checkpoints: typeof chainLatest.checkpoint === "number" ? chainLatest.checkpoint : null,
  attestations: chainRows[0] && typeof chainRows[0].attestations === "number" ? chainRows[0].attestations : null,
};

// ── ההשוואות ──
const checks = [];

// 1. headHash: הספר מכריז על ראש — השרשרת חייבת להעיד עליו (בשורות
//    המפקד). עדות = קיים עוגן עם אותו headHash. זו הבדיקה הכבדה ביותר.
if (ledgerClaims.headHash && chainRows.length) {
  const witnessed = chainRows.find((r) => String(r.headHash || "").toLowerCase() === ledgerClaims.headHash.toLowerCase());
  checks.push({
    name: "headHash-witnessed-on-chain",
    ledger: ledgerClaims.headHash,
    chain: witnessed ? `cp#${witnessed.checkpoint} @${witnessed.at} (${witnessed.witness})` : "not found in census rows",
    match: Boolean(witnessed),
  });
}

// 2. checkpoints: השרשרת בגובה הספר או מעט מעליו (סובלנות-פיגור).
//    שרשרת מאחורי הספר = סתירה קשה (הספר מכריז דבר שלא עוגן).
if (ledgerClaims.checkpoints !== null && chainClaims.checkpoints !== null) {
  const delta = chainClaims.checkpoints - ledgerClaims.checkpoints;
  checks.push({
    name: "checkpoints-monotonic",
    ledger: ledgerClaims.checkpoints,
    chain: chainClaims.checkpoints,
    delta,
    tolerance: `chain ahead up to +${CHAIN_AHEAD_LAG}`,
    match: delta >= 0 && delta <= CHAIN_AHEAD_LAG,
  });
}

// 3. attestations: מונוטוניות זהה על ספירת-העדויות.
if (ledgerClaims.attestations !== null && chainClaims.attestations !== null) {
  const delta = chainClaims.attestations - ledgerClaims.attestations;
  checks.push({
    name: "attestations-monotonic",
    ledger: ledgerClaims.attestations,
    chain: chainClaims.attestations,
    delta,
    tolerance: `chain ahead up to +${CHAIN_AHEAD_LAG}`,
    match: delta >= 0 && delta <= CHAIN_AHEAD_LAG,
  });
}

if (checks.length === 0) {
  throw new Error("no comparable claims between ledger and census (schemas drifted?) — refusing to invent a verdict");
}

const mismatches = checks.filter((c) => !c.match);
let verdict = "AGREE";
if (Number.isFinite(ledgerAge) && ledgerAge > LEDGER_AGE_MAX_H) verdict = "LEDGER-STALE";
else if (mismatches.length > 0) verdict = "DIVERGE";

const book = {
  format: "weave-agreement-v1",
  generatedAt: new Date().toISOString(),
  doctrine: "the ledger book is judged against the independent chain census - divergence is the heaviest finding a truth network can raise",
  verdict,
  ledger: {
    book: "mirror.json",
    generatedAt: ledger.doc.generatedAt,
    ageHours: r1(ledgerAge),
    claims: ledgerClaims,
  },
  chain: {
    book: "weave/census.json",
    generatedAt: census.doc.generatedAt,
    ageHours: r1(censusAge),
    censusVerdict: census.doc.verdict,
    tilingState: census.doc.attestations && census.doc.attestations.state,
    latest: chainLatest,
    claims: chainClaims,
  },
  checks,
  mismatches: mismatches.length,
};

const { mkdirSync, writeFileSync } = await import("node:fs");
mkdirSync(new URL("../weave/", import.meta.url), { recursive: true });
writeFileSync(new URL("../weave/agreement.json", import.meta.url), JSON.stringify(book, null, 2) + "\n");

for (const c of checks) {
  log(`${c.match ? "match" : "MISMATCH"} ${c.name}: ledger=${c.ledger} chain=${c.chain}`);
}
log(`${verdict} · ${mismatches.length}/${checks.length} checks mismatched`);

if (verdict === "DIVERGE") {
  console.log(`[line-agreement] HONEST DIVERGE: the book and the chain disagree — the run exits red so the network hears it`);
  process.exit(1);
}
