/**
 * dex/watch.mjs - צופה-ההפקדות הציבורי של SAOS (Task 33)
 * =============================================================================
 * רץ ב-GitHub Actions בריפו הציבורי Console (דקות-בלתי-מוגבלות, אפס-סודות,
 * אפס-מפתחות): סורק את כתובות-ההפקדה האמיתיות של הרשת (ארנקי-הצבא) בארבע
 * רשתות עם RPC ציבוריים בלבד, ומפרסם את ספר-ההפקדות הפתוח:
 *
 *   TRON  - USDT/USDC (TRC20) + TRX   · Tronscan apilist (ציבורי, ללא-מפתח)
 *   ETH   - USDT/USDC (ERC20)         · eth_getLogs על publicnode
 *   SOL   - USDT/USDC (SPL) + SOL     · getSignaturesForAddress + getParsedTransaction
 *   BTC   - מקורי                     · blockchain.info rawaddr
 *   STEEM - STEEM/SBD → headcorner    · condenser_api.get_account_history (Task 23)
 *   HIVE  - HIVE/HBD → headcorner     · condenser_api.get_account_history (Task 24-c)
 *
 * הספר הוא append-only מסונן: רק העברות שהגיעו אלינו, מבלי לחשוף שום-דבר
 * אחר. הלב של הדקס (dex-beat בריפו הפרטי) מתאים תביעות-חתומות מול-ספר-זה
 * ומזכה USDS - שתי-המערכות נפגשות רק דרך הקבצים הציבוריים. אפס-אמון-עיוור.
 */

import fs from "fs";
import { fileURLToPath } from "url";
import { scrub } from "../agents/refs.mjs";

/* ── כתובות-ההפקדה: ארנקי-הצבא (רשומים-על-שרשרת-הרשת, בעלות-האוצר) ──
 * (הכתובות פומביות-מטבען; הקישור כתובת←חשבון נשמר במפה-הפרטית בלבד) */
const ADDR = {
  tron: "TVESRr1TX1RaKzsN6TKszutJBFDPEGPx1e", // estate deposit address · USDT/USDC-TRC20 + TRX
  evm: "0x9978ab0f642bbf0b75e92db0e639ee863e053ac4", // estate deposit address · USDT/USDC-ERC20
  sol: "8SGkrAjepscF3ttD5UzxyFwX8DgREUBD3cjNe5ZEmnCk", // estate deposit address · USDT/USDC-SPL + SOL
  btc: "bc1qpgfuznfxncqqvs3j20p3p38kesu4ljsqhha58c", // estate deposit address · BTC
};

