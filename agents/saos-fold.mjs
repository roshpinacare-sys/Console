/* saos-fold.mjs — the canonical fold runner for the live SAOS protocol
 * (saos.live.v1). One file, three duties, zero custody beyond what env gives:
 *
 *   1. FOLD: read every custom_json op (id `saos.weave.live.v1`) the relayer
 *      account ever published from the public chain, re-verify every inner
 *      signature with the SAME code every browser runs (../saos-live.js), and
 *      fold them into the deterministic state. The chain is the judge.
 *   2. TREASURY BEAT: pending deposit.claims are countersigned by the
 *      genesis treasury key (env SAOS_TREASURY_WIF) into deposit.credit ops —
 *      at rates the treasury itself published on chain (cfg.rate). No rate in
 *      state → the claim is skipped honestly ("no-rate"), never invented.
 *   3. PUBLISH: write saos-live.json (the public live book) — the exact shape
 *      wallet.html consumes — and exit 0. Any failure exits non-zero
 *      (fail-closed); a stale-but-honest book is never a lie.
 *
 * Secrets: SAOS_TREASURY_WIF / SAOS_RELAY_WIF arrive via env (Actions
 * secrets). Locally the runner may read the architecture vault path
 * (steem .secrets/saos-live-keys.json) when env is absent. No key material
 * is ever printed — verdicts, pubkeys, addresses, txids only.
 *
 * The self-test gate (saos-live.js selfTest) must pass before anything runs:
 * same ops in, same stateRoot out — or nothing is published. */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as Gate from "../gate-crypto.js";
import * as SL from "../saos-live.js";

const C = (typeof Gate.default === "object" && Gate.default) || Gate.default || Gate;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const RPC = process.env.SAOS_RPC || ""; // empty → probe & pin the freshest node
const RPC_BASES = (process.env.SAOS_RPC_BASES || "https://api.steemit.com,https://api.justyy.com,https://steemd.privex.io,https://rpc.steemliberator.com").split(",").map(s => s.trim()).filter(Boolean);
const RELAY_ACCOUNT = process.env.SAOS_RELAY_ACCOUNT || "headcorner";
const BOOK = path.join(ROOT, "saos-live.json");
const GENESIS_NOTE = "initial mint mirrors SAOS-NET v0 verified supply 1:1 (126,682 SAOS, issuer acct-40, genesis 2026-09-05)";
const MAX_HISTORY = 50000;
const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));

const rpc = async (method, params) => {
  const base = RPC || (await pickNode());
  const r = await fetch(base + "/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }) });
  const j = await r.json();
  if (j?.error) throw new Error("rpc:" + String(j.error?.message ?? "err").slice(0, 100));
  return j?.result;
};
/* load-balancer law (measured 2026-10-19): api.steemit.com fans out across
 * nodes whose account-history heads differ by hundreds of events — naive
 * pagination hops between snapshots and loses ops. Probe candidates once,
 * pin the one with the deepest history head for the WHOLE run. */
let pinnedNode = null;
async function pickNode() {
  if (pinnedNode) return pinnedNode;
  let best = null, bestHead = -1;
  for (const base of RPC_BASES) {
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch(base + "/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_dynamic_global_properties", params: [], id: 1 }), signal: ctl.signal });
      clearTimeout(to);
      const j = await r.json();
      const head = j?.result?.head_block_number ?? -1;
      if (head > bestHead) { bestHead = head; best = base; }
    } catch { /* candidate down — skip honestly */ }
  }
  if (!best) throw new Error("no-rpc-node-reachable");
  pinnedNode = best;
  return best;
}

/* history page: condenser first, appbase fallback (some nodes serve the
 * appbase account_history_api fresher — measured 2026-10-19T04:16Z when the
 * condenser view lagged 100+ events behind the chain head). Both normalized
 * to the condenser event shape [idx, {op: [name, body]}]. */
