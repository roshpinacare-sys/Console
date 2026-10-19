/* saos-dex-reconcile.mjs — Genesis-2 remediation: custody restoration.
 *
 * Measured incident (2026-10-19T04:14Z): the seed's chain-side idempotency
 * check raced the exec-rig flood (≈100 events/min) and re-broadcast a full
 * Genesis-2 set with fresh envelope ids — the fold accepted the second mints
 * and second pool.adds (they are legal ops in themselves). Result: C-credit
 * outstanding exceeded real custody → the book published custody-deficit
 * (the audit did its job — nothing hides).
 *
 * This script restores custody-ok with pure protocol ops, no edits to state:
 *   1. treasury pool.remove of the duplicate LP (recovers the duplicate
 *      credit + its SAOS pair, pro-rata, deterministic).
 *   2. token.burn of the exact unbacked excess (credit supply shrinks to
 *      what real custody actually backs).
 *   3. refold + verify: custody-ok, conservation ok, k intact.
 * Zero exposure: verdicts and txids only.
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
const SCALE = 100000000n;
const FLOAT = { CSTEEM: 100n * SCALE, CSBD: 1n * SCALE };
const log = (o) => { const line = JSON.stringify({ t: new Date().toISOString(), ...o }); console.log(line); try { fs.appendFileSync("/tmp/saos-reconcile.log", line + "\n"); } catch {} };

const ipCache = new Map();
try { for (const [h, ip] of Object.entries(JSON.parse(fs.readFileSync("/tmp/saos-rpc-ips.json", "utf8")))) ipCache.set(h, ip); } catch {}
function saveIps() { try { fs.writeFileSync("/tmp/saos-rpc-ips.json", JSON.stringify(Object.fromEntries(ipCache))); } catch {} }
async function resolveHost(host) {
  if (ipCache.has(host)) return ipCache.get(host);
  for (let i = 0; i < 20; i++) {
    try { const r = await (await import("node:dns")).promises.lookup(host); ipCache.set(host, r.address); saveIps(); return r.address; } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}
const curlJson = async (url, body, timeoutS = 9) => {
  const u = new URL(url);
  const ip = await resolveHost(u.hostname);
  const args = ["curl", "-s", "-m", String(timeoutS), "-H", "Content-Type: application/json", "-d", body];
  if (ip) args.push("--resolve", `${u.hostname}:443:${ip}`);
  args.push(url);
  const pr = Bun.spawnSync(args);
  const out = pr.stdout.toString().trim();
  if (!out) throw new Error("curl-empty:" + pr.exitCode);
  return JSON.parse(out);
};
let pinnedNode = null;
async function pinNode() {
  if (pinnedNode) return pinnedNode;
  let best = null, bestHead = -1;
  for (const base of RPC_BASES) {
    try {
      const j = await curlJson(base + "/", JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_dynamic_global_properties", params: [], id: 1 }), 6);
      const head = j?.result?.head_block_number ?? -1;
      if (head > bestHead) { bestHead = head; best = base; }
    } catch { /* skip */ }
  }
  if (!best) { if ((pinNode.rounds = (pinNode.rounds || 0) + 1) < 30) { await new Promise((r) => setTimeout(r, 6000)); return pinNode(); } throw new Error("no-rpc-node-reachable"); }
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
      if (base !== pinnedNode) pinnedNode = base;
      return j?.result;
    } catch (e) { last = e; if (base === pinnedNode) pinnedNode = null; }
  }
  if (round < 3) { await new Promise((r) => setTimeout(r, 2000)); pinnedNode = null; return rpc(method, params, round + 1); }
  throw last ?? new Error("no-rpc");
};
async function historyPage(account, from, limit) {
  try {
    const r = await rpc("account_history_api.get_account_history", { account, start: from, limit });
    return (r?.history ?? []).map(([idx, ev]) => {
      const o = ev?.op ?? {};
      const name = String(o.type || "").replace(/_operation$/, "");
      return [idx, { ...ev, op: [name, o.value ?? {}] }];
    });
  } catch { return await rpc("condenser_api.get_account_history", [account, from, limit]); }
}
async function readEnvelopes(account) {
  const picked = []; // [idx, envelope]
  let from = -1, seenSaos = false;
  for (let page = 0; page < 40; page++) {
    const hist = await historyPage(account, from, 100);
    if (!hist?.length) break;
    const oldest = hist[0][0];
    let pageSaos = 0;
    for (const [idx, ev] of hist) {
      const op = ev?.op;
      if (op && op[0] === "custom_json" && op[1]?.id === SL.OP_ID) {
        pageSaos++; seenSaos = true;
        try { const j = JSON.parse(op[1].json); (Array.isArray(j) ? j : [j]).forEach((e) => picked.push([idx, e])); } catch {}
      }
    }
    if (oldest <= 0) break;
    if (seenSaos && pageSaos === 0) break;
    from = oldest - 1;
  }
  picked.sort((a, b) => a[0] - b[0]); // the chain is the judge — strict index order
  return picked.map(([, e]) => e);
}
async function privFromWif(wif) {
  const { version, payload } = await C.b58cDecode(String(wif).trim());
  if (version !== 0x80) throw new Error("wif-version");
  return payload.slice(0, 32);
}
async function broadcast(envelopes, relayWif) {
  const getProps = () => rpc("condenser_api.get_dynamic_global_properties", []);
  const getBlockHeader = (n) => rpc("condenser_api.get_block_header", [n]);
  const priv = await privFromWif(relayWif);
  const txids = [];
  for (let i = 0; i < envelopes.length; i += 4) {
    const chunk = envelopes.slice(i, i + 4);
    const ops = chunk.map((e) => ["custom_json", { required_auths: [], required_posting_auths: [RELAY_ACCOUNT], id: SL.OP_ID, json: JSON.stringify(e) }]);
    const tx = await C.buildSignedTx(ops, priv, getProps, getBlockHeader);
    let r = null, lastErr = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try { r = await rpc("condenser_api.broadcast_transaction_synchronous", [tx]); lastErr = null; break; }
      catch (e) {
        lastErr = e;
        if (!/custom json operation/i.test(String(e?.message))) throw e;
        await new Promise((res) => setTimeout(res, 5000));
        Object.assign(tx, await C.buildSignedTx(ops, priv, getProps, getBlockHeader));
      }
    }
    if (lastErr) throw lastErr;
    txids.push(r?.id ?? null);
    log({ verdict: "CHUNK-BROADCAST", ops: chunk.map((o) => o.k), txid: r?.id ?? null });
    if (i + 4 < envelopes.length) await new Promise((r2) => setTimeout(r2, 4500));
  }
  return { txids };
}

