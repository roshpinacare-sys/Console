#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · weave-verify-book — נתיב ה-replay הציבורי (חוק 13)
//
// "אמת = חישוב-מחדש": סקריפט עצמאי שכל צד שלישי יכול להריץ מ-clone
// של הריפו — בלי Prisma, בלי DB, בלי מפתחות, בלי לסמוך עלינו.
//
// מה הוא מאמת (הכל מ-sovereign/ledger.json — הספר המיוצא, חסר-סודות):
//   1. שרשרת האימותים: entryHash/prevHash/seq — חישוב מחדש מהקנון
//   2. כל חתימת EIP-191 — ecrecover מול כתובת הסוכן הרשום
//   3. כל evidenceHash — hashText מהראיה השמורה
//   4. שרשרת אירועי השוק: entryHash/prevHash/seq + חתימות לפי סוג
//      (STAKE/OPEN ⇒ הסוכן; SETTLE/REFUND ⇒ מפתח הרשת)
//   5. ה-head והספירות שה-ledger מצהיר עליהם — מול החישוב
//
// שימוש: bun run scripts/weave-verify-book.ts [path/to/ledger.json]
// קוד יציאה: 0 = הספר תקין · 1 = שבר/פער (עם המיקום המדויק)
// ─────────────────────────────────────────────────────────────────────

import * as fs from "fs";
import * as path from "path";
import { GENESIS_HASH, hashText, verifyChain } from "@/lib/weave/chain";
import { recoverFromDigestEip191 } from "@/lib/weave/evm";
import {
  MARKET_GENESIS,
  canonicalMarketEvent,
  marketEntryHash,
} from "@/lib/weave/market-canon";

interface LedgerAgent {
  id: string;
  name?: string;
  ethAddress: string;
}

interface LedgerAttestation {
  seq: number;
  agentId: string;
  claim: string;
  claimType: string;
  evidence: string;
  evidenceHash: string;
  status: string;
  prevHash: string;
  entryHash: string;
  sig?: string | null;
  createdAt: string;
}

interface LedgerMarketEvent {
  seq: number;
  kind: string;
  payload: string;
  payloadHash: string;
  prevHash: string;
  entryHash: string;
  sig?: string | null;
  createdAt: string;
}

interface LedgerSnapshot {
  format: string;
  exportedAt: string;
  chainCount: number;
  headHash: string;
  agents: LedgerAgent[];
  attestations: LedgerAttestation[];
  marketEvents: LedgerMarketEvent[];
  networkKey?: { address: string } | null;
  brain?: LedgerBrainKey[];
}

interface LedgerBrainKey {
  id: string;
  fingerprint: string;
  encKey: string;
  keyIv: string;
  keyTag: string;
  status: string;
  lastCode?: string | null;
  verifiedAt?: string | null;
  createdAt: string;
}

const argv = process.argv.slice(2);
// r121 · חוק 13 מוחש: ברירת-מחדל חדשה — הספר הציבורי החי מ-Console Pages.
// מעתה הבודק הציבורי לא צריך אף קובץ מקומי: ה-verifier מושך את ה-ledger
// המפורסם (publishConsoleLedger, בכל פעימת לב) ומאמת אותו כמו שהוא.
// דגלים: --live (ברירת מחדל בלי ארגומנט) · נתיב קובץ = אימות מקומי.
const PUBLIC_LEDGER_URL = "https://roshpinacare-sys.github.io/Console/ledger.json";

function loadLedgerSync(p: string): LedgerSnapshot {
  if (!fs.existsSync(p)) {
    console.error(`✗ ה-ledger לא נמצא: ${p}`);
    console.error(`  שימוש: bun run scripts/weave-verify-book.ts [--live | path/to/ledger.json]`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, "utf8")) as LedgerSnapshot;
}