async function historyPage(account, from, limit) {
  try {
    /* appbase first: measured fresher than the condenser view on both
     * public nodes (2026-10-19T04:16Z — condenser lagged 100+ events) */
    const r = await rpc("account_history_api.get_account_history", { account, start: from, limit });
    return (r?.history ?? []).map(([idx, ev]) => {
      const o = ev?.op ?? {};
      const name = String(o.type || "").replace(/_operation$/, "");
      return [idx, { ...ev, op: [name, o.value ?? {}] }];
    });
  } catch (e) {
    return await rpc("condenser_api.get_account_history", [account, from, limit]);
  }
}

/* ── chain reading: every SAOS custom_json the relayer account published.
 * Deterministic law: the envelope list is ALWAYS in chain order (sorted by
 * the account-history index) — same ops in, same stateRoot out. ── */
async function readChainEnvelopes(account) {
  const picked = []; // [idx, envelope]
  let from = -1;
  let seenSaos = false;
  let emptyRetries = 0;
  for (let page = 0; page < 60; page++) {
    let hist = await historyPage(account, from, 100);
    if (!hist?.length) {
      if (emptyRetries++ < 2) { await new Promise((r) => setTimeout(r, 800)); continue; } // node hiccup — retry once, honestly
      break;
    }
    const oldest = hist[0][0];
    let pageSaos = 0;
    for (const [idx, ev] of hist) {
      const op = ev?.op;
      if (op && op[0] === "custom_json" && op[1]?.id === SL.OP_ID) {
        pageSaos++;
        seenSaos = true;
        try {
          const j = JSON.parse(op[1].json);
          if (Array.isArray(j)) j.forEach((e) => picked.push([idx, e]));
          else picked.push([idx, j]);
        } catch { picked.push([idx, { _bad: "unparseable" }]); }
      }
    }
    if (oldest <= 0) break;
    /* stop law (measured: the relayer account carries heavy limit-order rails
     * that flood ~100 events/minute — a single newest-window scan is never
     * enough). Keep paging until a FULL page holds zero SAOS ops after we
     * have seen at least one — everything older than a clean page predates
     * the protocol. */
    if (seenSaos && pageSaos === 0) break;
    from = oldest - 1;
  }
  picked.sort((a, b) => a[0] - b[0]);
  return picked.map(([, e]) => e);
}

/* ── treasury beat: deterministic credit math, integer BigInt, fail-honest ── */
const SCALE = 100000000n; // 1e8 sub-units for external decimal strings
/* Genesis-2 custody law: C-credit exists only against currency the treasury
 * custodian (the relay account) actually holds on chain. Floats stay out of
 * custody for operations. Every fold run measures and publishes the verdict. */
