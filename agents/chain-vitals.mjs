#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────
// CHAIN-VITALS · agents/chain-vitals.mjs — דופק כל קווי הרשת (R68)
//
// המנוע השני בשכבת "מנועי-הרשת על השרשרת": הרשת רצה על כמה
// שרשראות — קווי העוגן (Steem/Hive/Blurt), ה-Relay הריבוני על
// Ethereum/Optimism/Base, ושרשראות הפקדות (TRON/Bitcoin/Solana).
// עד היום אף ספר לא החזיק את הדופק של כולן ביחד.
//
// המנוע מודד את כל הקווים במקביל, keyless, עם נקודות-קצה ציבוריות
// בלבד ועם fallback כנה לכל קו. קו שנופל הוא שורה אדומה בספר —
// לא קריסת-ריצה. הכנות היא המשטר: מה שנמדד נכתב, מה שנכשל נרשם.
//
// פלט: weave/vitals.json (סופר אחד: המנוע הזה בלבד, BLOC r144-h).
// ─────────────────────────────────────────────────────────────────────

const RELAYS = {
  ETHEREUM: { rpc: "https://ethereum-rpc.publicnode.com", relay: "0xa52D85cAa4C04C15cE60d0c582e8C138d16678E6", chainId: 1 },
  OPTIMISM: { rpc: "https://optimism-rpc.publicnode.com", relay: "0x56c9D54ea866e25916757903E51392BBEdeE2ECe", chainId: 10 },
  BASE: { rpc: "https://base-rpc.publicnode.com", relay: "0x279818b4c9Eddc02fB3DD036a5E77D8F7Dc1CF87", chainId: 8453 },
};
const BLURT_NODES = ["https://api.blurt.blog", "https://rpc.blurt.world"];
const BTC_NODES = ["https://mempool.space/api/blocks/tip/height", "https://blockstream.info/api/blocks/tip/height"];
const log = (m) => console.log(`[chain-vitals] ${m}`);

async function timed(fn) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    return { ok: true, latencyMs: Date.now() - t0, detail, error: null };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, detail: null, error: String(e.message || e).slice(0, 120) };
  }
}

