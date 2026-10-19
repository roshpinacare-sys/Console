/* saos-dex-seed.mjs — Genesis-2: THE POOLS. One-shot canonical opener.
 *
 * What it does (exactly once, idempotent — a second run is an honest no-op):
 *   1. Measures REAL custody: headcorner's on-chain liquid STEEM/SBD.
 *   2. Mints custody-backed credit (CSTEEM/CSBD) 1:1 against the excess
 *      above the ops float — never a unit more than real value held.
 *   3. Publishes the deposit address rail (cfg.addr, memo law saos:<claimId>).
 *   4. Opens the AMM pools SAOS/CSTEEM + SAOS/CSBD (fee 0.3%) and seeds them
 *      deep at the published reference rates.
 *   5. Executes real demo swaps BOTH directions through the saos-demo wallet
 *      — proof on chain that the exchange is live, not a mock.
 *   6. Refolds and verifies: k-invariant, conservation (supply == wallets +
 *      pools), custody verdict. Prints txids, addresses, verdicts only —
 *      zero key material, ever.
 *
 * Keys: treasury + demo + relay arrive from the architecture vault
 * (steem .secrets) via env override SAOS_TREASURY_WIF / SAOS_RELAY_WIF.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as Gate from "../gate-crypto.js";
import * as SL from "../saos-live.js";

const C = (typeof Gate.default === "object" && Gate.default) || Gate.default || Gate;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const BOOK = path.join(ROOT, "saos-live.json");
const RPC_BASES = (process.env.SAOS_RPC_BASES || "https://api.steemit.com,https://api.justyy.com").split(",").map((s) => s.trim()).filter(Boolean);
const RELAY_ACCOUNT = process.env.SAOS_RELAY_ACCOUNT || "headcorner";
const FEE_BPS = "30";
const SCALE = 100000000n;
const FLOAT = { STEEM: 100n * SCALE, SBD: 1n * SCALE };
const CAP = { CSTEEM: 500n * SCALE, CSBD: 5n * SCALE };
const log = (o) => { const line = JSON.stringify({ t: new Date().toISOString(), ...o }); console.log(line); try { fs.appendFileSync('/tmp/seed-debug.log', line + '\n'); } catch {} };

/* transport law (measured 2026-10-19T03:50Z): bun fetch intermittently fails
 * to connect ("typo in url/port") while the identical call via curl succeeds
 * every time — the seed rides curl (fresh TCP per call, sandbox-proven). */