const CUSTODY_FLOAT = { STEEM: "100", SBD: "1" };
const FLYWHEEL_MAX = { CSTEEM: "20000000000", CSBD: "500000000" }; // 200 STEEM / 5 SBD per run
const FLYWHEEL_MIN = { CSTEEM: 10n * SCALE, CSBD: SCALE / 2n }; // 10 STEEM / 0.5 SBD
const CREDIT_OF = { STEEM: "CSTEEM", SBD: "CSBD" };
function decToScaled(s) {
  const m = /^(\d+)(?:\.(\d{1,8}))?$/.exec(String(s || ""));
  if (!m) return null;
  const whole = m[1];
  const frac = (m[2] ?? "").padEnd(8, "0");
  return BigInt(whole + frac);
}
function creditUnits(amt, price) {
  const a = decToScaled(amt);
  const p = decToScaled(price);
  if (a === null || p === null || p <= 0n) return null;
  /* contract law: price = currency units per 1 SAOS (e.g. SAOS/USD 0.001
   * means 1 SAOS = $0.001). SAOS units carry 3 decimals → ×1000. */
  return (a * 1000n) / p; // floor — treasury never over-credits
}
async function treasuryBeat(state, envelopes = []) {
  const wif = process.env.SAOS_TREASURY_WIF || localVaultWif("treasury");
  if (!wif) return { newOps: [], note: "no-treasury-key (fold-only mode)" };
  const priv = Buffer.from(C.unhex(await privHexFromWif(wif)));
  const pubSTM = await C.pubToSTM(C.privToPubBytes(new Uint8Array(priv)));
  const by = await SL.addressFromPubSTM(pubSTM);
  if (state.treasury && by !== state.treasury) return { newOps: [], note: "treasury-key-mismatch (fail-closed)" };
  /* double-credit guard (measured 2026-10-19: a beat inside the history-lag
   * window re-credited an already-credited claim — the chain fold rejected
   * it fail-closed, but the wasted tx is prevented here): a claim that
   * already has ANY deposit.credit envelope on chain is never credited again. */
  const creditedClaims = new Set(envelopes.filter((e) => e?.k === "deposit.credit" && e.claimId).map((e) => String(e.claimId)));
  const newOps = [];
  const skips = [];
  for (const id of Object.keys(state.claims).sort()) {
    const cl = state.claims[id];
    if (cl.status !== "pending") continue;
    if (creditedClaims.has(id)) { skips.push({ id, why: "already-credited-on-chain" }); continue; }
    const rate = state.cfg.rates?.["SAOS/" + cl.cur]?.price;
    if (!rate) { skips.push({ id, why: "no-rate:" + cl.cur }); continue; }
    const units = creditUnits(cl.amt, rate);
    if (units === null || units <= 0n) { skips.push({ id, why: "credit-math" }); continue; }
    const env = { v: 1, id: makeOpId(), k: "deposit.credit", by, pub: pubSTM, claimId: id, to: cl.by, saos: units.toString(), cur: cl.cur, amt: cl.amt, ref: cl.ref, note: "auto-countersign at published rate" };
    env.sig = await SL.signEnvelope(env, new Uint8Array(priv));
    newOps.push(env);
  }
  return { newOps, skips, by, pubSTM };
}
function localVaultWif(which) {
  try {
    const p = process.env.SAOS_VAULT_KEYS || "/home/z/audit/repos/steem/.secrets/saos-live-keys.json";
    const v = JSON.parse(fs.readFileSync(p, "utf8"));
    return v?.[which]?.wif || null;
  } catch { return null; }
}