async function jsonPost(url, body, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

// קווי-עוגן: Steem/Hive/Blurt — condenser DGP
async function dgpLine(name, node) {
  return timed(async () => {
    const j = await jsonPost(node, { jsonrpc: "2.0", id: 1, method: "condenser_api.get_dynamic_global_properties", params: [] });
    const r = j.result;
    if (!r || typeof r.head_block_number !== "number") throw new Error("malformed DGP");
    const headAgeSec = r.time ? Math.max(0, Math.round((Date.now() - Date.parse(r.time + (r.time.endsWith("Z") ? "" : "Z"))) / 1000)) : null;
    return {
      headBlock: r.head_block_number,
      headAgeSec,
      participation: typeof r.participation_count === "number" ? r.participation_count / 100 : null,
      witness: r.current_witness || null,
    };
  });
}

async function steemLine() {
  return dgpLine("steem", "https://api.steemit.com");
}

async function hiveLine() {
  return dgpLine("hive", "https://api.hive.blog");
}

async function blurtLine() {
  return timed(async () => {
    let last = null;
    for (const node of BLURT_NODES) {
      try {
        const j = await jsonPost(node, { jsonrpc: "2.0", id: 1, method: "condenser_api.get_dynamic_global_properties", params: [] });
        const r = j.result;
        if (r && typeof r.head_block_number === "number") {
          return { headBlock: r.head_block_number, node: new URL(node).hostname };
        }
      } catch (e) { last = e; }
    }
    throw new Error(`all blurt nodes failed (last: ${last && last.message})`);
  });
}

// ה-Relay הריבוני: גובה-בלוק + קוד החוזה חי + יתרת-ה-relay
async function relayLine(name) {
  const { rpc, relay, chainId } = RELAYS[name];
  return timed(async () => {
    const hex = async (method, params) => {
      const j = await jsonPost(rpc, { jsonrpc: "2.0", id: 1, method, params });
      if (j.error) throw new Error(j.error.message || "rpc error");
      return j.result;
    };
    const head = parseInt(await hex("eth_blockNumber", []), 16);
    const code = await hex("eth_getCode", [relay, "latest"]);
    const balWei = BigInt(await hex("eth_getBalance", [relay, "latest"]));
    return {
      headBlock: head,
      chainId,
      relay,
      relayCodeBytes: Math.floor((code.length - 2) / 2),
      relayBalanceEth: Number(balWei / 10n ** 12n) / 1e6,
    };
  });
}

// שרשראות-הפקדות
async function tronLine() {
  return timed(async () => {
    const r = await jsonPost("https://api.trongrid.io/wallet/getnowblock", {});
    const n = r && r.block_header && r.block_header.raw_data && r.block_header.raw_data.number;
    if (typeof n !== "number") throw new Error("malformed tron block");
    return { headBlock: n, headAgeSec: r.block_header.raw_data.timestamp ? Math.max(0, Math.round((Date.now() - r.block_header.raw_data.timestamp) / 1000)) : null };
  });
}

async function btcLine() {
  return timed(async () => {
    let last = null;
    for (const u of BTC_NODES) {
      try {
        const res = await fetch(u, { headers: { "User-Agent": "saos-chain-vitals" }, signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const h = parseInt(await res.text(), 10);
        if (!Number.isFinite(h)) throw new Error("non-numeric tip");
        return { headBlock: h, node: new URL(u).hostname };
      } catch (e) { last = e; }
    }
    throw new Error(`all btc nodes failed (last: ${last && last.message})`);
  });
}

async function solanaLine() {
  return timed(async () => {
    const j = await jsonPost("https://api.mainnet-beta.solana.com", { jsonrpc: "2.0", id: 1, method: "getBlockHeight", params: [] });
    if (typeof j.result !== "number") throw new Error("malformed solana height");
    return { headBlock: j.result };
  });
}

// ── main: הכל במקביל ──
const defs = [
  { line: "steem", role: "anchor-line-1", run: steemLine },
  { line: "hive", role: "anchor-line-2", run: hiveLine },
  { line: "blurt", role: "anchor-line-3", run: blurtLine },
  { line: "ethereum", role: "sovereign-relay", run: () => relayLine("ETHEREUM") },
  { line: "optimism", role: "sovereign-relay", run: () => relayLine("OPTIMISM") },
  { line: "base", role: "sovereign-relay", run: () => relayLine("BASE") },
  { line: "tron", role: "deposit-chain", run: tronLine },
  { line: "bitcoin", role: "deposit-chain", run: btcLine },
  { line: "solana", role: "deposit-chain", run: solanaLine },
];

const results = await Promise.all(defs.map(async (d) => ({ ...d, ...(await d.run()) })));
for (const r of results) {
  log(`${r.ok ? "up  " : "DOWN"} ${r.line.padEnd(9)} ${r.latencyMs}ms ${r.ok ? JSON.stringify(r.detail).slice(0, 90) : r.error}`);
}

const up = results.filter((r) => r.ok).length;
const book = {
  format: "weave-vitals-v1",
  generatedAt: new Date().toISOString(),
  doctrine: "keyless parallel pulse of every chain line the weave runs on - public endpoints only, honest red rows, no derived books",
  verdict: up === results.length ? "ALL-LINES-UP" : up > 0 ? "DEGRADED" : "DARK",
  summary: { lines: results.length, up, down: results.length - up, worstLatencyMs: Math.max(...results.map((r) => r.latencyMs)) },
  lines: results.map((r) => ({
    line: r.line,
    role: r.role,
    ok: r.ok,
    latencyMs: r.latencyMs,
    detail: r.detail,
    error: r.error,
    measuredAt: new Date().toISOString(),
  })),
};

const text = JSON.stringify(book, null, 2) + "\n";
// שער-סודות מוקטן: הספר מכיל כתובות ציבוריות בלבד, אך החוק הוא החוק
if (/gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) {
  throw new Error("secret gate blocked vitals.json");
}
const { mkdirSync, writeFileSync } = await import("node:fs");
mkdirSync(new URL("../weave/", import.meta.url), { recursive: true });
writeFileSync(new URL("../weave/vitals.json", import.meta.url), text);

log(`${book.verdict} · ${up}/${results.length} lines up · worst latency ${book.summary.worstLatencyMs}ms`);
if (book.verdict !== "ALL-LINES-UP") {
  log("HONEST DEGRADED/DARK: red rows stay in the book — the run does not pretend");
}