async function loadLedgerLive(): Promise<LedgerSnapshot> {
  console.log(`מושך את הספר הציבורי החי: ${PUBLIC_LEDGER_URL}`);
  const res = await fetch(`${PUBLIC_LEDGER_URL}?t=${Date.now()}`, { headers: { "User-Agent": "weave-verify-book" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as LedgerSnapshot;
}

const wantLive = argv[0] === "--live" || (argv.length === 0 && !fs.existsSync(path.join(process.cwd(), "sovereign", "ledger.json")));
const ledger = wantLive
  ? await loadLedgerLive()
  : loadLedgerSync(path.resolve(argv[0] ?? path.join(process.cwd(), "sovereign", "ledger.json")));
const ledgerPath = wantLive ? `${PUBLIC_LEDGER_URL} (חי)` : path.resolve(argv[0] ?? path.join(process.cwd(), "sovereign", "ledger.json"));

if (ledger.format !== "weave-ledger-v1") {
  console.error(`✗ פורמט לא מוכר: ${ledger.format} (ציפינו weave-ledger-v1)`);
  process.exit(1);
}

const errors: string[] = [];
let firstBreak: number | null = null;
const note = (msg: string, seq?: number) => {
  errors.push(msg);
  if (firstBreak === null && seq !== undefined) firstBreak = seq;
};

console.log("THE WEAVE · public replay — אמת = חישוב-מחדש");
console.log(`ledger:  ${ledgerPath}`);
console.log(`format:  ${ledger.format} · exported ${ledger.exportedAt}`);
console.log(`declared: ${ledger.chainCount} attestations · head ${ledger.headHash.slice(0, 18)}…`);
console.log("");

// ── 1–3. ספר האימותים ──
const agentById = new Map(ledger.agents.map((a) => [a.id, a]));
const atts = [...ledger.attestations].sort((a, b) => a.seq - b.seq);

const chain = verifyChain(
  atts.map((row) => ({
    seq: row.seq,
    agentAddress: agentById.get(row.agentId)?.ethAddress ?? "0x?",
    claim: row.claim,
    claimType: row.claimType,
    evidenceHash: row.evidenceHash,
    status: row.status,
    prevHash: row.prevHash,
    entryHash: row.entryHash,
    createdAt: row.createdAt,
  }))
);
for (const err of chain.errors) {
  const m = err.match(/^seq (\d+):/);
  note(err, m ? Number(m[1]) : undefined);
}

let attSigOk = 0;
let attSigFail = 0;
for (const row of atts) {
  const expected = agentById.get(row.agentId)?.ethAddress;
  if (!expected) {
    note(`seq ${row.seq}: סוכן לא רשום (${row.agentId})`, row.seq);
    attSigFail += 1;
    continue;
  }
  if (!row.sig) {
    note(`seq ${row.seq}: חסרה חתימה`, row.seq);
    attSigFail += 1;
    continue;
  }
  let recovered: string | null = null;
  try {
    recovered = recoverFromDigestEip191(row.entryHash, row.sig);
  } catch {
    recovered = null;
  }
  if (recovered !== null && recovered.toLowerCase() === expected.toLowerCase()) {
    attSigOk += 1;
  } else {
    note(`seq ${row.seq}: חתימה לא תואמת (recovered ${recovered ?? "null"} ≠ ${expected})`, row.seq);
    attSigFail += 1;
  }
  if (hashText(row.evidence) !== row.evidenceHash) {
    note(`seq ${row.seq}: evidenceHash לא תואם לראיה — הראיה שונתה`, row.seq);
  }
}

const recomputedHead = atts.length > 0 ? atts[atts.length - 1].entryHash : GENESIS_HASH;

// ── 4. ספר השוק ──
const marketEvents = [...(ledger.marketEvents ?? [])].sort((a, b) => a.seq - b.seq);
let marketChainValid = true;
let marketSigOk = 0;
let marketSigFail = 0;
let prevHash = MARKET_GENESIS;
const networkAddress = ledger.networkKey?.address ?? null;

for (const ev of marketEvents) {
  const rec = canonicalMarketEvent({
    seq: ev.seq,
    kind: ev.kind,
    payloadHash: ev.payloadHash,
    prevHash: ev.prevHash,
    createdAt: new Date(ev.createdAt),
  });
  const recomputed = marketEntryHash(rec);
  if (recomputed !== ev.entryHash || ev.prevHash !== prevHash) {
    marketChainValid = false;
    note(`market seq ${ev.seq}: שרשרת נפרדת (entryHash/prevHash לא תואמים)`, ev.seq);
  }
  // payloadHash מהראיה
  if (hashText(ev.payload) !== ev.payloadHash) {
    note(`market seq ${ev.seq}: payloadHash לא תואם ל-payload`, ev.seq);
  }
  // החותם הצפוי לפי סוג האירוע
  let expected: string | null = null;
  try {
    const payload = JSON.parse(ev.payload) as Record<string, unknown>;
    if (ev.kind === "STAKE" || ev.kind === "OPEN") {
      const key = ev.kind === "STAKE" ? "agentId" : "createdBy";
      expected = agentById.get(String(payload[key] ?? ""))?.ethAddress ?? null;
    } else {
      expected = networkAddress;
    }
  } catch {
    expected = null;
  }
  if (!expected) {
    note(`market seq ${ev.seq}: לא ניתן לקבוע חותם צפוי`, ev.seq);
    marketSigFail += 1;
  } else if (!ev.sig) {
    note(`market seq ${ev.seq}: חסמה חתימה`, ev.seq);
    marketSigFail += 1;
  } else {
    let recovered: string | null = null;
    try {
      recovered = recoverFromDigestEip191(ev.payloadHash, ev.sig);
    } catch {
      recovered = null;
    }
    if (recovered !== null && recovered.toLowerCase() === expected.toLowerCase()) {
      marketSigOk += 1;
    } else {
      note(`market seq ${ev.seq}: חתימה לא תואמת`, ev.seq);
      marketSigFail += 1;
    }
  }
  prevHash = ev.entryHash;
}

// ── 5. הצהרות ה-ledger מול החישוב ──
if (ledger.chainCount !== atts.length) {
  note(`chainCount מוצהר ${ledger.chainCount} ≠ נספר ${atts.length}`);
}
if (ledger.headHash !== recomputedHead) {
  note(`headHash מוצהר ${ledger.headHash} ≠ מחושב ${recomputedHead}`);
}

// ── פסק-דין ──
const valid = errors.length === 0 && marketChainValid;
console.log("── ספר האימותים ──────────────────────────────");
console.log(`רשומות:      ${atts.length}`);
console.log(`שרשרת:       ${chain.errors.length === 0 ? "תקינה ✓" : `נפרדת ✗ (${chain.errors.length})`}`);
console.log(`חתימות:      ${attSigOk}/${atts.length} תקינות${attSigFail ? ` · ${attSigFail} כשלים` : ""}`);
console.log(`head מחושב:  ${recomputedHead}`);
console.log("");
console.log("── ספר השוק ──────────────────────────────────");
console.log(`אירועים:     ${marketEvents.length}`);
console.log(`שרשרת:       ${marketChainValid ? "תקינה ✓" : "נפרדת ✗"}`);
console.log(`חתימות:      ${marketSigOk}/${marketEvents.length} תקינות${marketSigFail ? ` · ${marketSigFail} כשלים` : ""}`);
// ── 5. כספת המוח (טופס מבני בלבד — הגושים אטומים; המפתח חי רק בזכות מפתח-הרשת שב-seal) ──
const brain = [...(ledger.brain ?? [])].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
const brainFps = new Set<string>();
let brainOk = 0;
for (const b of brain) {
  const fpOk = /^nv-fp:[0-9a-f]{16}$/.test(b.fingerprint);
  const encOk = /^[0-9a-f]{96,}$/.test(b.encKey); // צופן GCM של מפתח nvapi (≈52תווים) + פדינג
  const ivOk = /^[0-9a-f]{24}$/.test(b.keyIv); // 12B
  const tagOk = /^[0-9a-f]{32}$/.test(b.keyTag); // 16B
  const dup = brainFps.has(b.fingerprint);
  if (fpOk && encOk && ivOk && tagOk && !dup) {
    brainOk += 1;
  } else {
    note(`מוח ${b.fingerprint || "?"}: גוש פגום (${!fpOk ? "טביעה " : ""}${!encOk ? "צופן " : ""}${!ivOk ? "IV " : ""}${!tagOk ? "tag " : ""}${dup ? "כפול" : ""})`);
  }
  brainFps.add(b.fingerprint);
}
console.log("── כספת המוח (מבנית) ────────────────────");
console.log(`מפתחות אטומים: ${brainOk}/${brain.length} מבנם תקינים · אין-כפולות מוודדות`);
console.log("");

console.log("");
console.log("── מדד החיים (חוק 8 — נספר מהספר) ────────────");
const daySet = new Set(atts.map((a) => Math.floor(new Date(a.createdAt).getTime() / 86_400_000)));
const today = Math.floor(Date.now() / 86_400_000);
let cursor = daySet.has(today) ? today : today - 1;
let streak = 0;
while (daySet.has(cursor)) {
  streak += 1;
  cursor -= 1;
}
const last24h = atts.filter((a) => new Date(a.createdAt).getTime() > Date.now() - 86_400_000).length;
const signers24h = new Set(
  atts.filter((a) => new Date(a.createdAt).getTime() > Date.now() - 86_400_000).map((a) => a.agentId)
).size;
console.log(`אימותים ב-24ש':  ${last24h}`);
console.log(`חותמים ב-24ש':   ${signers24h}`);
console.log(`רצף ימים חיים:   ${streak}`);
console.log("");

if (valid) {
  console.log("✓ VERDICT: הספר תקין — שרשרת, חתימות וראיות אומתו בחישוב-מחדש מלא.");
  console.log("  אמת לא נקנית בהצבעה; היא נגזרת מהקוד הזה. חוק 13 — מוחש.");
  process.exit(0);
} else {
  console.error(`✗ VERDICT: הספר נפרד — ${errors.length} שגיאות. שבר ראשון: ${firstBreak ?? "—"}`);
  for (const err of errors.slice(0, 10)) console.error(`  · ${err}`);
  if (errors.length > 10) console.error(`  · … ועוד ${errors.length - 10}`);
  process.exit(1);
}