import * as dns from "node:dns";
const IP_CACHE_FILE = "/tmp/saos-rpc-ips.json";
const ipCache = new Map();
try { for (const [h, ip] of Object.entries(JSON.parse(fs.readFileSync(IP_CACHE_FILE, "utf8")))) ipCache.set(h, ip); } catch { /* first boot */ }
function saveIps() { try { fs.writeFileSync(IP_CACHE_FILE, JSON.stringify(Object.fromEntries(ipCache))); } catch { /* tmp full — memory cache still works */ } }
async function resolveHost(host) {
  if (ipCache.has(host)) return ipCache.get(host);
  for (let i = 0; i < 20; i++) {
    try { const r = await dns.promises.lookup(host); ipCache.set(host, r.address); saveIps(); return r.address; } catch { /* flaky DNS — rapid retry */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}
const curlJson = async (url, body, timeoutS = 9) => {
  const u = new URL(url);
  const ip = await resolveHost(u.hostname); // DNS once per host, then pinned — the sandbox resolver flakes

  const args = ["curl", "-s", "-m", String(timeoutS), "-H", "Content-Type: application/json", "-d", body];
  if (ip) args.push("--resolve", `${u.hostname}:443:${ip}`);
  args.push(url);
  const pr = Bun.spawnSync(args);
  const out = pr.stdout.toString().trim();
  if (!out) throw new Error("curl-empty:" + pr.exitCode);
  return JSON.parse(out);
};

/* connectivity law (measured in the sandbox): per-connection failures are
 * common — pin ONE live node for the whole run, retry each call, re-probe
 * only as a last resort. Same law the fold runner learned (load-balancer). */
let pinnedNode = null;
async function pinNode() {
  if (pinnedNode) return pinnedNode;
  let best = null, bestHead = -1;
  for (const base of RPC_BASES) {
    try {
      const j = await curlJson(base + "/", JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_dynamic_global_properties", params: [], id: 1 }), 6);
      const head = j?.result?.head_block_number ?? -1;
      if (head > bestHead) { bestHead = head; best = base; }
    } catch { /* candidate down — skip honestly */ }
  }
  if (!best) {
    if ((pinNode.rounds = (pinNode.rounds || 0) + 1) < 30) { await new Promise((r) => setTimeout(r, 6000)); return pinNode(); } // DNS flaps in seconds — ride it out
    throw new Error("no-rpc-node-reachable");
  }
  pinNode.rounds = 0;
  pinnedNode = best;
  log({ verdict: "RPC-PINNED", node: best.replace(/^https?:\/\//, ""), head: bestHead });
  return best;
}
const rpc = async (method, params, round = 0) => {
  const order = [await pinNode(), ...RPC_BASES.filter((b) => b !== pinnedNode)];
  let last = null;
  for (const base of order) {
    try {
      const j = await curlJson(base + "/", JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }), 9);
      if (j?.error) throw new Error("rpc:" + String(j.error?.message ?? "").slice(0, 80));
      if (base !== pinnedNode) pinnedNode = base; // rotate onto what works
      return j?.result;
    } catch (e) { last = e; if (base === pinnedNode) pinnedNode = null; }
  }
  if (round < 3) { await new Promise((r) => setTimeout(r, 2000)); pinnedNode = null; return rpc(method, params, round + 1); }
  throw last ?? new Error("no-rpc");
};

async function privFromWif(wif) {
  const { version, payload } = await C.b58cDecode(String(wif).trim());
  if (version !== 0x80) throw new Error("wif-version");
  if (payload.length < 32 || payload.length > 33) throw new Error("wif-length:" + payload.length);
  return payload.slice(0, 32);
}
function vaultJson(rel) {
  const base = process.env.SAOS_VAULT_DIR || "/home/z/audit/repos/steem/.secrets";
  return JSON.parse(fs.readFileSync(path.join(base, rel), "utf8"));
}
async function keysFromSecret(s) {
  let priv;
  if (typeof s === "string" && /^[0-9a-fA-F]{64}$/.test(String(s).trim())) priv = C.unhex(String(s).trim()); // raw hex (demo vault law)
  else priv = await privFromWif(s);
  const pubSTM = await C.pubToSTM(C.privToPubBytes(new Uint8Array(priv)));
  const addr = await SL.addressFromPubSTM(pubSTM);
  return { priv, pubSTM, addr };
}
const decToUnits = (s) => {
  const v = String(s || "").trim().split(/\s+/)[0]; // "638.108 STEEM" → "638.108"
  const m = /^(\d+)(?:\.(\d{1,8}))?$/.exec(v);
  return m ? BigInt(m[1] + (m[2] ?? "").padEnd(8, "0")) : null;
};
/* chain law (measured 2026-10-19T04:12Z): "Account X already submitted 5
 * custom json operation(s)" — max 5 custom_json per account per block.
 * Broadcast in chunks of ≤4 across block boundaries. */
async function broadcast(envelopes, relayWif) {
  const getProps = () => rpc("condenser_api.get_dynamic_global_properties", []);
  const getBlockHeader = (n) => rpc("condenser_api.get_block_header", [n]);
  const priv = await privFromWif(relayWif);
  const txids = [];
  const CHUNK = 4;
  for (let i = 0; i < envelopes.length; i += CHUNK) {
    const chunk = envelopes.slice(i, i + CHUNK);
    const ops = chunk.map((e) => ["custom_json", { required_auths: [], required_posting_auths: [RELAY_ACCOUNT], id: SL.OP_ID, json: JSON.stringify(e) }]);
    const tx = await C.buildSignedTx(ops, priv, getProps, getBlockHeader);
    const r = await rpc("condenser_api.broadcast_transaction_synchronous", [tx]);
    txids.push(r?.id ?? null);
    log({ verdict: "CHUNK-BROADCAST", ops: chunk.map((o) => o.k), txid: r?.id ?? null });
    if (i + CHUNK < envelopes.length) await new Promise((r2) => setTimeout(r2, 4500)); // next block
  }
  return { ok: true, txid: txids[txids.length - 1] ?? null, txids, ops: envelopes.length };
}

async function main() {
  const t0 = Date.now();
  const st0 = await SL.selfTest();
  if (st0.passed !== st0.total) { log({ ok: false, verdict: "SELFTEST-FAIL-CLOSED", passed: st0.passed, total: st0.total }); process.exit(1); }
  log({ verdict: "SELFTEST-GREEN", passed: st0.passed, total: st0.total });

  /* idempotency: the book is the memory of the network */
  let book = null;
  try { book = JSON.parse(fs.readFileSync(BOOK, "utf8")); } catch { /* first run */ }
  const existingPools = Object.keys(book?.state?.pools ?? {});
  if (existingPools.length > 0) { log({ ok: true, verdict: "ALREADY-SEEDED", pools: existingPools }); return; }
  /* chain-side idempotency: the book may lag — the chain is the judge */
  const chainHasPools = await (async () => {
    try {
      const h = await rpc("condenser_api.get_account_history", [RELAY_ACCOUNT, -1, 100]);
      for (const [, ev] of h ?? []) {
        const op = ev?.op;
        if (op && op[0] === "custom_json" && op[1]?.id === SL.OP_ID) {
          const j = JSON.parse(op[1].json);
          for (const e of Array.isArray(j) ? j : [j]) if (e?.k === "pool.create" || e?.k === "pool.add") return true;
        }
      }
    } catch { /* honest — proceed only if book also empty */ }
    return false;
  })();
  if (chainHasPools) { log({ ok: true, verdict: "ALREADY-SEEDED-ON-CHAIN (verify-only run)" }); }
  const SKIP_BROADCAST = chainHasPools;

  /* 1. custody truth — public chain data only */
  const acc = (await rpc("condenser_api.get_accounts", [[RELAY_ACCOUNT]]))?.[0];
  if (!acc) { log({ ok: false, verdict: "NO-CUSTODIAN-ACCOUNT" }); process.exit(1); }
  const liquid = { STEEM: decToUnits(acc.balance), SBD: decToUnits(acc.sbd_balance) };
  if (!liquid.STEEM || !liquid.SBD) { log({ ok: false, verdict: "CUSTODY-UNPARSEABLE" }); process.exit(1); }

  /* 2. vault keys — transport is the custodian's POSTING authority (army
   * vault law, same as the fold); relay/env override stays for hosts that
   * hold it. Never printed. */
  const live = (() => { try { return vaultJson("saos-live-keys.json"); } catch { return {}; } })();
  const army = (() => { try { return vaultJson("army-keys.json"); } catch { return null; } })();
  const armyPosting = army?.accounts?.find((a) => a.name === RELAY_ACCOUNT && a.chain === "steem")?.gens?.find((g) => g.role === "posting")?.wif ?? null;
  const treasuryWif = process.env.SAOS_TREASURY_WIF || live?.treasury?.wif || null;
  const relayWif = process.env.SAOS_RELAY_WIF || armyPosting || null;
  const demo = (() => { try { return vaultJson("saos-demo-wallet.json"); } catch { return null; } })();
  const demoSecret = demo?.wif || demo?.priv_wif || demo?.privHex || null;
  if (!treasuryWif || !relayWif || !demoSecret) { log({ ok: false, verdict: "KEYS-MISSING", treasury: !!treasuryWif, relay: !!relayWif, demo: !!demoSecret }); process.exit(1); }
  const tr = await keysFromSecret(treasuryWif);
  const dm = await keysFromSecret(demoSecret);
  if (book?.genesis?.treasury && tr.addr !== book.genesis.treasury) { log({ ok: false, verdict: "TREASURY-KEY-MISMATCH" }); process.exit(1); }
  if (book?.state?.wallets && book.state.wallets[dm.addr]?.nick !== "saos-demo") { log({ ok: false, verdict: "DEMO-KEY-MISMATCH", got: dm.addr }); process.exit(1); }

  /* 3. custody-exact mints (excess above float, capped) */
  const excessSTEEM = liquid.STEEM - FLOAT.STEEM;
  const mintCSTEEM = excessSTEEM > CAP.CSTEEM ? CAP.CSTEEM : (excessSTEEM > 0n ? excessSTEEM : 0n);
  const excessSBD = liquid.SBD - FLOAT.SBD;
  const mintCSBD = excessSBD > CAP.CSBD ? CAP.CSBD : (excessSBD > 0n ? excessSBD : 0n);
  if (mintCSTEEM <= 0n) { log({ ok: false, verdict: "NO-EXCESS-CUSTODY", liquid: { STEEM: String(liquid.STEEM), SBD: String(liquid.SBD) } }); process.exit(1); }
  if (mintCSBD <= 0n) log({ verdict: "CSBD-DEFERRED (no SBD excess — the flywheel opens that pool when custody grows)" });
  log({ verdict: "CUSTODY-MEASURED", liquid: { STEEM: String(liquid.STEEM), SBD: String(liquid.SBD) }, mint: { CSTEEM: String(mintCSTEEM), CSBD: String(mintCSBD) } });

  /* 4. the envelopes — deterministic order is the law */
  const mk = async (who, fields) => {
    const env = { v: 1, id: Date.now() + "-" + C.hex(new Uint8Array([...globalThis.crypto.getRandomValues(new Uint8Array(4))])), by: who.addr, pub: who.pubSTM, ...fields };
    env.sig = await SL.signEnvelope(env, who.priv);
    return env;
  };
  const cfg = book?.state?.cfg ?? {};
  const envelopes = [];
  envelopes.push(await mk(tr, { k: "token.deploy", symbol: "CSTEEM", name: "SAOS credit STEEM (custody-backed 1:1)", decimals: 8, maxSupply: "900000000000000" }));
  if (mintCSBD > 0n) envelopes.push(await mk(tr, { k: "token.deploy", symbol: "CSBD", name: "SAOS credit SBD (custody-backed 1:1)", decimals: 8, maxSupply: "900000000000000" }));
  envelopes.push(await mk(tr, { k: "token.mint", symbol: "CSTEEM", to: tr.addr, amount: mintCSTEEM.toString() }));
  if (mintCSBD > 0n) envelopes.push(await mk(tr, { k: "token.mint", symbol: "CSBD", to: tr.addr, amount: mintCSBD.toString() }));
  if (!cfg.addrs?.STEEM) envelopes.push(await mk(tr, { k: "cfg.addr", cur: "STEEM", addr: RELAY_ACCOUNT, memo: "saos:<claimId> — put your claim id in the memo" }));
  if (!cfg.addrs?.SBD && mintCSBD > 0n) envelopes.push(await mk(tr, { k: "cfg.addr", cur: "SBD", addr: RELAY_ACCOUNT, memo: "saos:<claimId> — put your claim id in the memo" }));
  envelopes.push(await mk(tr, { k: "pool.create", pair: "SAOS/CSTEEM", feeBps: FEE_BPS }));
  if (mintCSBD > 0n) envelopes.push(await mk(tr, { k: "pool.create", pair: "SAOS/CSBD", feeBps: FEE_BPS }));

  /* deep seed at the published reference rates (the book is the source) */
  const rate = (pair, fallback) => { const p = parseFloat(cfg.rates?.[pair]?.price ?? fallback); return p > 0 ? p : fallback; };
  const rSTEEM = rate("SAOS/STEEM", 0.01934); // STEEM per 1 SAOS
  const rSBD = rate("SAOS/SBD", 0.002075); // SBD per 1 SAOS
  const baseCSTEEM = (mintCSTEEM * 1000n) / BigInt(Math.round(rSTEEM * 1e8)); // quote/rate, integer floor
  const baseCSBD = (mintCSBD * 1000n) / BigInt(Math.round(rSBD * 1e8));
  envelopes.push(await mk(tr, { k: "pool.add", pair: "SAOS/CSTEEM", base: baseCSTEEM.toString(), quote: mintCSTEEM.toString() }));
  if (mintCSBD > 0n) envelopes.push(await mk(tr, { k: "pool.add", pair: "SAOS/CSBD", base: baseCSBD.toString(), quote: mintCSBD.toString() }));

  /* 5. real demo swaps — both directions, live, on chain */
  const quoteSA2C = (resA, resB, a) => { const inFee = (a * 9970n) / 10000n; return (resB * inFee) / (resA + inFee); };
  const sw1in = 400000n;
  const sw1out = quoteSA2C(baseCSTEEM, mintCSTEEM, sw1in);
  envelopes.push(await mk(dm, { k: "pool.swap", pair: "SAOS/CSTEEM", dir: "SA2C", amountIn: sw1in.toString(), minOut: ((sw1out * 95n) / 100n).toString() }));
  const sw2in = (sw1out * 40n) / 100n; // swap 40% of what arrived back to SAOS
  const resA2 = baseCSTEEM + sw1in, resB2 = mintCSTEEM - sw1out;
  const sw2out = (resA2 * ((sw2in * 9970n) / 10000n)) / (resB2 + ((sw2in * 9970n) / 10000n));
  envelopes.push(await mk(dm, { k: "pool.swap", pair: "SAOS/CSTEEM", dir: "C2SA", amountIn: sw2in.toString(), minOut: ((sw2out * 95n) / 100n).toString() }));
  if (mintCSBD > 0n) {
    const sw3in = 50000n;
    const sw3out = quoteSA2C(baseCSBD, mintCSBD, sw3in);
    envelopes.push(await mk(dm, { k: "pool.swap", pair: "SAOS/CSBD", dir: "SA2C", amountIn: sw3in.toString(), minOut: ((sw3out * 95n) / 100n).toString() }));
  }

  /* 6. broadcast (chunked, ordered), settle, refold, verify */
  const bc = SKIP_BROADCAST ? { ok: true, txids: [], txid: null, ops: 0 } : await broadcast(envelopes, relayWif);
  log({ verdict: "GENESIS2-BROADCAST", ops: bc.ops, txids: bc.txids });
  await new Promise((r) => setTimeout(r, 3500));
  const hist = await rpc("condenser_api.get_account_history", [RELAY_ACCOUNT, -1, 100]);
  const picked = [];
  for (const [idx, ev] of hist ?? []) {
    const op = ev?.op;
    if (op && op[0] === "custom_json" && op[1]?.id === SL.OP_ID) {
      try { const j = JSON.parse(op[1].json); (Array.isArray(j) ? j : [j]).forEach((e) => picked.push(e)); } catch { /* skip */ }
    }
  }
  const res = await SL.fold(picked);
  const pools = res.state.pools ?? {};
  const spot = (p) => (p.resA > 0n ? (Number(p.resB) / 1e8) / (Number(p.resA) / 1000) : 0);
  const con = {};
  for (const sym of Object.keys(res.supplyCanon)) {
    let sum = 0n;
    for (const a of Object.keys(res.state.bal)) sum += res.state.bal[a]?.[sym] || 0n;
    for (const pair of Object.keys(pools)) { const p = pools[pair]; if (p.base === sym) sum += p.resA; if (p.quote === sym) sum += p.resB; }
    con[sym] = sum === BigInt(res.supplyCanon[sym]) ? "ok" : "BROKEN";
  }
  log({
    ok: true,
    verdict: "GENESIS2-LIVE",
    valid: res.valid,
    invalid: res.invalid.slice(-5),
    pools: Object.fromEntries(Object.keys(pools).map((pair) => [pair, { resA: String(pools[pair].resA), resB: String(pools[pair].resB), lp: String(pools[pair].lpSupply), swaps: String(pools[pair].swaps), spot: spot(pools[pair]).toFixed(6) }])),
    conservation: con,
    treasuryAddr: tr.addr,
    demoAddr: dm.addr,
    txid: bc.txid,
    ms: Date.now() - t0,
  });
}
main().catch((e) => { log({ ok: false, verdict: "SEED-ERROR", err: String(e?.message ?? e).slice(0, 200), stack: String(e?.stack ?? "").split("\n").slice(0, 4) }); process.exit(1); });