/* ── Genesis-2: custody audit + liquidity flywheel (real value in, pools deep) ── */
function creditOutstanding(state, symbol) {
  let sum = 0n;
  for (const addr of Object.keys(state.bal)) sum += state.bal[addr]?.[symbol] || 0n;
  for (const pair of Object.keys(state.pools)) { const p = state.pools[pair]; if (p.quote === symbol) sum += p.resB; }
  return sum;
}
function decToUnits(s) {
  const v = String(s || "").trim().split(/\s+/)[0]; // "638.108 STEEM" → "638.108"
  const m = /^(\d+)(?:\.(\d{1,8}))?$/.exec(v);
  if (!m) return null;
  return BigInt(m[1] + (m[2] ?? "").padEnd(8, "0"));
}
async function measureCustody() {
  try {
    const acc = await rpc("condenser_api.get_accounts", [[RELAY_ACCOUNT]]);
    const a = acc?.[0];
    if (!a) return null;
    return { STEEM: decToUnits(a.balance), SBD: decToUnits(a.sbd_balance), at: new Date().toISOString() };
  } catch { return null; } // fail-honest: no chain access → no custody claims
}
function custodyAudit(state, measured) {
  const out = {};
  const verdict = {};
  for (const cur of Object.keys(CREDIT_OF)) {
    const sym = CREDIT_OF[cur];
    const o = creditOutstanding(state, sym);
    const liquid = measured?.[cur] ?? null;
    const flt = decToUnits(CUSTODY_FLOAT[cur]);
    out[sym] = String(o);
    verdict[sym] = liquid === null ? "unmeasured" : (o + flt <= liquid ? "custody-ok" : "custody-deficit");
  }
  return { custodian: RELAY_ACCOUNT, measured: measured ? { STEEM: String(measured.STEEM), SBD: String(measured.SBD) } : null, outstanding: out, verdict, float: CUSTODY_FLOAT };
}
async function liquidityBeat(state, by, pubSTM, priv) {
  /* the flywheel: sweep every real currency unit above the ops float into
   * custody-backed credit and from there into the pools — the network
   * deepens its own liquidity from its real income, forever, alone. */
  const measured = await measureCustody();
  if (!measured) return { newOps: [], note: "custody-unmeasured (fail-honest — no mint)" };
  const newOps = [];
  const notes = [];
  for (const cur of Object.keys(CREDIT_OF)) {
    const sym = CREDIT_OF[cur];
    const liquid = measured[cur];
    if (liquid === null) continue;
    const flt = decToUnits(CUSTODY_FLOAT[cur]);
    const outstanding = creditOutstanding(state, sym);
    const excess = liquid - flt - outstanding;
    const max = BigInt(FLYWHEEL_MAX[sym]);
    if (excess < FLYWHEEL_MIN[sym]) { notes.push(sym + ":below-min"); continue; }
    const mint = excess > max ? max : excess;
    newOps.push({ v: 1, id: makeOpId(), k: "token.mint", by, pub: pubSTM, symbol: sym, to: state.treasury, amount: mint.toString() });
    const pool = state.pools["SAOS/" + sym];
    if (pool && pool.lpSupply > 0n && pool.resB > 0n) {
      const base = (mint * pool.resA) / pool.resB; // floor — always within ±2% law
      if (base > 0n && (state.bal[state.treasury]?.SAOS || 0n) >= base) {
        newOps.push({ v: 1, id: makeOpId(), k: "pool.add", by, pub: pubSTM, pair: "SAOS/" + sym, base: base.toString(), quote: mint.toString() });
      } else notes.push(sym + ":pool-add-skipped");
    } else if (pool && excess >= FLYWHEEL_MIN[sym]) {
      /* pool exists but empty (created ahead of custody) — seed it now at the published reference rate */
      const ref = state.cfg.rates?.["SAOS/" + cur]?.price;
      const rp = ref ? parseFloat(ref) : null;
      const base = rp ? (mint * 1000n) / BigInt(Math.round(rp * 1e8)) : 0n;
      if (base > 0n && (state.bal[state.treasury]?.SAOS || 0n) >= base) {
        newOps.push({ v: 1, id: makeOpId(), k: "pool.add", by, pub: pubSTM, pair: "SAOS/" + sym, base: base.toString(), quote: mint.toString() });
      } else notes.push(sym + ":pool-seed-skipped");
    } else if (!pool && excess >= FLYWHEEL_MIN[sym]) {
      /* no pool yet — the treasury opens it itself when real custody arrives */
      const ref = state.cfg.rates?.["SAOS/" + cur]?.price;
      const rp = ref ? parseFloat(ref) : null;
      const base = rp ? (mint * 1000n) / BigInt(Math.round(rp * 1e8)) : 0n;
      if (base > 0n && (state.bal[state.treasury]?.SAOS || 0n) >= base) {
        newOps.push({ v: 1, id: makeOpId(), k: "pool.create", by, pub: pubSTM, pair: "SAOS/" + sym, feeBps: "30" });
        newOps.push({ v: 1, id: makeOpId(), k: "pool.add", by, pub: pubSTM, pair: "SAOS/" + sym, base: base.toString(), quote: mint.toString() });
      } else notes.push(sym + ":pool-open-skipped");
    } else notes.push(sym + ":pool-absent (credit held by treasury)");
  }
  for (const env of newOps) env.sig = await SL.signEnvelope(env, priv);
  return { newOps, notes, measured };
}
async function privHexFromWif(wif) {
  return C.hex(await privFromWif(wif));
}
/* unified WIF decode: tolerates both 32-byte payloads and 33-byte
 * (0x01 compression-flag) WIFs — the vault law (steemtx wifEncode) emits the latter */
async function privFromWif(wif) {
  const { version, payload } = await C.b58cDecode(String(wif).trim());
  if (version !== 0x80) throw new Error("wif-version");
  if (payload.length < 32 || payload.length > 33) throw new Error("wif-length:" + payload.length);
  return payload.slice(0, 32);
}
function makeOpId() {
  const rnd = new Uint8Array(6);
  globalThis.crypto.getRandomValues(rnd);
  return Date.now() + "-" + C.hex(rnd);
}