const TRC20 = {
  USDT: { id: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", dec: 6 },
  USDC: { id: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8", dec: 6 },
};
const ERC20 = {
  USDT: { addr: "0xdac17f958d2ee523a2206206994597c13d831ec7", dec: 6 },
  USDC: { addr: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", dec: 6 },
};
const SPL = {
  USDT: { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", dec: 6 },
  USDC: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", dec: 6 },
};

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const EVM_RPC = "https://ethereum-rpc.publicnode.com";
const SOL_RPC = "https://solana-rpc.publicnode.com";
const TRONSCAN = "https://apilist.tronscanapi.com";
const BTC_API = "https://blockchain.info";

const MIN_DEPOSIT_USD = 5; // הגנת-אבק: מתחת-לזה לא-נרשם (עדיין-ניתן-לתבוע דרך-השער)
/* R33 · unit-aware dust filter — היה: כל-הנכסים נמדדו-מול-5-דולר **ביחידות-המטבע**
 * (amount >= MIN_DEPOSIT_USD) ולא-בשווי-דולרי: הפקדת-4 SOL (~$400) נזרקה
 * מהספר בשקט (4 < 5) והפקדת-5 TRX (~$1.2) נרשמה. כסף-אמיתי נעלם-מהספר-הציבורי
 * והתביעה נחסמה. עתה: מינימום-פר-נכס ביחידות-הנכס, מכסה את-אותה-מטרת-האבק
 * (~$5) בלי-להרוג הפקדות-גדולות-בשווי. */
const MIN_UNITS = {
  USDT: 5, USDC: 5, USD: 5, TUSD: 5, DAI: 5, FDUSD: 5, // stables: units = dollars
  TRX: 20, ETH: 0.002, SOL: 0.03, BTC: 0.00008,
  /* Task 23 · 2026-10-20: STEEM/SBD נכנסים-לספר-הפקדות — אותו-חוק-אבק (~$5 ביחידות-הנכס
   * לפי-הפיד-החי: STEEM ≈ $0.052 → 96 · SBD ≈ $0.44 → 12). מתחת-לרף — לא-נרשם
   * בספר-הציבורי; דרך-השער (מפעיל) עדיין פתוחה כמו-לכל-נכס. */
  STEEM: 96, SBD: 12,
  /* Task 24-c · 2026-10-19: HIVE/HBD — אותו-חוק-אבק (~$5 ביחידות-הנכס לפי-הפיד-החי:
   * HIVE ≈ $0.0487 → 103 · HBD ≈ $0.44 → 12, זהה-ל-SBD — שניהם מובטחים-דולר).
   * מתחת-לרף — לא-נרשם בספר-הציבורי; דרך-השער (מפעיל) עדיין פתוחה כמו-לכל-נכס. */
  HIVE: 103, HBD: 12,
};
const CAP = 400;

let evmLastGood = 0; // R34: סוף-הטווח האחרון שנסרק-במלואו על EVM — נשמר גם-בריצה-שנכשלה, בלי-נקודה-עיוורת
const DEX_DIR = fileURLToPath(new URL("./", import.meta.url));
const DEPOSITS_FILE = DEX_DIR + "deposits.json";
const WATCH_FILE = DEX_DIR + "watch.json";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function jfetch(url, opts = {}, tries = 2) {
  for (let i = 0; i < tries; i++) {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 20_000);
      const r = await fetch(url, { ...opts, signal: ac.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error(String(r.status));
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1_200);
    }
  }
}
async function rpc(url, method, params) {
  const j = await jfetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (j.error) throw new Error(j.error.message ?? "rpc-error");
  return j.result;
}

/* ── טעינת-הספר הקיים ── */
let ledger = { version: 1, deposits: [] };
try {
  const raw = JSON.parse(fs.readFileSync(DEPOSITS_FILE, "utf8"));
  if (raw?.version === 1 && Array.isArray(raw.deposits)) ledger = raw;
} catch { /* ראשון */ }
const seen = new Set(ledger.deposits.map((d) => `${d.chain}:${d.txid}`));
const fresh = [];

function add(chain, asset, txid, amount, from, to, ts, conf, extra = {}) {
  const key = `${chain}:${txid}`;
  if (seen.has(key)) return;
  const min = MIN_UNITS[asset] ?? MIN_DEPOSIT_USD; // R33: unit-aware, fail-open for unmapped stables
  if (!(amount >= min)) return; // אבק-מתחת-לרף-הנכס - לא-נספר (דרך-השער עדיין-פתוחה)
  seen.add(key);
  const rec = {
    txid: String(txid), chain, asset, amount: Math.round(amount * 1e6) / 1e6,
    to, from: String(from ?? ""), ts: ts ?? Date.now(), conf, detectedAt: new Date().toISOString(),
    ...extra,
  };
  ledger.deposits.push(rec);
  fresh.push(rec);
}

/* ── TRON: USDT/USDC-TRC20 + TRX ── */
async function scanTron() {
  let n = 0;
  for (const [sym, t] of Object.entries(TRC20)) {
    // R34: אין-בליעת-שגיאות — כשל-רשת/401 חייב לעלות ל-main ולהירשם "down", לא "ok (0)"
    const j = await jfetch(`${TRONSCAN}/api/transfer/trc20?limit=50&sort=-timestamp&count=false&address=${ADDR.tron}&trc20Id=${t.id}`);
    for (const e of j?.data ?? []) {
      // R34: base58 רגיש-לרישיות — השוואה מדויקת (ה-API כבר מסונן-לפי-כתובת; זו דווקא-הבטיחות)
      if (String(e.to ?? "") !== ADDR.tron) continue;
      add("tron", sym, e.hash, Number(e.amount) / 10 ** t.dec, e.from, e.to, Number(e.block_timestamp) || undefined, "solidified");
      n++;
    }
  }
  /* R34 · תיקון-שדות-שנמדד-חי (2026-10-17 מול-Tronscan+TronGrid): ה-API מחזיר
   * transactionHash / transferFromAddress / transferToAddress / timestamp — ולא
   * hash / from_address / to_address / block_timestamp. השדות-הישנים לעולם undefined
   * ← הפקדות-TRX מקורי היו נעלמות-בשקט לנצח. גם: הנקודה מחזירה את כל-ה-trc10 —
   * מסננים ל-"_" (TRX מקורי, precision 6) כדי-שלא-ירשמו טוקני-spam כ-TRX. */
  const trx = await jfetch(`${TRONSCAN}/api/transfer?limit=50&sort=-timestamp&count=false&address=${ADDR.tron}`);
  for (const e of trx?.data ?? []) {
    if (String(e.tokenInfo?.tokenId ?? "") !== "_") continue; // רק TRX מקורי
    if (String(e.transferToAddress ?? "") !== ADDR.tron) continue;
    add("tron", "TRX", e.transactionHash, Number(e.amount ?? 0) / 1e6, e.transferFromAddress, e.transferToAddress, Number(e.timestamp) || undefined, "solidified");
    n++;
  }
  return n;
}

/* ── Ethereum: USDT/USDC-ERC20 (eth_getLogs) ── */
async function scanEvm() {
  let lastBlock = 0;
  try { lastBlock = Number(JSON.parse(fs.readFileSync(WATCH_FILE, "utf8")).lastEvmBlock ?? 0); } catch { /* ראשון */ }
  const head = Number(await rpc(EVM_RPC, "eth_blockNumber", []));
  if (!lastBlock || head - lastBlock > 7_200) lastBlock = Math.max(0, head - 1_500);
  const toTopic = "0x" + ADDR.evm.slice(2).toLowerCase().padStart(64, "0");
  let n = 0;
  for (const [, t] of Object.entries(ERC20)) {
    // חלוקה-למנות-של-2,000 בלוקים - מגבלת-getLogs של-הצומת הציבורי
    for (let from = lastBlock; from <= head; from += 2_000) {
      const to = Math.min(head, from + 1_999);
      // R34: אין-בליעת-כשל-מנה — getLogs שנכשל היה מדלג-על-המנה בשקט ו-lastEvmBlock
      // היה ממשיך-הלאה ← נקודה-עיוורת-קבועה. עתה: זריקה → status=down, והסריקה
      // ממשיכה מהמנה-האחרונה-שהצליחה (evmLastGood) בריצה-הבאה.
      const logs = await rpc(EVM_RPC, "eth_getLogs", [{
        fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16),
        address: t.addr,
        topics: [TRANSFER_TOPIC, null, toTopic],
      }]);
      for (const log of logs ?? []) {
        const amount = Number(BigInt(log.data)) / 10 ** t.dec;
        const fromAddr = "0x" + String(log.topics?.[1] ?? "").slice(26);
        const sym = Object.entries(ERC20).find(([, m]) => m.addr.toLowerCase() === String(log.address).toLowerCase())?.[0] ?? "?";
        add("ethereum", sym, log.transactionHash, amount, fromAddr, ADDR.evm, undefined, head - Number(log.blockNumber) >= 12 ? "12+" : "pending");
        n++;
      }
      evmLastGood = to; // המנה נסרקה-במלואה
    }
  }
  return { n, head };
}

/* ── Solana: USDT/USDC-SPL + SOL ── */
async function scanSol() {
  let n = 0;
  // R34: אין-בליעת-שגיאה — כשל-RPC חייב להירשם "down", לא להיראות כאפס-כנה
  const sigs = await rpc(SOL_RPC, "getSignaturesForAddress", [ADDR.sol, { limit: 30 }]);
  for (const s of sigs ?? []) {
    if (s.err) continue;
    if (s.confirmationStatus && !["confirmed", "finalized"].includes(s.confirmationStatus)) continue;
    const key = `solana:${s.signature}`;
    if (seen.has(key)) continue;
    const tx = await rpc(SOL_RPC, "getTransaction", [s.signature, { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" }]).catch(() => null);
    if (!tx?.meta) continue;
    // SPL: דלתא-יתרות-הטוקן שלנו
    const pre = tx.meta.preTokenBalances ?? [], post = tx.meta.postTokenBalances ?? [];
    for (const p of post) {
      if (String(p.owner ?? "") !== ADDR.sol) continue;
      const before = pre.find((b) => b.accountIndex === p.accountIndex)?.uiTokenAmount?.uiAmount ?? 0;
      const delta = (p.uiTokenAmount?.uiAmount ?? 0) - before;
      if (!(delta > 0)) continue;
      const sym = Object.entries(SPL).find(([, m]) => m.mint === p.mint)?.[0];
      if (!sym) continue; // טוקן-אחר - לא-במפה-הציבורית (ניתן-לתבוע-דרך-השער)
      add("solana", sym, s.signature, delta, "", ADDR.sol, (s.blockTime ?? 0) * 1000 || undefined, "finalized");
      n++;
    }
    // SOL מקורי: דלתא-למפורטס של החשבון שלנו
    const keys = (tx.transaction?.message?.accountKeys ?? []).map((k) => (typeof k === "string" ? k : k.pubkey));
    const idx = keys.indexOf(ADDR.sol);
    if (idx >= 0) {
      const lam = (tx.meta.postBalances?.[idx] ?? 0) - (tx.meta.preBalances?.[idx] ?? 0);
      /* R34: txid נפרד ל-SOL-מקורי — אותה-חתימה יכולה לשאת גם-העברת-SPL וגם-SOL;
       * המפתח-הזהה היה מוחק-בשקט את-הרשומה-השנייה (כסף-נעלם-מהספר). */
      if (lam > 0) { add("solana", "SOL", s.signature + ":sol", lam / 1e9, "", ADDR.sol, (s.blockTime ?? 0) * 1000 || undefined, "finalized"); n++; }
    }
  }
  return n;
}

/* ── Bitcoin ── */
async function scanBtc() {
  let n = 0;
  // R34: אין-בליעת-שגיאות — כשל-API חייב להירשם "down" ולא "ok (0)"
  const head = Number(await jfetch(`${BTC_API}/q/getblockcount`));
  const j = await jfetch(`${BTC_API}/rawaddr/${ADDR.btc}?limit=30`);
  for (const tx of j?.txs ?? []) {
    if (!tx.block_height) continue; // ממתין-בממפיל - עדיין-לא-מאושר
    let sat = 0;
    for (const o of tx.out ?? []) if (o.addr === ADDR.btc) sat += o.value ?? 0;
    if (!(sat > 0)) continue;
    add("bitcoin", "BTC", tx.hash, sat / 1e8, tx.inputs?.[0]?.prev_out?.addr ?? "", ADDR.btc, (tx.time ?? 0) * 1000 || undefined, Math.max(1, head - tx.block_height + 1));
    n++;
  }
  return n;
}

/* ── STEEM/SBD (Task 23 · 2026-10-20): העברות-אמת אל-headcorner ──
 * הענן (cloud-beat) מזכה deposit.claim רק-מול-הספר-הזה — והוא-מעולם-לא צפה STEEM.
 * נמדד-חי (2026-10-19): הצמתים-הציבוריים ביטלו-את-צורת-4-הארגומנטים (select_ops)
 * — "Assert Exception: args.size() == 3" על steemit וגם-justyy → צורת-3 + סינון-מקומי.
 * מדיניות-ממוא: הכתובת saos1… של-המפקיד נשמרת-מהממוא (הזיהוי-הקנוני של-התביעה הוא-המעטפת
 * החתומה — הממוא כאן נוחות-ראיה-בלבד, אפס-סמכות). */
const STEEM_DEPOSIT_ACCOUNT = "headcorner";
const STEEM_RPCS = ["https://api.justyy.com", "https://api.steemit.com"];
const SAOS1_RE = /saos1[1-9A-HJ-NP-Za-km-z]{33,35}/;
async function scanSteem() {
  let n = 0;
  let hist = null;
  let lastErr = null;
  for (const rpcUrl of STEEM_RPCS) {
    try {
      const r = await jfetch(rpcUrl, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.get_account_history", params: [STEEM_DEPOSIT_ACCOUNT, -1, 100] }),
      });
      if (r?.result) { hist = r; break; }
      throw new Error("bad-shape");
    } catch (e) { lastErr = e; hist = null; }
  }
  if (!hist?.result) throw (lastErr ?? new Error("steem-rpc-unreachable"));
  for (const [, entry] of hist.result) {
    const op = entry?.op;
    if (!Array.isArray(op) || op[0] !== "transfer") continue; // סינון-מקומי (select_ops מת)
    const body = op[1] ?? {};
    if (String(body.to ?? "") !== STEEM_DEPOSIT_ACCOUNT) continue;
    if (String(body.from ?? "") === STEEM_DEPOSIT_ACCOUNT) continue; // העברה-עצמית אינה צמיחת-משמורת
    const amountStr = String(body.amount ?? "");
    const amt = Number(amountStr.split(" ")[0] ?? 0);
    const asset = amountStr.split(" ")[1] ?? "";
    if (asset !== "STEEM" && asset !== "SBD") continue;
    const memo = String(body.memo ?? "");
    const saos1 = SAOS1_RE.exec(memo)?.[0] ?? null;
    add("steem", asset, String(entry.trx_id ?? ""), amt, String(body.from ?? ""), STEEM_DEPOSIT_ACCOUNT, Date.parse(entry.timestamp ?? "") || undefined, 1, saos1 ? { saos1, memo: memo.slice(0, 64) } : {});
    n++;
  }
  return n;
}

/* ── HIVE/HBD (Task 24-c · 2026-10-19): אותו-רכבת-הפקדות על שרשרת-HIVE ──
 * חשבון-headcorner חי גם-על-HIVE (נמדד-חי: condenser_api.get_accounts → created
 * 2018-03-02T12:20:27 · 0.034 HIVE / 0.003 HBD). צמתי-HIVE מדברים את-אותו
 * condenser_api — לכן צורת-3 + סינון-מקומי (select_ops מת שם-וגם-שם).
 * רוטציה על-פי-מדידה-חיה 2026-10-19: deathwing + openhive ענו 3/3 ו-4/4,
 * hive.blog רעוע (1/3 על-get_dynamic_global_properties, אך-history ענה),
 * arcange מת-מהסנדבוקס (0/4) → לא-נכלל. FAIL-HONEST: אם-כולם-נופלים —
 * זריקה → status "down" והספר-מתפרסם בלעדי-HIVE, אף-המצאה. */
const HIVE_DEPOSIT_ACCOUNT = "headcorner";
const HIVE_RPCS = ["https://api.deathwing.me", "https://api.openhive.network", "https://api.hive.blog"];
async function scanHive() {
  let n = 0;
  let hist = null;
  let lastErr = null;
  for (const rpcUrl of HIVE_RPCS) {
    try {
      const r = await jfetch(rpcUrl, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.get_account_history", params: [HIVE_DEPOSIT_ACCOUNT, -1, 100] }),
      });
      if (r?.result) { hist = r; break; }
      throw new Error("bad-shape");
    } catch (e) { lastErr = e; hist = null; }
  }
  if (!hist?.result) throw (lastErr ?? new Error("hive-rpc-unreachable"));
  for (const [, entry] of hist.result) {
    const op = entry?.op;
    if (!Array.isArray(op) || op[0] !== "transfer") continue; // סינון-מקומי (select_ops מת)
    const body = op[1] ?? {};
    if (String(body.to ?? "") !== HIVE_DEPOSIT_ACCOUNT) continue;
    if (String(body.from ?? "") === HIVE_DEPOSIT_ACCOUNT) continue; // העברה-עצמית אינה צמיחת-משמורת
    const amountStr = String(body.amount ?? "");
    const amt = Number(amountStr.split(" ")[0] ?? 0);
    const asset = amountStr.split(" ")[1] ?? "";
    if (asset !== "HIVE" && asset !== "HBD") continue;
    const memo = String(body.memo ?? "");
    const saos1 = SAOS1_RE.exec(memo)?.[0] ?? null; // חוק-ממוא זהה-ל-STEEM: saos1… בתוך-הממוא
    add("hive", asset, String(entry.trx_id ?? ""), amt, String(body.from ?? ""), HIVE_DEPOSIT_ACCOUNT, Date.parse(entry.timestamp ?? "") || undefined, 1, saos1 ? { saos1, memo: memo.slice(0, 64) } : {});
    n++;
  }
  return n;
}

/* ═════════ main ═════════ */
const t0 = Date.now();
const status = { tron: "ok", ethereum: "ok", solana: "ok", bitcoin: "ok" };
let evmHead = 0;
try { const n = await scanTron(); status.tron = `ok (${n})`; } catch (e) { status.tron = "down: " + String(e).slice(0, 40); }
try { const { n, head } = await scanEvm(); status.ethereum = `ok (${n})`; evmHead = head; }
catch (e) { status.ethereum = "down: " + String(e).slice(0, 40); evmHead = evmLastGood; /* R34: המשך-מהמנה-האחרונה-שהצליחה — בלי-נקודה-עיוורת */ }
try { const n = await scanSol(); status.solana = `ok (${n})`; } catch (e) { status.solana = "down: " + String(e).slice(0, 40); }
try { const n = await scanBtc(); status.bitcoin = `ok (${n})`; } catch (e) { status.bitcoin = "down: " + String(e).slice(0, 40); }
const statusExtra = {};
try { const n = await scanSteem(); statusExtra.steem = `ok (${n})`; } catch (e) { statusExtra.steem = "down: " + String(e).slice(0, 40); }
try { const n = await scanHive(); statusExtra.hive = `ok (${n})`; } catch (e) { statusExtra.hive = "down: " + String(e).slice(0, 40); }

const depositsTotal = ledger.deposits.length; // R34: הספירה-האמיתית לפני תקרת-הספר (CAP=400)
ledger.deposits = ledger.deposits
  .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
  .slice(0, CAP);
ledger.updatedAt = new Date().toISOString();
fs.writeFileSync(DEPOSITS_FILE, scrub(JSON.stringify(ledger, null, 1)));

const watch = {
  publishedAt: new Date().toISOString(),
  watching: ADDR,
  /* R34: כתובות-ההפקדה פומביות-מטבען (tier-A לפי exposure policy — מפתח "deposit*"
   * שורד את redact-telemetry בעוד watching נחתך). בלי-זה הספר-המפורסם לא מציג
   * את-הכתובות ומשתמש אינו יכול להפקיד בפועל. */
  depositAddresses: {
    depositTron: ADDR.tron,
    depositEvm: ADDR.evm,
    depositSol: ADDR.sol,
    depositBtc: ADDR.btc,
    /* Task 23: STEEM/SBD — חשבון-הפקדה + מדיניות-ממוא (זהה-ל-Domain/dex/watch.json — ספר-אחד) */
    depositSteem: { addr: STEEM_DEPOSIT_ACCOUNT, memo: "saos deposit — write your saos1 address in the transfer memo" },
    depositSbd: { addr: STEEM_DEPOSIT_ACCOUNT, memo: "saos deposit — write your saos1 address in the transfer memo" },
    /* Task 24-c: HIVE/HBD — אותו-חשבון headcorner על-שרשרת-HIVE (קיים-שם מ-2018,
     * נמדד-חי) — צורה-זהה-ל-STEEM: {addr, memo} · הממוא חייב-להתחיל בכתובת-saos1 של-המפקיד */
    depositHive: { addr: HIVE_DEPOSIT_ACCOUNT, memo: "HIVE chain — memo must start with your saos1 address" },
    depositHbd: { addr: HIVE_DEPOSIT_ACCOUNT, memo: "HIVE chain — memo must start with your saos1 address" },
  },
  chains: { ...status, ...statusExtra },
  depositsTotal,
  bookCap: CAP,
  cadenceMin: 20,
  minDepositUsd: MIN_DEPOSIT_USD,
  note: "keyless public watcher - reads public RPCs, writes the open deposit book (latest 400); a depositor signs a deposit.claim envelope and the saos-dex cloud-beat scanner matches it against this book (txid) and credits USDS (stables 1:1, others by live feed)",
  ...(evmHead ? { lastEvmBlock: evmHead } : {}),
};
fs.writeFileSync(WATCH_FILE, scrub(JSON.stringify(watch, null, 1)));
console.log(`[dex-watch] ${((Date.now() - t0) / 1000).toFixed(1)}s · total ${depositsTotal} · fresh ${fresh.length} · ${JSON.stringify(status)}`);
for (const f of fresh.slice(0, 10)) console.log(`  + ${f.asset} ${f.amount} @${f.chain} ${String(f.txid).slice(0, 16)}…`);