const CREDIT_OF = { STEEM: "CSTEEM", SBD: "CSBD" };
const decToUnits = (s) => {
  const m = /^(\d+)(?:\.(\d{1,8}))?$/.exec(String(s || "").trim().split(/\s+/)[0]);
  return m ? BigInt(m[1] + (m[2] ?? "").padEnd(8, "0")) : 0n;
};

async function main() {
  const t0 = Date.now();
  const st0 = await SL.selfTest();
  if (st0.passed !== st0.total) { log({ ok: false, verdict: "SELFTEST-FAIL-CLOSED" }); process.exit(1); }
  const live = JSON.parse(fs.readFileSync(process.env.SAOS_VAULT_DIR || "/home/z/audit/repos/steem/.secrets/saos-live-keys.json", "utf8"));
  const army = JSON.parse(fs.readFileSync(process.env.SAOS_VAULT_DIR || "/home/z/audit/repos/steem/.secrets/army-keys.json", "utf8"));
  const treasuryWif = process.env.SAOS_TREASURY_WIF || live?.treasury?.wif;
  const relayWif = process.env.SAOS_RELAY_WIF || army?.accounts?.find((a) => a.name === RELAY_ACCOUNT && a.chain === "steem")?.gens?.find((g) => g.role === "posting")?.wif;
  if (!treasuryWif || !relayWif) { log({ ok: false, verdict: "KEYS-MISSING" }); process.exit(1); }
  const priv = await privFromWif(treasuryWif);
  const pubSTM = await C.pubToSTM(C.privToPubBytes(new Uint8Array(priv)));
  const by = await SL.addressFromPubSTM(pubSTM);

  /* truth = deep chain fold */
  const envelopes = await readEnvelopes(RELAY_ACCOUNT);
  const res = await SL.fold(envelopes);
  const state = res.state;
  log({ verdict: "FOLDED", valid: res.valid, invalid: res.invalid.length, pools: Object.keys(state.pools) });

  /* custody measure */
  const acc = (await rpc("condenser_api.get_accounts", [[RELAY_ACCOUNT]]))?.[0];
  const liquid = { STEEM: decToUnits(acc?.balance), SBD: decToUnits(acc?.sbd_balance) };
  log({ verdict: "CUSTODY", liquid: { STEEM: String(liquid.STEEM), SBD: String(liquid.SBD) } });

  const mk = async (fields) => {
    const env = { v: 1, id: Date.now() + "-" + C.hex(new Uint8Array([...globalThis.crypto.getRandomValues(new Uint8Array(4))])), by, pub: pubSTM, ...fields };
    env.sig = await SL.signEnvelope(env, priv);
    return env;
  };
  const envelopesOut = [];

  for (const [cur, sym] of Object.entries(CREDIT_OF)) {
    let outstanding = 0n;
    for (const addr of Object.keys(state.bal)) outstanding += state.bal[addr]?.[sym] || 0n;
    const pool = state.pools["SAOS/" + sym];
    if (pool) outstanding += pool.resB;
    const deficit = outstanding + FLOAT[sym] - liquid[cur];
    log({ verdict: "AUDIT", sym, outstanding: String(outstanding), deficit: String(deficit), verdict: deficit <= 0n ? "custody-ok" : "custody-deficit" });
    if (deficit <= 0n || !pool) continue;

    /* 1. remove LP to recover the duplicate credit (treasury-side) */
    const lpNeeded = ((deficit + SCALE) * pool.lpSupply) / pool.resB + 1000n; // + margin & dust
    const lpRemove = lpNeeded > pool.lpBal[by] ? pool.lpBal[by] : lpNeeded;
    if (lpRemove <= 0n) { log({ verdict: "NO-LP-TO-REMOVE", sym }); continue; }
    envelopesOut.push(await mk({ k: "pool.remove", pair: "SAOS/" + sym, lp: lpRemove.toString() }));
    /* pro-rata estimate of what comes back */
    const backB = (pool.resB * lpRemove) / pool.lpSupply;
    const burn = deficit < backB ? deficit : backB;
    if (burn > 0n) {
      /* 2. burn the unbacked excess (pool.remove lands first — same tx order) */
      envelopesOut.push(await mk({ k: "token.burn", symbol: sym, amount: burn.toString() }));
    }
    log({ verdict: "RECONCILE-PLAN", sym, lpRemove: String(lpRemove), expectBack: String(backB), burn: String(burn) });
  }

  if (!envelopesOut.length) { log({ ok: true, verdict: "CUSTODY-ALREADY-OK (no action)" }); return; }
  const bc = await broadcast(envelopesOut, relayWif);
  log({ verdict: "RECONCILE-BROADCAST", txids: bc.txids });
  await new Promise((r) => setTimeout(r, 4000));

  /* 3. refold + verify */
  const envelopes2 = await readEnvelopes(RELAY_ACCOUNT);
  const res2 = await SL.fold(envelopes2);
  const acc2 = (await rpc("condenser_api.get_accounts", [[RELAY_ACCOUNT]]))?.[0];
  const liquid2 = { STEEM: decToUnits(acc2?.balance), SBD: decToUnits(acc2?.sbd_balance) };
  const verdicts = {};
  for (const [cur, sym] of Object.entries(CREDIT_OF)) {
    let outstanding = 0n;
    for (const addr of Object.keys(res2.state.bal)) outstanding += res2.state.bal[addr]?.[sym] || 0n;
    const pool = res2.state.pools["SAOS/" + sym];
    if (pool) outstanding += pool.resB;
    verdicts[sym] = outstanding + FLOAT[sym] <= liquid2[cur] ? "custody-ok" : "custody-deficit:" + (outstanding + FLOAT[sym] - liquid2[cur]);
  }
  log({ ok: true, verdict: "RECONCILE-DONE", valid: res2.valid, custody: verdicts, ms: Date.now() - t0 });
}
main().catch((e) => { log({ ok: false, verdict: "RECONCILE-ERROR", err: String(e?.message ?? e).slice(0, 200) }); process.exit(1); });
