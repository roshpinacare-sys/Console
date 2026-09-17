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
 *
 * הספר הוא append-only מסונן: רק העברות שהגיעו אלינו, מבלי לחשוף שום-דבר
 * אחר. הלב של הדקס (dex-beat בריפו הפרטי) מתאים תביעות-חתומות מול-ספר-זה
 * ומזכה USDS - שתי-המערכות נפגשות רק דרך הקבצים הציבוריים. אפס-אמון-עיוור.
 */

import fs from "fs";
import { fileURLToPath } from "url";

/* ── כתובות-ההפקדה: ארנקי-הצבא (רשומים-על-שרשרת-הרשת, בעלות-האוצר) ── */
const ADDR = {
  tron: "TVESRr1TX1RaKzsN6TKszutJBFDPEGPx1e", // ynet · USDT/USDC-TRC20 + TRX
  evm: "0x9978ab0f642bbf0b75e92db0e639ee863e053ac4", // woq · USDT/USDC-ERC20
  sol: "8SGkrAjepscF3ttD5UzxyFwX8DgREUBD3cjNe5ZEmnCk", // wog · USDT/USDC-SPL + SOL
  btc: "bc1qpgfuznfxncqqvs3j20p3p38kesu4ljsqhha58c", // wic · BTC
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
};
const CAP = 400;

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
    const j = await jfetch(`${TRONSCAN}/api/transfer/trc20?limit=50&sort=-timestamp&count=false&address=${ADDR.tron}&trc20Id=${t.id}`).catch(() => null);
    for (const e of j?.data ?? []) {
      if (String(e.to ?? "").toUpperCase() !== ADDR.tron.toUpperCase()) continue;
      add("tron", sym, e.hash, Number(e.amount) / 10 ** t.dec, e.from, e.to, Number(e.block_timestamp) || undefined, "solidified");
      n++;
    }
  }
  const trx = await jfetch(`${TRONSCAN}/api/transfer?limit=50&sort=-timestamp&count=false&address=${ADDR.tron}`).catch(() => null);
  for (const e of trx?.data ?? []) {
    if (String(e.to_address ?? "").toUpperCase() !== ADDR.tron.toUpperCase()) continue;
    add("tron", "TRX", e.hash, Number(e.amount ?? e.value ?? 0) / 1e6, e.from_address, e.to_address, Number(e.block_timestamp) || undefined, "solidified");
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
      const logs = await rpc(EVM_RPC, "eth_getLogs", [{
        fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16),
        address: t.addr,
        topics: [TRANSFER_TOPIC, null, toTopic],
      }]).catch(() => []);
      for (const log of logs ?? []) {
        const amount = Number(BigInt(log.data)) / 10 ** t.dec;
        const fromAddr = "0x" + String(log.topics?.[1] ?? "").slice(26);
        const sym = Object.entries(ERC20).find(([, m]) => m.addr.toLowerCase() === String(log.address).toLowerCase())?.[0] ?? "?";
        add("ethereum", sym, log.transactionHash, amount, fromAddr, ADDR.evm, undefined, head - Number(log.blockNumber) >= 12 ? "12+" : "pending");
        n++;
      }
    }
  }
  return { n, head };
}

/* ── Solana: USDT/USDC-SPL + SOL ── */
async function scanSol() {
  let n = 0;
  const sigs = await rpc(SOL_RPC, "getSignaturesForAddress", [ADDR.sol, { limit: 30 }]).catch(() => []);
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
      if (lam > 0) { add("solana", "SOL", s.signature, lam / 1e9, "", ADDR.sol, (s.blockTime ?? 0) * 1000 || undefined, "finalized"); n++; }
    }
  }
  return n;
}

/* ── Bitcoin ── */
async function scanBtc() {
  let n = 0;
  const head = Number(await jfetch(`${BTC_API}/q/getblockcount`).catch(() => 0));
  const j = await jfetch(`${BTC_API}/rawaddr/${ADDR.btc}?limit=30`).catch(() => null);
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

/* ═════════ main ═════════ */
const t0 = Date.now();
const status = { tron: "ok", ethereum: "ok", solana: "ok", bitcoin: "ok" };
let evmHead = 0;
try { const n = await scanTron(); status.tron = `ok (${n})`; } catch (e) { status.tron = "down: " + String(e).slice(0, 40); }
try { const { n, head } = await scanEvm(); status.ethereum = `ok (${n})`; evmHead = head; } catch (e) { status.ethereum = "down: " + String(e).slice(0, 40); }
try { const n = await scanSol(); status.solana = `ok (${n})`; } catch (e) { status.solana = "down: " + String(e).slice(0, 40); }
try { const n = await scanBtc(); status.bitcoin = `ok (${n})`; } catch (e) { status.bitcoin = "down: " + String(e).slice(0, 40); }

ledger.deposits = ledger.deposits
  .sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
  .slice(0, CAP);
ledger.updatedAt = new Date().toISOString();
fs.writeFileSync(DEPOSITS_FILE, JSON.stringify(ledger, null, 1));

const watch = {
  publishedAt: new Date().toISOString(),
  watching: ADDR,
  chains: status,
  depositsTotal: ledger.deposits.length,
  cadenceMin: 20,
  minDepositUsd: MIN_DEPOSIT_USD,
  note: "keyless public watcher - reads public RPCs, writes the open deposit book; the dex heart matches signed claims against this book and credits USDS",
  ...(evmHead ? { lastEvmBlock: evmHead } : {}),
};
fs.writeFileSync(WATCH_FILE, JSON.stringify(watch, null, 1));
console.log(`[dex-watch] ${((Date.now() - t0) / 1000).toFixed(1)}s · total ${ledger.deposits.length} · fresh ${fresh.length} · ${JSON.stringify(status)}`);
for (const f of fresh.slice(0, 10)) console.log(`  + ${f.asset} ${f.amount} @${f.chain} ${String(f.txid).slice(0, 16)}…`);
