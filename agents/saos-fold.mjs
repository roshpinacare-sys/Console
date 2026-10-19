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
const RPC = process.env.SAOS_RPC || "https://api.steemit.com";
const RELAY_ACCOUNT = process.env.SAOS_RELAY_ACCOUNT || "headcorner";
const BOOK = path.join(ROOT, "saos-live.json");
const GENESIS_NOTE = "initial mint mirrors SAOS-NET v0 verified supply 1:1 (126,682 SAOS, issuer acct-40, genesis 2026-09-05)";
const MAX_HISTORY = 50000;
const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));

const rpc = async (method, params) => {
  const r = await fetch(RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }) });
  const j = await r.json();
  if (j?.error) throw new Error("rpc:" + String(j.error?.message ?? "err").slice(0, 100));
  return j?.result;
};

/* ── chain reading: every SAOS custom_json the relayer account published.
 * Deterministic law: the envelope list is ALWAYS in chain order (sorted by
 * the account-history index) — same ops in, same stateRoot out. ── */
async function readChainEnvelopes(account) {
  const picked = []; // [idx, envelope]
  let from = -1;
  let seenSaos = false;
  for (let page = 0; page < 60; page++) {
    const hist = await rpc("condenser_api.get_account_history", [account, from, 100]);
    if (!hist?.length) break;
    const oldest = hist[0][0];
    let pageSaosAtOldestHalf = false;
    for (const [idx, ev] of hist) {
      const op = ev?.op;
      if (op && op[0] === "custom_json" && op[1]?.id === SL.OP_ID) {
        seenSaos = true;
        if (idx <= oldest + 50) pageSaosAtOldestHalf = true;
        try {
          const j = JSON.parse(op[1].json);
          if (Array.isArray(j)) j.forEach((e) => picked.push([idx, e]));
          else picked.push([idx, j]);
        } catch { picked.push([idx, { _bad: "unparseable" }]); }
      }
    }
    if (oldest <= 0) break;
    // complete when SAOS ops were seen and nothing SAOS-ish sits at the old edge
    if (seenSaos && !pageSaosAtOldestHalf) break;
    from = oldest - 1;
  }
  picked.sort((a, b) => a[0] - b[0]);
  return picked.map(([, e]) => e);
}

/* ── treasury beat: deterministic credit math, integer BigInt, fail-honest ── */
const SCALE = 100000000n; // 1e8 sub-units for external decimal strings
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
async function treasuryBeat(state) {
  const wif = process.env.SAOS_TREASURY_WIF || localVaultWif("treasury");
  if (!wif) return { newOps: [], note: "no-treasury-key (fold-only mode)" };
  const priv = Buffer.from(C.unhex(await privHexFromWif(wif)));
  const pubSTM = await C.pubToSTM(C.privToPubBytes(new Uint8Array(priv)));
  const by = await SL.addressFromPubSTM(pubSTM);
  if (state.treasury && by !== state.treasury) return { newOps: [], note: "treasury-key-mismatch (fail-closed)" };
  const newOps = [];
  const skips = [];
  for (const id of Object.keys(state.claims).sort()) {
    const cl = state.claims[id];
    if (cl.status !== "pending") continue;
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
  const r = await rpc("condenser_api.broadcast_transaction_synchronous", [tx]);
  return { ok: true, txid: r?.id ?? null, ops: ops.length };
}

/* ── the published book: exactly the shape wallet.html reads ── */
function renderBook(res, genesisTxid, relayUrl) {
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
      rewardsPaid: String(st.rewardsPaid),
      treasury: st.treasury,
    },
    ops: res.order,
    relay: { url: relayUrl ?? null, queued: 0, lastFlush: relayUrl ? "relay-published" : "relay-queue-open" },
    invalid: res.invalid.slice(-50),
    verify: { replayed: res.valid + res.invalid.length, valid: res.valid, readFrom: new URL(RPC).host, engine: "console/saos-live.js (same code as every browser)" },
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

  const beat = await treasuryBeat(res.state);
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

  const book = renderBook(res, genesisTxid, process.env.RELAY_URL || null);
  fs.writeFileSync(BOOK, JSON.stringify(book, null, 2) + "\n");
  log({
    ok: true,
    verdict: "FOLD-PUBLISHED",
    valid: res.valid,
    invalid: res.invalid.length,
    wallets: Object.keys(res.state.wallets).length,
    supplySAOS: res.supplyCanon.SAOS ?? "0",
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