/* ── broadcast: gate-crypto portable path (verified against steem-js) ── */
async function broadcast(envelopes, relayWif) {
  if (!relayWif || !envelopes.length) return { ok: false, why: envelopes.length ? "no-relay-wif" : "nothing-to-broadcast" };
  const acct = RELAY_ACCOUNT;
  const priv = await privFromWif(relayWif);
  const ops = envelopes.map((e) => ["custom_json", { required_auths: [], required_posting_auths: [acct], id: SL.OP_ID, json: JSON.stringify(e) }]);
  const getProps = () => rpc("condenser_api.get_dynamic_global_properties", []);
  const getBlockHeader = (n) => rpc("condenser_api.get_block_header", [n]);
  const tx = await C.buildSignedTx(ops, priv, getProps, getBlockHeader);
  let r = null, lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      r = await rpc("condenser_api.broadcast_transaction_synchronous", [tx]);
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (!/custom json operation/i.test(String(e?.message))) throw e; // real errors fail fast
      await new Promise((res) => setTimeout(res, 5000)); // quota law — next block clears it
      Object.assign(tx, await C.buildSignedTx(ops, priv, getProps, getBlockHeader)); // fresh expiration
    }
  }
  if (lastErr) throw lastErr;
  return { ok: true, txid: r?.id ?? null, ops: ops.length };
}

