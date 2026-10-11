// PNL-DESK — ספר-ה-edge השבועי (T2, תוכנית-האב 2026-10-11) — מרכז-האמת של Console
//
// החוק הכלכלי שהבעלים אישר: "אדג' חיובי או כבוי". הגריד לא רץ רק בגלל שהוא יכול —
// הוא רץ רק אם הספר השבועי מראה edge ≥ +1%. הסוכן הזה מודד את זה מהמקורות החיים:
//   1. Domain raw agents/pnl-book.json — ספר-ה-PnL החתום (lifetime + postLaw),
//   2. Domain raw agents/fill-ledger-fills.jsonl — מילויים אמיתיים מהשרשרת
//      (חלון-7 ימים מחושב כאן, עצמאית — לא מועתק מאף ספר אחר).
//
// פסק-הדין נכתב ל-dex/pnl-desk.json; מראת-Console-השעתית מביאה אותו ל-Domain,
// ושם market-exec (governorVerdict) מציית: EDGE-NEGATIVE-GRID-HOLD = אפס הצבות.
//
// אפס-מפתחות · קריאה-בלבד · fail-soft לכל מקור בנפרד (null + סיבה, שום דבר לא מדומה)
// · כל פסק נושא מספרים, לא כוונות.

import { writeFileSync, readFileSync } from "node:fs";

const OUT_PATH = process.env.PNL_DESK_PATH || "dex/pnl-desk.json";
const RAW = (file) => `https://raw.githubusercontent.com/roshpinacare-sys/Domain/main/${file}`;
const EDGE_FLOOR_PCT = 1.0;      // המדד של התוכנית: edge ≥ +1% שבועי
const WINDOW_DAYS = 7;
const MAX_SOURCE_AGE_H = 48;

const r4 = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null);

async function rawText(url) {
  const r = await fetch(url + `?t=${Date.now()}`, { headers: { "User-Agent": "pnl-desk" } });
  if (!r.ok) throw new Error(`${r.status} ${url.slice(0, 80)}`);
  return r.text();
}

async function readPnlBook() {
  try {
    const rows = JSON.parse(await rawText(RAW("agents/pnl-book.json")));
    if (!Array.isArray(rows) || !rows.length) throw new Error("empty book");
    return { book: rows[rows.length - 1], ok: true };
  } catch (e) { return { ok: false, why: String(e.message || e).slice(0, 90) }; }
}

async function readFills() {
  try {
    const text = await rawText(RAW("agents/fill-ledger-fills.jsonl"));
    return { rows: text.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean), ok: true };
  } catch (e) { return { ok: false, why: String(e.message || e).slice(0, 90) }; }
}

// trailing-7d from the chain fill ledger — sells: STEEM→SBD, buys: SBD→STEEM.
// edgePct = (sellVwap − buyVwap) / buyVwap × 100 — positive means we sold dearer than we bought.
function trailingEdge(rows, nowMs) {
  const since = nowMs - WINDOW_DAYS * 864e5;
  let sellSbd = 0, sellSteem = 0, buySbd = 0, buySteem = 0, fills = 0, skipped = 0;
  for (const r of rows || []) {
    const leg = r && r.leg_parsed;
    if (!leg || (leg.leg !== "SELL" && leg.leg !== "BUY")) { skipped++; continue; }
    const ts = Date.parse(String(r.timestamp || leg.timestamp || "").includes("T") ? r.timestamp + (r.timestamp.endsWith("Z") ? "" : "Z") : String(r.timestamp || "").replace(" ", "T") + "Z");
    if (!Number.isFinite(ts) || ts < since) { skipped++; continue; }
    const price = Number(leg.price);
    if (!(price > 0)) { skipped++; continue; }
    const sold = leg.sold && Number(leg.sold.micro), recv = leg.recv && Number(leg.recv.micro);
    if (!Number.isFinite(sold) || !Number.isFinite(recv) || sold <= 0 || recv <= 0) { skipped++; continue; }
    fills++;
    if (leg.leg === "SELL") { // sold STEEM (micro) → recv SBD (micro)
      sellSteem += sold / 1e6; sellSbd += recv / 1e6;
    } else { // sold SBD → recv STEEM
      buySbd += sold / 1e6; buySteem += recv / 1e6;
    }
  }
  const sellVwap = sellSteem > 0 ? sellSbd / sellSteem : null;
  const buyVwap = buySteem > 0 ? buySbd / buySteem : null;
  const edgePct = sellVwap != null && buyVwap != null && buyVwap > 0 ? ((sellVwap - buyVwap) / buyVwap) * 100 : null;
  return {
    windowDays: WINDOW_DAYS,
    fills, skippedRows: skipped,
    sellSteem: r4(sellSteem), sellSbd: r4(sellSbd), buySbd: r4(buySbd), buySteem: r4(buySteem),
    sellVwap: r4(sellVwap), buyVwap: r4(buyVwap),
    edgePct: edgePct != null ? Math.round(edgePct * 100) / 100 : null,
    realizedSbd: r4(sellSbd - buySbd),
  };
}

function verdictFor(t, bookOk) {
  if (!bookOk) return "GOVERNOR-SOURCES-DEGRADED"; // both books unreadable — the desk says so, it never guesses
  if (t.edgePct == null) return "EDGE-UNMEASURED-NO-FILLS"; // window empty — nothing traded, hold is the standing default
  if (t.edgePct >= EDGE_FLOOR_PCT) return "EDGE-POSITIVE-GRID-MAY-RUN";
  return "EDGE-NEGATIVE-GRID-HOLD";
}

const nowMs = Date.now();
const book = await readPnlBook();
const fills = await readFills();
const trailing = fills.ok ? trailingEdge(fills.rows, nowMs) : { windowDays: WINDOW_DAYS, fills: null, why: fills.why, edgePct: null };
const verdict = verdictFor(trailing, book.ok && fills.ok);

const out = {
  format: "saos-pnl-desk/1",
  generatedAt: new Date(nowMs).toISOString(),
  law: `weekly edge >= +${EDGE_FLOOR_PCT}% or the grid holds (T2, master plan 2026-10-11 — "edge positive or off")`,
  sources: {
    pnlBook: book.ok ? { fetched: true, ts: book.book.ts || null } : { fetched: false, why: book.why },
    fillLedger: fills.ok ? { fetched: true, rows: fills.rows.length } : { fetched: false, why: fills.why },
    maxSourceAgeH: MAX_SOURCE_AGE_H,
  },
  lifetime: book.ok ? book.book.lifetime || null : null,
  postLaw: book.ok ? book.book.postLaw || null : null,
  trailing7d: trailing,
  verdict,
  consumer: "Domain market-exec governorVerdict() reads this verdict via the hourly mirror — EDGE-NEGATIVE-GRID-HOLD suppresses all placements",
};
writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
console.log(`pnl-desk] verdict=${verdict} · trailing7d edge=${trailing.edgePct}% · fills=${trailing.fills} · lifetime edge=${out.lifetime && out.lifetime.edgePct}%`);
