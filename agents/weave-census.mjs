#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// WEAVE-CENSUS · agents/weave-census.mjs — מפקד-העומק של קו העוגן (R68)
//
// המנוע הראשון בשכבת "מנועי-הרשת על השרשרת": במקום לסמוך על הספרים
// הנגזרים (mirror.json — תוצר הלב הענן), המנוע קורא את השרשרת עצמה
// ישירות מ-RPC ציבורי ובונה מפקד עצמאי של פרוטוקול ה-weave:
//
//   · סריקת היסטוריית חשבונות הצי (cashmachine / headcorner / lsa)
//     עומק עד 15,000 ops לחשבון, איסוף כל עוגן checkpoint של
//     custom_json id=saos.weave.core.v1.
//   · רצף ה-checkpoints: פערים מספריים בתוך החלון (cp# שקפץ).
//   · טיפול העדויות: איחוד טווחי [attFrom..attTo] ואיתור חורים
//     וכפילויות בכיסוי — הרשת חייבת לספר את העדויות בלי לדלג.
//   · פיצול עדי-חתימה, קדנס בין עוגנים, ודור השורות האחרונות.
//
// חוקי הבית (זהים ל-render.mjs): אפס מפתחות, קריאה ציבורית בלבד,
// שער-סודות לפני כתיבה, כתיבה רק כשהבתים השתנו (ה-workflow דואג).
// פסק-הדין: CONTINUOUS · GAPPED · SPARSE — אדום בכנות, לא מתנצל.
//
// פלט: weave/census.json (סופר אחד: המנוע הזה בלבד, BLOC r144-h).
// ─────────────────────────────────────────────────────────────────────

const FLEET = ["cashmachine", "headcorner", "lsa"].map((a) => a.toLowerCase());
const OP_ID = process.env.WEAVE_OP_ID || "saos.weave.core.v1";
const NODES = ["https://api.steemit.com", "https://api.justyy.com"];
const PAGE = 100;           // תקרת condenser_api.get_account_history לקריאה (נמדד: 100)
const MAX_PAGES = 250;      // עד ~25,000 ops לכל חשבון
const TARGET_UNIQUE = 400;  // די למפקד חלון; חיסכון-זמן מעבר לזה
const WINDOW_DAYS = 45;     // חלון-המפקד: עוגן ישן מזה עוצר את הסריקה
const ROWS_PUBLISHED = 60;  // כמה שורות עוגן נוסעות בספר
const FRESH_H = 26;         // דוקטרינת-החיים של הבית (כ-render.mjs)
const IRREGULAR_GAP_MIN = 360; // פער-עוגן מעל 6ש' = קו לא-סדיר
const log = (m) => console.log(`[weave-census] ${m}`);

async function rpc(node, method, params) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(node, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (j.error) throw new Error(j.error.message || "rpc error");
    return j.result;
  } finally { clearTimeout(t); }
}