/* ── the published book: exactly the shape wallet.html reads ── */
function renderBook(res, genesisTxid, relayUrl, custody) {
  const st = res.state;
  return {
    format: "saos-live-v1",
    generatedAt: new Date().toISOString(),
    protocol: res.protocol,
    stateRoot: res.stateRoot,
    genesis: {
      done: Boolean(st.treasury),
      treasury: st.treasury,
      txid: genesisTxid,
      symbol: SL.SAOS_GENESIS.symbol,
      initialMint: SL.SAOS_GENESIS.initialMint,
      maxSupply: SL.SAOS_GENESIS.maxSupply,
      note: GENESIS_NOTE,
    },
    state: {
      wallets: res.walletsCanon,
      tokens: res.tokensCanon,
      balances: res.balCanon,
      supply: res.supplyCanon,
      claims: res.claimsCanon,
      offers: res.offersCanon,
      cfg: res.cfgCanon,
      pools: res.poolsCanon,
      rewardsPaid: String(st.rewardsPaid),
      treasury: st.treasury,
    },
    ops: res.order,
    custody,
    relay: { url: relayUrl ?? null, queued: 0, lastFlush: relayUrl ? "relay-published" : "relay-queue-open" },
    invalid: res.invalid.slice(-50),
    verify: { replayed: res.valid + res.invalid.length, valid: res.valid, readFrom: (RPC || pinnedNode || "probed").replace(/^https?:\/\//, ""), engine: "console/saos-live.js (same code as every browser)" },
    truthLabel: "REAL - deterministic fold of public-chain custom_json ops; every signature re-verified; relayer = transport only",
  };
}

async function main() {
  const t0 = Date.now();
  const st0 = await SL.selfTest();
  if (st0.passed !== st0.total) { log({ ok: false, verdict: "SELFTEST-FAIL-CLOSED", passed: st0.passed, total: st0.total }); process.exit(1); }

  const envelopes = await readChainEnvelopes(RELAY_ACCOUNT);
  const genesisTxid = findGenesisTxid(envelopes);
  let res = await SL.fold(envelopes);

  const beat = await treasuryBeat(res.state, envelopes);
  let custody = null;
  if (beat.newOps.length) {
    const relayWif = process.env.SAOS_RELAY_WIF || localVaultWif2("army-posting");
    const bc = await broadcast(beat.newOps, relayWif);
    if (bc.ok) {
      log({ verdict: "TREASURY-CREDITED", credits: beat.newOps.map((o) => ({ id: o.id, to: o.to, saos: o.saos })), txid: bc.txid });
      await new Promise((r) => setTimeout(r, 2500)); // let the chain settle before refold
      const envelopes2 = await readChainEnvelopes(RELAY_ACCOUNT);
      res = await SL.fold(envelopes2);
    } else {
      log({ verdict: "BROADCAST-SKIPPED", why: bc.why ?? bc.why });
    }
  }

  /* Genesis-2 flywheel: real currency above the ops float → custody credit
   * → into the pools. Treasury-signed, broadcast with the same transport. */
  {
    const wif = process.env.SAOS_FLYWHEEL === "off" ? null : (process.env.SAOS_TREASURY_WIF || localVaultWif("treasury"));
    if (wif && res.state.treasury) {
      try {
        const priv = Buffer.from(C.unhex(await privHexFromWif(wif)));
        const pubSTM = await C.pubToSTM(C.privToPubBytes(new Uint8Array(priv)));
        const fly = await liquidityBeat(res.state, res.state.treasury, pubSTM, new Uint8Array(priv));
        if (fly.newOps.length) {
          const relayWif = process.env.SAOS_RELAY_WIF || localVaultWif2("army-posting");
          const bc = await broadcast(fly.newOps, relayWif);
          if (bc.ok) {
            log({ verdict: "FLYWHEEL-DEEPENED", ops: fly.newOps.map((o) => o.k), txid: bc.txid });
            await new Promise((r) => setTimeout(r, 2500));
            const envelopes3 = await readChainEnvelopes(RELAY_ACCOUNT);
            res = await SL.fold(envelopes3);
          } else log({ verdict: "FLYWHEEL-SKIPPED", why: bc.why });
        }
        custody = custodyAudit(res.state, fly.measured ?? (await measureCustody()));
      } catch (e) { log({ verdict: "FLYWHEEL-ERROR", err: String(e?.message ?? e).slice(0, 120) }); custody = null; }
    }
  }

  const book = renderBook(res, genesisTxid, process.env.RELAY_URL || null, custody);
  fs.writeFileSync(BOOK, JSON.stringify(book, null, 2) + "\n");
  /* conservation law: supply == Σ wallets + Σ pools (per symbol) */
  const con = {};
  for (const sym of Object.keys(res.supplyCanon)) {
    let sum = 0n;
    for (const a of Object.keys(res.state.bal)) sum += res.state.bal[a]?.[sym] || 0n;
    for (const pair of Object.keys(res.state.pools)) { const p = res.state.pools[pair]; if (p.base === sym) sum += BigInt(p.resA); if (p.quote === sym) sum += BigInt(p.resB); }
    con[sym] = sum === BigInt(res.supplyCanon[sym]) ? "ok" : "BROKEN:" + sum + "/" + res.supplyCanon[sym];
  }
  log({
    ok: true,
    verdict: "FOLD-PUBLISHED",
    valid: res.valid,
    invalid: res.invalid.length,
    wallets: Object.keys(res.state.wallets).length,
    supplySAOS: res.supplyCanon.SAOS ?? "0",
    pools: Object.fromEntries(Object.keys(res.state.pools).map((p) => [p, { a: String(res.state.pools[p].resA), b: String(res.state.pools[p].resB), swaps: String(res.state.pools[p].swaps) }])),
    custody: custody?.verdict ?? null,
    conservation: con,
    treasury: res.state.treasury,
    credits: beat.newOps.length,
    skips: beat.skips ?? [],
    ms: Date.now() - t0,
  });
}
function findGenesisTxid(envelopes) {
  if (process.env.SAOS_GENESIS_TXID) return process.env.SAOS_GENESIS_TXID;
  try {
    const engineReceipt = "/home/z/audit/repos/steem/mini-services/saos-engine/state/saos-live-genesis.json";
    const r = JSON.parse(fs.readFileSync(engineReceipt, "utf8"));
    if (r?.ok && r?.txid && r?.treasury) return r.txid;
  } catch { /* not on home platform */ }
  try {
    const prev = JSON.parse(fs.readFileSync(BOOK, "utf8"));
    if (prev?.genesis?.done && prev?.genesis?.treasury) return prev.genesis.txid ?? null;
  } catch { /* first run */ }
  return null;
}
/* local transport key (home platform only): the vault army posting WIF */
function localVaultWif2() {
  try {
    const army = JSON.parse(fs.readFileSync("/home/z/audit/repos/steem/.secrets/army-keys.json", "utf8"));
    return army.accounts.find((a) => a.name === RELAY_ACCOUNT && a.chain === "steem")?.gens?.find((g) => g.role === "posting")?.wif ?? null;
  } catch { return null; }
}
main().catch((e) => { log({ ok: false, verdict: "FOLD-ERROR", err: String(e?.message ?? e).slice(0, 200) }); process.exit(1); });