// failover לכל קריאה: צומת שנופל באמצע-קציר לא הורג את המפקד
async function rpcAny(method, params) {
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const node of NODES) {
      try { return await rpc(node, method, params); }
      catch (e) { last = e; }
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  throw new Error(`all nodes failed (last: ${last && last.message})`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function harvest() {
  const anchors = [];
  const scan = [];
  let opsScanned = 0;
  const cutoffAt = Date.now() - WINDOW_DAYS * 86400000;
  for (const account of FLEET) {
    let start = -1;
    let own = 0;
    let pages = 0;
    let stoppedBy = "depth-end"; // ברירת-מחדל: הגענו לתחתית ההיסטוריה
    for (let p = 0; p < MAX_PAGES && own < TARGET_UNIQUE; p++) {
      let hist = null;
      try {
        // שוליים-כנים: כשהעומק קטן מהתקרה, ה-limit חייב לרדת איתו (טענת
        // ה-API args.start >= args.limit נמדדה על @lsa בעומק 42)
        const limit = typeof start === "number" && start >= 1 ? Math.min(PAGE, start) : PAGE;
        hist = await rpcAny("condenser_api.get_account_history", [account, start, limit]);
      } catch (e) {
        // עצירה-כנה של החשבון: מה שנקצר נשמר — עומק שנכשל הוא גבול, לא קריסה
        log(`@${account}: paging stopped at depth ${start} (${e.message})`);
        stoppedBy = "rpc-limit";
        break;
      }
      if (!Array.isArray(hist) || !hist.length) break;
      pages++;
      let lowest = Infinity;
      let oldestAnchorAt = null;
      for (const [idx, entry] of hist) {
        if (typeof idx === "number" && idx < lowest) lowest = idx;
        opsScanned++;
        const op = entry && entry.op;
        if (!op || op[0] !== "custom_json") continue;
        if (!op[1] || op[1].id !== OP_ID) continue;
        let pl;
        try { pl = JSON.parse(String(op[1].json || "{}")); } catch { continue; }
        if (pl.action !== "checkpoint" || typeof pl.checkpoint !== "number") continue;
        const at = String(pl.at || "");
        anchors.push({
          checkpoint: pl.checkpoint,
          root: String(pl.root || ""),
          attFrom: typeof pl.attFrom === "number" ? pl.attFrom : null,
          attTo: typeof pl.attTo === "number" ? pl.attTo : null,
          attestations: typeof pl.attestations === "number" ? pl.attestations : null,
          headHash: String(pl.headHash || ""),
          commit: String(pl.commit || ""),
          at,
          txid: String(entry.trx_id || ""),
          block: typeof entry.block === "number" ? entry.block : null,
          witness: account,
        });
        own++;
        if (!oldestAnchorAt && at) oldestAnchorAt = at;
      }
      // עצירה-כנה: כבר הגענו מתחת לחלון — המפקד לא צריך את האבן
      if (oldestAnchorAt) {
        const ts = Date.parse(oldestAnchorAt);
        if (Number.isFinite(ts) && ts < cutoffAt) { stoppedBy = "window"; break; }
      }
      if (lowest === Infinity || lowest <= 1) break;
      start = Math.max(1, lowest - 1);
      await sleep(150); // נימוס-קצב מול RPC ציבורי
    }
    if (stoppedBy === "depth-end" && own >= TARGET_UNIQUE) stoppedBy = "target";
    if (stoppedBy === "depth-end" && pages >= MAX_PAGES) stoppedBy = "budget";
    scan.push({ account, pages, anchorOps: own, stoppedBy });
    log(`harvest @${account}: ${pages} pages, ${own} anchor ops (stopped: ${stoppedBy})`);
  }
  return { anchors, opsScanned, scan };
}

// רצף-העיגון: בין עוגנים עוקבים ייתכנו checkpoints שלא הועגנו — עובדה
// של קצב-הפרוטוקול (העוגן מפרסם כל ~29דק', ה-checkpoints מתקדמים מהר
// יותר). המפקד מודד את הדילוגים ביושר (ספירה אמת, רשימה מצונזרת
// בגלישה) — ולא שופט אותם כשבר: שיפוט-הכיסוי נעשה על טיפול-העדויות.
function sequenceSkips(uniqueDesc) {
  const skipped = [];
  let total = 0;
  for (let i = 1; i < uniqueDesc.length; i++) {
    const hi = uniqueDesc[i - 1].checkpoint;
    const lo = uniqueDesc[i].checkpoint;
    for (let miss = lo + 1; miss < hi; miss++) {
      total++;
      if (skipped.length < 50) skipped.push(miss);
    }
  }
  return { total, sample: skipped, truncated: total > 50 };
}

// טיפול: איחוד טווחי העדויות ואיתור חורים/כפילויות — ספירה אמת,
// רשימה מצונזרת בגלישה, ומצב עובדתי בלבד (TILED/HOLED/SPARSE).
function attestationTiling(uniqueDesc) {
  const ranges = uniqueDesc
    .filter((a) => typeof a.attFrom === "number" && typeof a.attTo === "number" && a.attFrom <= a.attTo)
    .map((a) => ({ from: a.attFrom, to: a.attTo, cp: a.checkpoint }))
    .sort((x, y) => x.from - y.from);
  const holes = [];
  const overlaps = [];
  let covered = 0;
  let cur = null;
  for (const r of ranges) {
    if (!cur) { cur = { ...r }; continue; }
    if (r.from > cur.to + 1) {
      holes.push({ from: cur.to + 1, to: r.from - 1 });
      covered += cur.to - cur.from + 1;
      cur = { ...r };
    } else {
      if (r.from <= cur.to) overlaps.push({ cp: r.cp, from: r.from, to: Math.min(r.to, cur.to) });
      if (r.to > cur.to) cur.to = r.to;
    }
  }
  if (cur) covered += cur.to - cur.from + 1;
  const span = ranges.length ? ranges[ranges.length - 1].to - ranges[0].from + 1 : 0;
  const state = ranges.length < 5 ? "SPARSE" : holes.length === 0 ? "TILED" : "HOLED";
  return {
    ranges: ranges.length,
    covered,
    observedSpan: span,
    coverageRatio: span ? Math.round((covered / span) * 1000) / 1000 : null,
    holesTotal: holes.length,
    holes: holes.slice(0, 30),
    holesTruncated: holes.length > 30,
    overlapsTotal: overlaps.length,
    overlaps: overlaps.slice(0, 30),
    state,
  };
}

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

// ── שער-הסודות (חוק הבית, כ-render.mjs): שום מפתח/טוקן לא עולה לריפו.
function secretGate(text) {
  const PATTERNS = [
    ["steem/hive WIF", /\b5[1-9A-HJ-NP-Za-km-z]{50}\b/],
    ["blurt WIF", /\bB[1-9A-HJ-NP-Za-km-z]{50}\b/],
    ["github token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
    ["github_pat token", /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
    ["PEM private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ["x-access-token url", /x-access-token:[A-Za-z0-9_-]+@/],
  ];
  for (const [name, re] of PATTERNS) if (re.test(text)) throw new Error(`secret gate blocked census.json: ${name}`);
  const suspicious = text
    .split("\n")
    .filter((line) => /0x[0-9a-fA-F]{64}/.test(line))
    .filter((line) => !/"(root|headHash|entryHash)"\s*:/i.test(line));
  if (suspicious.length > 0) throw new Error("secret gate blocked census.json: unrecognized 64hex line");
}

// ── main ──
let harvestRes = null;
try {
  harvestRes = await harvest();
} catch (e) {
  log(`harvest path failed: ${e.message}`);
}
if (!harvestRes) throw new Error("harvest failed on all failover paths");

const { anchors, opsScanned } = harvestRes;
if (anchors.length === 0) throw new Error(`no ${OP_ID} checkpoint anchors in fleet history — empty read is a red run`);

// דה-כפילה: אותו checkpoint שעוגן מחדש הוא שורה אחת — העדות החדשה ביותר
anchors.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
const seen = new Set();
const uniqueDesc = anchors.filter((a) => {
  if (seen.has(a.checkpoint)) return false;
  seen.add(a.checkpoint);
  return true;
});

const witnesses = {};
for (const a of uniqueDesc) witnesses[a.witness] = (witnesses[a.witness] || 0) + 1;

const skips = sequenceSkips(uniqueDesc);
const tiling = attestationTiling(uniqueDesc);
const maxCp = uniqueDesc[0].checkpoint;
const minCp = uniqueDesc[uniqueDesc.length - 1].checkpoint;

const times = uniqueDesc.map((a) => Date.parse(a.at)).filter(Number.isFinite);
const intervalsMin = [];
for (let i = 1; i < times.length; i++) intervalsMin.push((times[i - 1] - times[i]) / 60000);
const spanDays = times.length > 1 ? (times[0] - times[times.length - 1]) / 86400000 : 0;

const latestAgeH = (Date.now() - times[0]) / 3600000;
const medMin = median(intervalsMin);
const maxMin = intervalsMin.length ? Math.max(...intervalsMin) : null;

// פסק-דין על חיות-הקו (מדידה, לא ניחוש-סמנטיקה של הפרוטוקול):
//   LIVE      — הקו מתקדם (עוגן אחרון טרי מ-26ש') ובקצב סדיר
//   IRREGULAR — חי אך פער-עוגן מקסימלי חריג (מעל 6ש')
//   STALLED   — העוגן האחרון זקן מ-26ש' (דוקטרינת-החיים של הבית)
//   SPARSE    — פחות מ-5 עוגנים ייחודיים בחלון: אין במה לשפוט
let verdict;
if (uniqueDesc.length < 5) verdict = "SPARSE";
else if (latestAgeH > FRESH_H) verdict = "STALLED";
else if (maxMin !== null && maxMin > IRREGULAR_GAP_MIN) verdict = "IRREGULAR";
else verdict = "LIVE";

const book = {
  format: "weave-census-v1",
  generatedAt: new Date().toISOString(),
  doctrine: "independent chain-level census of the weave anchor protocol - read straight from the public Steem RPC, zero keys, zero derived books",
  source: {
    kind: "steem-public-rpc",
    nodes: NODES.map((n) => new URL(n).hostname),
    failover: "per-call",
    accounts: FLEET,
    opId: OP_ID,
    maxPagesPerAccount: MAX_PAGES,
    opsScanned,
    perAccount: harvestRes.scan,
  },
  window: {
    days: WINDOW_DAYS,
    fromCp: minCp,
    toCp: maxCp,
    fromAt: uniqueDesc[uniqueDesc.length - 1].at,
    toAt: uniqueDesc[0].at,
    spanDays: Math.round(spanDays * 100) / 100,
  },
  verdict,
  freshness: {
    latestAgeHours: Math.round(latestAgeH * 10) / 10,
    thresholdHours: FRESH_H,
    irregularGapMinutes: IRREGULAR_GAP_MIN,
  },
  totals: {
    uniqueCheckpoints: uniqueDesc.length,
    anchorOpsSeen: anchors.length,
    retriesDeduped: anchors.length - uniqueDesc.length,
    witnesses,
  },
  anchoring: {
    skippedCheckpoints: skips,
  },
  attestations: tiling,
  cadence: {
    medianMinutes: medMin,
    maxMinutes: maxMin !== null ? Math.round(maxMin) : null,
  },
  latest: {
    checkpoint: uniqueDesc[0].checkpoint,
    root: uniqueDesc[0].root,
    headHash: uniqueDesc[0].headHash,
    at: uniqueDesc[0].at,
    witness: uniqueDesc[0].witness,
    txid: uniqueDesc[0].txid,
  },
  rows: uniqueDesc.slice(0, ROWS_PUBLISHED),
};

const text = JSON.stringify(book, null, 2) + "\n";
secretGate(text);
const { mkdirSync, writeFileSync } = await import("node:fs");
mkdirSync(new URL("../weave/", import.meta.url), { recursive: true });
writeFileSync(new URL("../weave/census.json", import.meta.url), text);

log(
  `${verdict} · ${uniqueDesc.length} unique anchors (cp#${minCp}..${maxCp}) · ` +
  `${skips.total} cps skipped by cadence · tiling ${tiling.state} (${tiling.holesTotal} holes, coverage ${tiling.coverageRatio}) · ` +
  `cadence median ${Math.round(medMin)}m max ${Math.round(maxMin)}m · latest ${Math.round(latestAgeH * 10) / 10}h old · ` +
  `witnesses ${JSON.stringify(witnesses)} · window ${Math.round(spanDays * 10) / 10}d · ${opsScanned} ops scanned`
);
if (verdict !== "LIVE") {
  log(`HONEST ${verdict}: the book records the measured state, the run stays honest`);
}
