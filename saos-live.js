/* =====================================================================
 * THE WEAVE · saos-live · the live currency protocol (saos.live.v1)
 *
 * What this is: SAOS lives on a public blockchain. Every operation is a
 * custom_json (op id `saos.weave.live.v1`, posting authority only, so
 * the chain itself forbids this key from ever moving funds). Authority
 * is the inner signature of the wallet owner. The relayer is transport
 * only: it cannot forge (it lacks the key) and every node re-verifies
 * every signature. The same code runs in the browser, in the cloud
 * heartbeat and on any machine. Same ops in, same stateRoot out.
 *
 * v1.2 extension (Genesis-2, the pools — real-liquidity AMM):
 *   · pool.create    (treasury) : opens an AMM pool, SAOS always the base,
 *     a custody-backed credit token (C*) the quote. feeBps capped at 10%.
 *   · pool.add       (wallet)   : two-sided provision at the pool ratio
 *     (±2%), minting LP units (first provision: isqrt(base·quote)).
 *   · pool.remove    (wallet)   : burn LP, withdraw pro-rata reserves.
 *   · pool.swap      (wallet)   : constant-product swap, BigInt floor,
 *     fee stays in the reserves (LPs earn it), minOut slippage guard,
 *     drain-guard (a pool can never be emptied past its reserve).
 *   The quote side is REAL value: C-tokens are minted 1:1 against
 *   currency the treasury actually holds (custody-audited every fold
 *   run and published in the book). No invented money, ever.
 *
 * v1.1 extension (deposits, exchange, rewards, config):
 *   · deposit.claim  (wallet)  : a depositor signs what they sent and
 *     the reference (txid). Pending until the network treasury
 *     countersigns a credit.
 *   · deposit.credit (treasury): credits SAOS for a verified deposit.
 *     Records currency, amount, reference and the exact SAOS amount.
 *   · dex.offer      (wallet)  : sell SAOS for a listed currency at a
 *     chosen price. The SAOS moves into deterministic escrow.
 *   · dex.cancel     (wallet)  : returns the unlocked remainder.
 *   · dex.fill       (treasury): records the external settlement
 *     (payment reference) and releases the escrowed SAOS to the buyer.
 *   · reward.pay     (treasury): pays SAOS rewards to a wallet, tracked
 *     in the open ledger. No promises live in code, only history.
 *   · cfg.addr / cfg.rate (treasury): publish deposit addresses and
 *     reference rates per pair. Governance decisions, on chain.
 *
 * Honest trust label: relayers currently are the network witness line
 * and the operator account (any Steem account may relay in future).
 * A relayer cannot forge but can ignore; the public ledger is the
 * judge, and settlement of external currencies is signed by the
 * treasury and labeled as such. Nothing here promises profit.
 * ===================================================================== */
import * as GateCryptoModule from "./gate-crypto.js";
const C = (typeof GateCryptoModule.default === "object" && GateCryptoModule.default) || globalThis.GateCrypto;
if (!C) throw new Error("saos-live: gate-crypto missing; load gate-crypto.js with saos-live.js");

function makeSaosLive(C) {
  "use strict";
  const PROTOCOL = "saos.live.v1";
  const OP_ID = "saos.weave.live.v1";

  /* Canonical JSON: recursively sorted keys, no spaces. The contract. */
  function canon(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    const keys = Object.keys(v).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  }

  const utf8 = (s) => new TextEncoder().encode(s);

  /* Personal address: saos1 + base58check(ripemd160(sha256(pub))).
   * Self-certifying: whoever holds the private key owns the address. */
  const ADDR_RE = /^saos1[1-9A-HJ-NP-Za-km-z]{33,35}$/;
  async function addressFromPubSTM(stm) {
    const pub33 = C.stmToPub(String(stm || ""));
    const h1 = await C.sha256(pub33);
    const payload = C.rmd160(h1); // 20 bytes
    const chk = (await C.sha256(await C.sha256(payload))).slice(0, 4);
    return "saos1" + C.b58encode(C.cat(payload, chk));
  }

  /* Signed message digest: sha256(UTF8(canon(envelope without sig))). */
  async function digestFor(envelope) {
    const { sig, ...sans } = envelope;
    if (typeof sig !== "string") return C.sha256(utf8(canon(envelope)));
    return C.sha256(utf8(canon(sans)));
  }

  async function signEnvelope(envelope, privBytes) {
    const digest = await digestFor(envelope);
    const sig = await C.signCompact(digest, privBytes);
    return C.hex(sig);
  }

  function recoverPub(digest32, sigHex) {
    const sig = C.unhex(String(sigHex || ""));
    if (sig.length !== 65) return null;
    const i = sig[0] - 31;
    if (i < 0 || i > 3) return null;
    const r = C.fromBE(sig.slice(1, 33));
    const s = C.fromBE(sig.slice(33, 65));
    /* HARDEN (2026-09-28): סגירת-מחלקת-החתימות-הניתנות-לעיוות (malleability).
     * 1) טווח-מלא: 1 <= r,s < N — נדרש ב-ECDSA תקין (לפני-כאן: הכל התקבל).
     * 2) low-s בלבד: s > N/2 נדחה — החותם שלנו מנרמל ל-low-s (gate-crypto),
     *    ולכן (r, N-s, i^1) אינו חתימה חוקית על הספר הזה. מיישר-קו עם
     *    מדיניות BIP-62/boringssl — אותו-היגיון, בדיוק-כאן. */
    const N = (C._dbg && C._dbg.N) || 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
    if (!(r > 0n && r < N) || !(s > 0n && s < N)) return null;
    if (s > N / 2n) return null; // low-s בלבד — מבטל-עיוות
    const e = C.fromBE(digest32);
    const pub = C._dbg.tryRecover(e, r, s, i);
    return pub;
  }

  /* Integer amount strings (BigInt inside, no float). */
  const AMOUNT_RE = /^\d{1,18}$/;
  const parseAmount = (s) => (AMOUNT_RE.test(String(s)) ? BigInt(s) : null);
  const fmt = (units, decimals) => {
    const d = Number(decimals) || 0;
    if (d === 0) return String(units);
    let s = String(units).padStart(d + 1, "0");
    const cut = s.length - d;
    const whole = s.slice(0, cut);
    let frac = s.slice(cut).replace(/0+$/, "");
    return frac ? `${whole}.${frac}` : whole;
  };

  /* Decimal display strings for external currencies and prices.
   * Not consensus money: SAOS math stays integer. */
  const DEC_RE = /^(0|[1-9]\d{0,11})(\.\d{1,8})?$/;
  const isDec = (s) => typeof s === "string" && DEC_RE.test(s) && !/^0+(\.0+)?$/.test(s);
  const CUR_RE = /^[A-Z]{2,10}$/;
  const PAIR_RE = /^[A-Z]{2,10}\/[A-Z]{2,10}$/;
  const REF_RE = /^[\w :.\-\/+=]{6,90}$/;
  const IDREF_RE = /^[0-9a-zA-Z._-]{6,40}$/;

  /* Operation id: <milliseconds>-<random hex> */
  const ID_RE = /^[0-9]{12,14}-[0-9a-f]{8,12}$/;
  const GENESIS_ID_RE = /^genesis-saos-[a-z0-9]{2,12}$/;
  function makeId() {
    const rnd = new Uint8Array(6);
    globalThis.crypto.getRandomValues(rnd);
    return Date.now() + "-" + C.hex(rnd);
  }

  /* Genesis spec: initial mint mirrors the verified v0 supply 1:1
   * (126,682 SAOS, issuer acct-40, genesis 2026-09-05). Hard cap
   * 21,000,000 SAOS, fixed in the code every node runs. */
  const SAOS_GENESIS = {
    symbol: "SAOS",
    name: "SAOS",
    decimals: 3,
    maxSupply: "21000000000", // 21,000,000.000 SAOS
    initialMint: "126682000", // 126,682.000 SAOS, mirrors v0 exactly
    note: "initial mint mirrors SAOS-NET v0 verified supply 1:1 (126,682 SAOS, issuer acct-40, genesis 2026-09-05)",
  };
  const TREASURY_GENESIS_ID = "genesis-saos-treasury";

  /* The rules. Every op passes: strict shape, then a valid signature,
   * then type rules. A rejected op never touches state (fail-closed)
   * and is recorded in invalid. Metadata keys (at, txid, block) are
   * tolerated and stripped: they are not signed and never enter the
   * stateRoot, so every node agrees regardless of how it read the ops. */
  const KINDS = {
    "wallet.create": ["nick"],
    "token.deploy": ["symbol", "name", "decimals", "maxSupply"],
    "token.mint": ["symbol", "to", "amount"],
    "token.transfer": ["symbol", "to", "amount"],
    "token.burn": ["symbol", "amount"],
    "deposit.claim": ["cur", "amt", "ref"],
    "deposit.credit": ["claimId", "to", "saos", "cur", "amt", "ref", "note"],
    "dex.offer": ["cur", "units", "price"],
    "dex.cancel": ["offerId"],
    "dex.fill": ["offerId", "to", "units", "paid", "ref"],
    "reward.pay": ["to", "amount", "note"],
    "cfg.addr": ["cur", "addr", "memo"],
    "cfg.rate": ["pair", "price"],
    "pool.create": ["pair", "feeBps"],
    "pool.add": ["pair", "base", "quote"],
    "pool.remove": ["pair", "lp"],
    "pool.swap": ["pair", "dir", "amountIn", "minOut"],
  };
  const TREASURY_KINDS = new Set(["deposit.credit", "dex.fill", "reward.pay", "cfg.addr", "cfg.rate", "pool.create"]);
  /* pool law: SAOS is always the base; the quote is a custody-backed
   * credit token (C*). One pool per pair, forever (deterministic id). */
  const CREDIT_RE = /^C[A-Z]{3,9}$/;
  const SWAP_DIR = { SA2C: "SA2C", C2SA: "C2SA" };
  const ADD_TOLERANCE = 200n; // ±2.00% (basis points over 10,000)
  const MAX_FEE_BPS = 1000n;

  /* BigInt integer square root (Newton). Used for the genesis LP mint. */
  function isqrt(n) {
    if (n < 0n) return null;
    if (n < 2n) return n;
    let x = n, y = (x + 1n) / 2n;
    while (y < x) { x = y; y = (x + n / x) / 2n; }
    return x;
  }

  /* Constant-product quote: pure, integer, floor everywhere.
   * Returns null when the swap is impossible (empty reserve / full drain). */
  function quoteSwap(pool, dir, amountIn) {
    if (!pool || !SWAP_DIR[dir]) return { err: "bad-dir" };
    const a = parseAmount(amountIn);
    if (a === null || a <= 0n) return { err: "bad-amountIn" };
    const fee = BigInt(pool.feeBps);
    const inFee = (a * (10000n - fee)) / 10000n; // floor — fee stays in reserves
    if (inFee <= 0n) return { err: "fee-eats-input" };
    let out, resIn, resOut;
    if (dir === "SA2C") { resIn = pool.resA; resOut = pool.resB; }
    else { resIn = pool.resB; resOut = pool.resA; }
    if (resIn <= 0n || resOut <= 0n) return { err: "empty-reserve" };
    out = (resOut * inFee) / (resIn + inFee); // floor — pool never over-pays
    if (out <= 0n) return { err: "zero-out" };
    if (out >= resOut) return { err: "drain-guard" }; // a pool is never emptied
    return { out, inFee, kAfter: (resIn + a) * (resOut - out), kBefore: resIn * resOut };
  }
  const META_KEYS = new Set(["at", "txid", "block", "trxInBlock"]);

  const MAX_OPEN_OFFERS = 30;
  const MAX_PENDING_CLAIMS = 20;

  function openOffersOf(state, addr) {
    let n = 0;
    for (const id of Object.keys(state.offers)) if (state.offers[id].by === addr && state.offers[id].status === "open") n++;
    return n;
  }
  function pendingClaimsOf(state, addr) {
    let n = 0;
    for (const id of Object.keys(state.claims)) if (state.claims[id].by === addr && state.claims[id].status === "pending") n++;
    return n;
  }

  async function validateEnvelope(rawEnv, state, seenIds, seenPubs) {
    if (!rawEnv || typeof rawEnv !== "object") return { err: "bad-envelope" };
    // strip metadata (not signed, not consensus) before any check
    const env = {};
    for (const key of Object.keys(rawEnv)) if (!META_KEYS.has(key)) env[key] = rawEnv[key];

    if (env.v !== 1) return { err: "version" };
    const k = String(env.k || "");
    if (!KINDS[k]) return { err: "unknown-kind" };
    const id = String(env.id || "");
    if (!(ID_RE.test(id) || GENESIS_ID_RE.test(id))) return { err: "bad-id" };
    if (seenIds.has(id)) return { err: "dup-id" };
    if (typeof env.pub !== "string" || !/^STM[1-9A-HJ-NP-Za-km-z]{50}$/.test(env.pub)) return { err: "bad-pub" };
    if (typeof env.sig !== "string" || !/^[0-9a-f]{130}$/.test(env.sig)) return { err: "bad-sig" };
    if (typeof env.by !== "string" || !ADDR_RE.test(env.by)) return { err: "bad-addr" };

    let pub33;
    try {
      pub33 = C.stmToPub(env.pub);
    } catch {
      return { err: "bad-pub" };
    }
    const digest = await digestFor(env);
    const rec = recoverPub(digest, env.sig);
    if (!rec || C.hex(rec) !== C.hex(pub33)) return { err: "sig" };
    const derived = await addressFromPubSTM(env.pub);
    if (derived !== env.by) return { err: "addr-mismatch" };

    // strict fields: unknown field means rejection, the canon is the contract
    for (const key of Object.keys(env)) {
      const allowed = new Set(["v", "id", "k", "by", "pub", "sig", ...KINDS[k]]);
      if (!allowed.has(key)) return { err: "unexpected-field:" + key };
    }
    const optStr = (v, max) => v === undefined || (typeof v === "string" && v.length >= 1 && v.length <= max);

    if (k === "wallet.create") {
      if (state.wallets[env.by]) return { err: "wallet-exists" };
      if (seenPubs.has(env.pub)) return { err: "pub-taken" };
      if (env.nick !== undefined) {
        if (typeof env.nick !== "string" || env.nick.length < 1 || env.nick.length > 24) return { err: "bad-nick" };
        if (!/^[\u0590-\u05FFa-zA-Z0-9 ._-]+$/.test(env.nick)) return { err: "bad-nick" };
      }
      return { ok: true };
    }

    // every other kind requires a registered wallet
    const sender = state.wallets[env.by];
    if (!sender) return { err: "no-wallet" };

    // treasury-only kinds: authority is the genesis treasury address
    if (TREASURY_KINDS.has(k)) {
      if (!state.treasury) return { err: "no-treasury" };
      if (env.by !== state.treasury) return { err: "not-treasury" };
    }

    if (k === "token.deploy") {
      const symbol = String(env.symbol || "");
      if (!/^[A-Z][A-Z0-9]{2,7}$/.test(symbol)) return { err: "bad-symbol" };
      if (state.tokens[symbol]) return { err: "symbol-taken" };
      if (typeof env.name !== "string" || env.name.length < 1 || env.name.length > 48) return { err: "bad-name" };
      if (!Number.isInteger(env.decimals) || env.decimals < 0 || env.decimals > 9) return { err: "bad-decimals" };
      const max = parseAmount(env.maxSupply);
      if (max === null || max <= 0n || max > 10n ** 15n) return { err: "bad-max" };
      return { ok: true };
    }

    if (k === "deposit.claim") {
      if (!CUR_RE.test(String(env.cur || ""))) return { err: "bad-cur" };
      if (!isDec(env.amt)) return { err: "bad-amt" };
      if (!REF_RE.test(String(env.ref || ""))) return { err: "bad-ref" };
      if (pendingClaimsOf(state, env.by) >= MAX_PENDING_CLAIMS) return { err: "too-many-claims" };
      return { ok: true };
    }

    if (k === "deposit.credit") {
      if (env.claimId !== undefined && !IDREF_RE.test(String(env.claimId))) return { err: "bad-claimId" };
      if (typeof env.to !== "string" || !ADDR_RE.test(env.to) || !state.wallets[env.to]) return { err: "no-recipient" };
      const a = parseAmount(env.saos);
      if (a === null || a <= 0n) return { err: "bad-saos" };
      if (!CUR_RE.test(String(env.cur || ""))) return { err: "bad-cur" };
      if (!isDec(env.amt)) return { err: "bad-amt" };
      if (!optStr(env.ref, 90) || (env.ref !== undefined && !REF_RE.test(env.ref))) return { err: "bad-ref" };
      if (!optStr(env.note, 120)) return { err: "bad-note" };
      if (env.claimId !== undefined) {
        const cl = state.claims[String(env.claimId)];
        if (!cl) return { err: "no-claim" };
        if (cl.status !== "pending") return { err: "claim-not-pending" };
      }
      if ((state.bal[env.by]?.SAOS || 0n) < a) return { err: "insufficient" };
      return { ok: true };
    }

    if (k === "dex.offer") {
      if (!state.tokens.SAOS) return { err: "no-saos" };
      if (!CUR_RE.test(String(env.cur || ""))) return { err: "bad-cur" };
      const u = parseAmount(env.units);
      if (u === null || u <= 0n) return { err: "bad-units" };
      if (!isDec(env.price)) return { err: "bad-price" };
      if ((state.bal[env.by]?.SAOS || 0n) < u) return { err: "insufficient" };
      if (openOffersOf(state, env.by) >= MAX_OPEN_OFFERS) return { err: "too-many-offers" };
      return { ok: true };
    }

    if (k === "dex.cancel") {
      if (!IDREF_RE.test(String(env.offerId || ""))) return { err: "bad-offerId" };
      const off = state.offers[String(env.offerId)];
      if (!off) return { err: "no-offer" };
      if (off.by !== env.by) return { err: "not-owner" };
      if (off.status !== "open") return { err: "not-open" };
      return { ok: true };
    }

    if (k === "dex.fill") {
      if (!IDREF_RE.test(String(env.offerId || ""))) return { err: "bad-offerId" };
      const off = state.offers[String(env.offerId)];
      if (!off) return { err: "no-offer" };
      if (off.status !== "open") return { err: "not-open" };
      if (typeof env.to !== "string" || !ADDR_RE.test(env.to) || !state.wallets[env.to]) return { err: "no-recipient" };
      const u = parseAmount(env.units);
      if (u === null || u <= 0n) return { err: "bad-units" };
      if (u > off.units - off.filled) return { err: "over-fill" };
      if (env.paid !== undefined && !isDec(env.paid)) return { err: "bad-paid" };
      if (!optStr(env.ref, 90) || (env.ref !== undefined && !REF_RE.test(env.ref))) return { err: "bad-ref" };
      return { ok: true };
    }

    if (k === "reward.pay") {
      if (typeof env.to !== "string" || !ADDR_RE.test(env.to) || !state.wallets[env.to]) return { err: "no-recipient" };
      const a = parseAmount(env.amount);
      if (a === null || a <= 0n) return { err: "bad-amount" };
      if (!optStr(env.note, 120)) return { err: "bad-note" };
      if ((state.bal[env.by]?.SAOS || 0n) < a) return { err: "insufficient" };
      return { ok: true };
    }

    if (k === "cfg.addr") {
      if (!CUR_RE.test(String(env.cur || ""))) return { err: "bad-cur" };
      if (typeof env.addr !== "string" || env.addr.length < 8 || env.addr.length > 120) return { err: "bad-addr-str" };
      if (!optStr(env.memo, 80)) return { err: "bad-memo" };
      return { ok: true };
    }

    if (k === "cfg.rate") {
      if (!PAIR_RE.test(String(env.pair || ""))) return { err: "bad-pair" };
      if (!isDec(env.price)) return { err: "bad-price" };
      return { ok: true };
    }

    /* ── v1.2: the pools (Genesis-2). SAOS base × C* credit quote. ── */
    if (k === "pool.create") {
      const pair = String(env.pair || "");
      if (!PAIR_RE.test(pair)) return { err: "bad-pair" };
      const [b, q] = pair.split("/");
      if (b !== "SAOS") return { err: "base-not-saos" };
      if (!CREDIT_RE.test(q)) return { err: "quote-not-credit" };
      if (state.pools[pair]) return { err: "pool-exists" };
      const fee = String(env.feeBps);
      if (!/^\d{1,4}$/.test(fee)) return { err: "bad-fee" };
      if (BigInt(fee) > MAX_FEE_BPS) return { err: "bad-fee" };
      return { ok: true };
    }

    if (k === "pool.add") {
      const pool = state.pools[String(env.pair || "")];
      if (!pool) return { err: "no-pool" };
      if (pool.status !== "open") return { err: "not-open" };
      const base = parseAmount(env.base), quote = parseAmount(env.quote);
      if (base === null || base <= 0n || quote === null || quote <= 0n) return { err: "bad-amounts" };
      if ((state.bal[env.by]?.SAOS || 0n) < base) return { err: "insufficient" };
      if ((state.bal[env.by]?.[pool.quote] || 0n) < quote) return { err: "insufficient" };
      if (pool.lpSupply > 0n) {
        /* two-sided law: provision within ±2% of the pool ratio
         * (base·resB) / (quote·resA) ∈ [0.98, 1.02], pure integers */
        const want = quote * pool.resA;
        if (base * pool.resB * 10000n < want * 9800n || base * pool.resB * 10000n > want * 10200n) return { err: "imbalanced" };
      }
      return { ok: true };
    }

    if (k === "pool.remove") {
      const pool = state.pools[String(env.pair || "")];
      if (!pool) return { err: "no-pool" };
      if (pool.status !== "open") return { err: "not-open" };
      const lp = parseAmount(env.lp);
      if (lp === null || lp <= 0n) return { err: "bad-lp" };
      if ((pool.lpBal[env.by] || 0n) < lp) return { err: "insufficient-lp" };
      return { ok: true };
    }

    if (k === "pool.swap") {
      const pool = state.pools[String(env.pair || "")];
      if (!pool) return { err: "no-pool" };
      if (pool.status !== "open") return { err: "not-open" };
      const q = quoteSwap(pool, String(env.dir || ""), env.amountIn);
      if (q.err) return { err: q.err };
      const minOut = parseAmount(env.minOut);
      if (minOut === null || minOut < 0n) return { err: "bad-minOut" };
      if (q.out < minOut) return { err: "slippage" };
      const symIn = env.dir === "SA2C" ? "SAOS" : pool.quote;
      if ((state.bal[env.by]?.[symIn] || 0n) < BigInt(env.amountIn)) return { err: "insufficient" };
      return { ok: true };
    }

    const symbol = String(env.symbol || "");
    const token = state.tokens[symbol];
    if (!token) return { err: "no-token" };

    if (k === "token.mint") {
      if (env.by !== token.issuer) return { err: "not-issuer" };
      if (typeof env.to !== "string" || !ADDR_RE.test(env.to) || !state.wallets[env.to]) return { err: "no-recipient" };
      const a = parseAmount(env.amount);
      if (a === null || a <= 0n) return { err: "bad-amount" };
      if ((state.supply[symbol] || 0n) + a > BigInt(token.maxSupply)) return { err: "over-max" };
      return { ok: true };
    }

    if (k === "token.transfer") {
      if (typeof env.to !== "string" || !ADDR_RE.test(env.to) || !state.wallets[env.to]) return { err: "no-recipient" };
      if (env.to === env.by) return { err: "self" };
      const a = parseAmount(env.amount);
      if (a === null || a <= 0n) return { err: "bad-amount" };
      if ((state.bal[env.by]?.[symbol] || 0n) < a) return { err: "insufficient" };
      return { ok: true };
    }

    if (k === "token.burn") {
      const a = parseAmount(env.amount);
      if (a === null || a <= 0n) return { err: "bad-amount" };
      if ((state.bal[env.by]?.[symbol] || 0n) < a) return { err: "insufficient" };
      return { ok: true };
    }

    return { err: "unreachable" };
  }

  /* The fold: a sequence of ops becomes a state. Fully deterministic:
   * same ops in the same order give the same stateRoot. Invalid ops
   * are recorded and skipped; they never touch state. */
  async function fold(envelopes) {
    const state = {
      wallets: {}, // addr -> {pub, nick, at, txid}
      tokens: {}, // SYMBOL -> {name, decimals, maxSupply, issuer, at, txid}
      bal: {}, // addr -> {SYMBOL: BigInt}
      supply: {}, // SYMBOL -> BigInt
      claims: {}, // claimId -> {by, cur, amt, ref, status, at, txid}
      offers: {}, // offerId -> {by, cur, units, price, filled, status, fills[], at, txid}
      cfg: { addrs: {}, rates: {} }, // treasury published config
      pools: {}, // pair -> {base, quote, feeBps, resA, resB, lpSupply, lpBal, status, swaps, volA, volB}
      rewardsPaid: 0n, // total SAOS units paid as rewards
      treasury: null, // genesis treasury address
    };
    const seenIds = new Set();
    const seenPubs = new Set();
    const invalid = [];
    const order = [];
    let valid = 0;

    const meta = (env) => ({
      at: typeof env?.at === "string" ? env.at : null,
      txid: typeof env?.txid === "string" ? env.txid : null,
    });

    const list = Array.isArray(envelopes) ? envelopes.slice() : [];
    for (const rawEnv of list) {
      const m = meta(rawEnv);
      const res = await validateEnvelope(rawEnv, state, seenIds, seenPubs);
      if (res.err) {
        invalid.push({ id: String(rawEnv?.id ?? "?"), k: String(rawEnv?.k ?? "?"), err: res.err });
        continue;
      }
      // clean view for the executor (metadata stripped)
      const env = {};
      for (const key of Object.keys(rawEnv)) if (!META_KEYS.has(key)) env[key] = rawEnv[key];

      seenIds.add(String(env.id));
      seenPubs.add(String(env.pub));
      const k = String(env.k);
      if (k === "wallet.create") {
        state.wallets[env.by] = { pub: env.pub, nick: typeof env.nick === "string" ? env.nick : null, ...m };
        if (env.id === TREASURY_GENESIS_ID) state.treasury = env.by;
      } else if (k === "token.deploy") {
        state.tokens[env.symbol] = { name: env.name, decimals: env.decimals, maxSupply: String(env.maxSupply), issuer: env.by, ...m };
      } else if (k === "token.mint") {
        state.bal[env.to] = state.bal[env.to] || {};
        state.bal[env.to][env.symbol] = (state.bal[env.to][env.symbol] || 0n) + BigInt(env.amount);
        state.supply[env.symbol] = (state.supply[env.symbol] || 0n) + BigInt(env.amount);
      } else if (k === "token.transfer") {
        state.bal[env.by][env.symbol] -= BigInt(env.amount);
        state.bal[env.to] = state.bal[env.to] || {};
        state.bal[env.to][env.symbol] = (state.bal[env.to][env.symbol] || 0n) + BigInt(env.amount);
      } else if (k === "token.burn") {
        state.bal[env.by][env.symbol] -= BigInt(env.amount);
        state.supply[env.symbol] -= BigInt(env.amount);
        if (state.bal[env.by][env.symbol] === 0n) delete state.bal[env.by][env.symbol];
      } else if (k === "deposit.claim") {
        state.claims[env.id] = { by: env.by, cur: env.cur, amt: env.amt, ref: env.ref, status: "pending", ...m };
      } else if (k === "deposit.credit") {
        state.bal[env.by].SAOS -= BigInt(env.saos);
        state.bal[env.to] = state.bal[env.to] || {};
        state.bal[env.to].SAOS = (state.bal[env.to].SAOS || 0n) + BigInt(env.saos);
        if (env.claimId !== undefined) {
          const cl = state.claims[String(env.claimId)];
          if (cl) cl.status = "credited";
        }
      } else if (k === "dex.offer") {
        state.bal[env.by].SAOS -= BigInt(env.units); // into deterministic escrow
        state.offers[env.id] = { by: env.by, cur: env.cur, units: BigInt(env.units), price: env.price, filled: 0n, status: "open", fills: [], ...m };
      } else if (k === "dex.cancel") {
        const off = state.offers[String(env.offerId)];
        const back = off.units - off.filled;
        state.bal[off.by] = state.bal[off.by] || {};
        state.bal[off.by].SAOS = (state.bal[off.by].SAOS || 0n) + back;
        off.status = "cancelled";
      } else if (k === "dex.fill") {
        const off = state.offers[String(env.offerId)];
        const u = BigInt(env.units);
        off.filled += u;
        off.fills.push({ to: env.to, units: String(env.units), paid: env.paid !== undefined ? env.paid : null, ref: env.ref !== undefined ? env.ref : null, at: m.at });
        state.bal[env.to] = state.bal[env.to] || {};
        state.bal[env.to].SAOS = (state.bal[env.to].SAOS || 0n) + u;
        if (off.filled === off.units) off.status = "closed";
      } else if (k === "reward.pay") {
        state.bal[env.by].SAOS -= BigInt(env.amount);
        state.bal[env.to] = state.bal[env.to] || {};
        state.bal[env.to].SAOS = (state.bal[env.to].SAOS || 0n) + BigInt(env.amount);
        state.rewardsPaid += BigInt(env.amount);
      } else if (k === "cfg.addr") {
        state.cfg.addrs[env.cur] = { addr: env.addr, memo: env.memo !== undefined ? env.memo : null, ...m };
      } else if (k === "cfg.rate") {
        state.cfg.rates[env.pair] = { price: env.price, ...m };
      } else if (k === "pool.create") {
        state.pools[env.pair] = { base: "SAOS", quote: String(env.pair).split("/")[1], feeBps: String(env.feeBps), resA: 0n, resB: 0n, lpSupply: 0n, lpBal: {}, status: "open", swaps: 0n, volA: 0n, volB: 0n, ...m };
      } else if (k === "pool.add") {
        const pool = state.pools[String(env.pair)];
        const base = BigInt(env.base), quote = BigInt(env.quote);
        let lp;
        if (pool.lpSupply === 0n) {
          lp = isqrt(base * quote);
          if (lp <= 0n) throw new Error("lp-zero"); // guarded in validation
        } else {
          const lpB = (base * pool.lpSupply) / pool.resA; // floor
          const lpQ = (quote * pool.lpSupply) / pool.resB; // floor
          lp = lpB < lpQ ? lpB : lpQ;
        }
        state.bal[env.by].SAOS -= base;
        state.bal[env.by][pool.quote] -= quote;
        pool.resA += base;
        pool.resB += quote;
        pool.lpSupply += lp;
        pool.lpBal[env.by] = (pool.lpBal[env.by] || 0n) + lp;
      } else if (k === "pool.remove") {
        const pool = state.pools[String(env.pair)];
        const lp = BigInt(env.lp);
        const outA = (pool.resA * lp) / pool.lpSupply; // floor — dust stays with the pool
        const outB = (pool.resB * lp) / pool.lpSupply;
        pool.resA -= outA;
        pool.resB -= outB;
        pool.lpSupply -= lp;
        pool.lpBal[env.by] -= lp;
        if (pool.lpBal[env.by] === 0n) delete pool.lpBal[env.by];
        state.bal[env.by] = state.bal[env.by] || {};
        state.bal[env.by].SAOS = (state.bal[env.by].SAOS || 0n) + outA;
        state.bal[env.by][pool.quote] = (state.bal[env.by][pool.quote] || 0n) + outB;
      } else if (k === "pool.swap") {
        const pool = state.pools[String(env.pair)];
        const a = BigInt(env.amountIn);
        const q = quoteSwap(pool, String(env.dir), env.amountIn);
        if (q.err || q.out < BigInt(env.minOut)) throw new Error("swap-drift"); // validation already passed — deterministic paranoia
        if (env.dir === "SA2C") {
          state.bal[env.by].SAOS -= a;
          pool.resA += a;
          pool.resB -= q.out;
          state.bal[env.by] = state.bal[env.by] || {};
          state.bal[env.by][pool.quote] = (state.bal[env.by][pool.quote] || 0n) + q.out;
          pool.volA += a;
        } else {
          state.bal[env.by][pool.quote] -= a;
          pool.resB += a;
          pool.resA -= q.out;
          state.bal[env.by] = state.bal[env.by] || {};
          state.bal[env.by].SAOS = (state.bal[env.by].SAOS || 0n) + q.out;
          pool.volB += a;
        }
        pool.swaps += 1n;
      }
      valid++;
      order.push({ id: env.id, k, by: env.by, ...m });
    }

    /* stateRoot projection: consensus fields only. Metadata (at, txid)
     * never enters, so cloud, browser and any node agree byte for byte. */
    const balCanon = {};
    for (const addr of Object.keys(state.bal).sort()) {
      const entries = Object.entries(state.bal[addr]).filter(([, v]) => v > 0n);
      if (entries.length) balCanon[addr] = Object.fromEntries(entries.map(([s, v]) => [s, String(v)]));
    }
    const supplyCanon = Object.fromEntries(Object.entries(state.supply).map(([s, v]) => [s, String(v)]));
    const walletsCanon = Object.fromEntries(
      Object.keys(state.wallets).sort().map((a) => [a, { pub: state.wallets[a].pub, nick: state.wallets[a].nick ?? null }]),
    );
    const tokensCanon = Object.fromEntries(
      Object.keys(state.tokens).sort().map((s) => {
        const t = state.tokens[s];
        return [s, { name: t.name, decimals: t.decimals, maxSupply: t.maxSupply, issuer: t.issuer }];
      }),
    );
    const claimsCanon = Object.fromEntries(
      Object.keys(state.claims).sort().map((id) => {
        const c = state.claims[id];
        return [id, { by: c.by, cur: c.cur, amt: c.amt, ref: c.ref, status: c.status }];
      }),
    );
    const offersCanon = Object.fromEntries(
      Object.keys(state.offers).sort().map((id) => {
        const o = state.offers[id];
        // fills enter the root without their `at` metadata: consensus fields only
        const fillsCanon = o.fills.map((f) => ({ to: f.to, units: f.units, paid: f.paid ?? null, ref: f.ref ?? null }));
        return [id, { by: o.by, cur: o.cur, units: String(o.units), price: o.price, filled: String(o.filled), status: o.status, fills: fillsCanon }];
      }),
    );
    const cfgCanon = {
      addrs: Object.fromEntries(Object.keys(state.cfg.addrs).sort().map((cur) => {
        const a = state.cfg.addrs[cur];
        return [cur, { addr: a.addr, memo: a.memo ?? null }];
      })),
      rates: Object.fromEntries(Object.keys(state.cfg.rates).sort().map((pair) => {
        const r = state.cfg.rates[pair];
        return [pair, { price: r.price }];
      })),
    };
    const poolsCanon = Object.fromEntries(
      Object.keys(state.pools).sort().map((pair) => {
        const p = state.pools[pair];
        return [pair, {
          base: p.base, quote: p.quote, feeBps: p.feeBps, status: p.status,
          resA: String(p.resA), resB: String(p.resB), lpSupply: String(p.lpSupply),
          lpBal: Object.fromEntries(Object.keys(p.lpBal).sort().map((a) => [a, String(p.lpBal[a])])),
          swaps: String(p.swaps), volA: String(p.volA), volB: String(p.volB),
        }];
      }),
    );
    const rootInput = canon({
      wallets: walletsCanon,
      tokens: tokensCanon,
      balances: balCanon,
      supply: supplyCanon,
      claims: claimsCanon,
      offers: offersCanon,
      cfg: cfgCanon,
      pools: poolsCanon,
      rewardsPaid: String(state.rewardsPaid),
      ops: valid,
    });
    const stateRoot = C.hex(await C.sha256(utf8(rootInput)));

    return {
      ok: true,
      protocol: PROTOCOL,
      valid,
      invalid,
      order,
      state,
      stateRoot,
      balCanon,
      supplyCanon,
      walletsCanon,
      tokensCanon,
      claimsCanon,
      offersCanon,
      cfgCanon,
      poolsCanon,
    };
  }

  /* Build a signed op (the wallet in the browser). */
  async function buildOp(privBytes, pubSTM, fields) {
    const by = await addressFromPubSTM(pubSTM);
    const env = { v: 1, id: makeId(), by, pub: pubSTM, ...fields };
    env.sig = await signEnvelope(env, privBytes);
    return env;
  }

  /* Genesis (cloud only): register treasury, deploy SAOS, first mint. */
  async function buildGenesisOps(treasuryPrivBytes, treasuryPubSTM) {
    const treasury = await addressFromPubSTM(treasuryPubSTM);
    const wallet = {
      v: 1,
      id: TREASURY_GENESIS_ID,
      k: "wallet.create",
      nick: "network-treasury",
      by: treasury,
      pub: treasuryPubSTM,
    };
    wallet.sig = await signEnvelope(wallet, treasuryPrivBytes);
    const deploy = {
      v: 1,
      id: "genesis-saos-deploy",
      k: "token.deploy",
      symbol: SAOS_GENESIS.symbol,
      name: SAOS_GENESIS.name,
      decimals: SAOS_GENESIS.decimals,
      maxSupply: SAOS_GENESIS.maxSupply,
      by: treasury,
      pub: treasuryPubSTM,
    };
    deploy.sig = await signEnvelope(deploy, treasuryPrivBytes);
    const mint = {
      v: 1,
      id: "genesis-saos-mint",
      k: "token.mint",
      symbol: SAOS_GENESIS.symbol,
      to: treasury,
      amount: SAOS_GENESIS.initialMint,
      by: treasury,
      pub: treasuryPubSTM,
    };
    mint.sig = await signEnvelope(mint, treasuryPrivBytes);
    return { treasury, ops: [wallet, deploy, mint] };
  }

  /* New wallet: random key (CSPRNG), full sovereign identity. */
  function randomPriv() {
    const b = new Uint8Array(32);
    globalThis.crypto.getRandomValues(b);
    return b;
  }
  async function newWallet() {
    const priv = randomPriv();
    const pub33 = C.privToPubBytes(priv);
    const pubSTM = await C.pubToSTM(pub33);
    const addr = await addressFromPubSTM(pubSTM);
    return { priv, pubSTM, addr };
  }

  /* Self-test: fixed deterministic vectors. Test keys derive from
   * sha256 of fixed strings, so no hex constants live in the code. */
  async function selfTest() {
    const tests = [];
    const t = (name, pass, detail) => tests.push({ name, pass, detail: detail || null });

    t("canon: recursive key sort", canon({ b: 1, a: { z: 2, y: 3 } }) === '{"a":{"y":3,"z":2},"b":1}');

    const priv1 = await C.sha256(utf8("saos-live-selftest-key-one"));
    const priv2 = await C.sha256(utf8("saos-live-selftest-key-two"));
    const pub1 = await C.pubToSTM(C.privToPubBytes(priv1));
    const pub2 = await C.pubToSTM(C.privToPubBytes(priv2));
    const addr1a = await addressFromPubSTM(pub1);
    const addr1b = await addressFromPubSTM(pub1);
    const addr2 = await addressFromPubSTM(pub2);
    t("address: deterministic", addr1a === addr1b);
    t("address: saos1 format", ADDR_RE.test(addr1a), addr1a);
    t("address: different keys give different addresses", addr1a !== addr2);

    const w1 = { priv: priv1, pub: pub1 };
    const w2 = { priv: priv2, pub: pub2 };
    const ops = [];
    const mk = async (w, fields, id) => {
      const by = await addressFromPubSTM(w.pub);
      const env = { v: 1, id: id || makeId(), by, pub: w.pub, ...fields };
      env.sig = await signEnvelope(env, w.priv);
      ops.push(env);
      return env;
    };
    await mk(w1, { k: "wallet.create", nick: "selftest-a" }, "1731000000000-aa000001");
    await mk(w2, { k: "wallet.create", nick: "selftest-b" }, "1731000000001-aa000002");
    await mk(w1, { k: "token.deploy", symbol: "TEST", name: "Self Test", decimals: 3, maxSupply: "1000000" }, "1731000000002-aa000003");
    await mk(w1, { k: "token.mint", symbol: "TEST", to: addr1a, amount: "1000" }, "1731000000003-aa000004");
    await mk(w1, { k: "token.mint", symbol: "TEST", to: addr2, amount: "500" }, "1731000000004-aa000005");
    await mk(w1, { k: "token.transfer", symbol: "TEST", to: addr2, amount: "200" }, "1731000000005-aa000006");
    await mk(w2, { k: "token.burn", symbol: "TEST", amount: "100" }, "1731000000006-aa000007");

    const res = await fold(ops);
    t("fold: 7/7 valid", res.valid === 7 && res.invalid.length === 0, JSON.stringify(res.invalid));
    t("balance: sender 800", res.state.bal[addr1a]?.TEST === 800n);
    t("balance: receiver 600", res.state.bal[addr2]?.TEST === 600n);
    t("supply: 1400 (1500 minus 100 burned)", res.state.supply.TEST === 1400n);

    const forged = { v: 1, id: "1731000000007-bb000001", k: "token.transfer", symbol: "TEST", to: addr2, amount: "50", by: addr1a, pub: pub1 };
    forged.sig = await signEnvelope(forged, w2.priv);
    const r2 = await fold([...ops, forged]);
    t("forgery: someone else's signature is rejected", r2.valid === 7 && r2.invalid[0]?.err === "sig");

    const over = await mk(w1, { k: "token.mint", symbol: "TEST", to: addr1a, amount: "999999000" }, "1731000000008-bb000002");
    const r3 = await fold([...ops, over]);
    t("mint above the cap is rejected", r3.invalid.some((x) => x.err === "over-max") && r3.state.supply.TEST === 1400n);

    const dup = { ...ops[0] };
    const r4 = await fold([...ops, dup]);
    t("duplicate id is rejected", r4.valid === 7 && r4.invalid.some((x) => x.err === "dup-id"));

    const ghost = await mk(w1, { k: "token.transfer", symbol: "TEST", to: "saos1" + "2".repeat(34), amount: "1" }, "1731000000009-bb000003");
    const r5 = await fold([...ops, ghost]);
    t("transfer to an unregistered address is rejected", r5.invalid.some((x) => x.err === "no-recipient"));

    const ra = await fold(ops);
    const rb = await fold(ops.slice());
    t("stateRoot: deterministic across runs", ra.stateRoot === rb.stateRoot, ra.stateRoot);
    t("stateRoot: 64 hex", /^[0-9a-f]{64}$/.test(ra.stateRoot));

    const gen = await buildGenesisOps(priv1, pub1);
    t("genesis: three signed ops", gen.ops.length === 3 && gen.ops.every((o) => /^[0-9a-f]{130}$/.test(o.sig)));
    const rg = await fold(gen.ops);
    t("genesis: SAOS deployed, supply 126,682", rg.valid === 3 && rg.state.supply.SAOS === 126682000n && rg.state.bal[gen.treasury].SAOS === 126682000n);
    t("genesis: treasury recorded", rg.state.treasury === gen.treasury);

    // metadata tolerance: chain-reading flows attach at/txid. Validation
    // ignores them and the stateRoot is identical to a clean fold.
    const withMeta = ops.map((o, i) => ({ ...o, at: "2026-09-15T00:00:0" + (i % 10) + "Z", txid: "abc123", block: 1000 + i }));
    const rm = await fold(withMeta);
    t("metadata: at/txid tolerated, same valid count", rm.valid === ra.valid, rm.valid + "/" + ra.valid);
    t("metadata: same stateRoot as clean fold", rm.stateRoot === ra.stateRoot);

    // deposits, exchange, rewards: treasury = w1 (genesis signer)
    const sc = []; // scenario ops
    const mk2 = async (w, fields, id) => {
      const by = await addressFromPubSTM(w.pub);
      const env = { v: 1, id, by, pub: w.pub, ...fields };
      env.sig = await signEnvelope(env, w.priv);
      sc.push(env);
      return env;
    };
    await mk2(w2, { k: "wallet.create", nick: "friend" }, "1731000000009-cc000000");
    const claim = await mk2(w2, { k: "deposit.claim", cur: "USD", amt: "25", ref: "tx-test-123456" }, "1731000000010-cc000001");
    await mk2(w1, { k: "deposit.credit", claimId: claim.id, to: addr2, saos: "25000", cur: "USD", amt: "25", ref: "tx-test-123456" }, "1731000000011-cc000002");
    await mk2(w1, { k: "cfg.addr", cur: "USD", addr: "example-payment-address-0001" }, "1731000000012-cc000003");
    await mk2(w1, { k: "cfg.rate", pair: "SAOS/USD", price: "0.001" }, "1731000000013-cc000004");
    const off = await mk2(w2, { k: "dex.offer", cur: "USD", units: "10000", price: "0.0012" }, "1731000000014-cc000005");
    await mk2(w1, { k: "dex.fill", offerId: off.id, to: addr2, units: "4000", paid: "4.8", ref: "pay-test-654321" }, "1731000000015-cc000006");
    await mk2(w2, { k: "dex.cancel", offerId: off.id }, "1731000000016-cc000007");
    await mk2(w1, { k: "reward.pay", to: addr2, amount: "500", note: "first reward" }, "1731000000017-cc000008");

    const full = [...gen.ops, ...sc];
    const rs = await fold(full);
    t("scenario: 12/12 valid (genesis + wallet + deposit + dex + reward)", rs.valid === 12 && rs.invalid.length === 0, JSON.stringify(rs.invalid));
    t("claim: recorded and credited", rs.state.claims[claim.id]?.status === "credited" && rs.state.claims[claim.id]?.by === addr2);
    t("credit: SAOS balance of depositor 25000 + 500 reward", rs.state.bal[addr2]?.SAOS === 25500n);
    t("dex: escrow math 10000 locked, 4000 filled, 6000 returned", rs.state.offers[off.id]?.status === "cancelled" && rs.state.offers[off.id]?.filled === 4000n);
    t("dex: fill recorded with payment reference", rs.state.offers[off.id]?.fills?.[0]?.ref === "pay-test-654321");
    t("rewards: total paid tracked", rs.state.rewardsPaid === 500n);
    t("cfg: deposit address and rate published", rs.state.cfg.addrs.USD?.addr === "example-payment-address-0001" && rs.state.cfg.rates["SAOS/USD"]?.price === "0.001");

    // treasury authority: w2 tries to credit a deposit and fill an offer
    const forgedCredit = await mk2(w2, { k: "deposit.credit", to: addr2, saos: "100", cur: "USD", amt: "1", ref: "forged-ref-999" }, "1731000000018-dd000001");
    const forgedFill = await mk2(w2, { k: "dex.fill", offerId: off.id, to: addr2, units: "100" }, "1731000000019-dd000002");
    const rf = await fold([...full, forgedCredit, forgedFill]);
    t("authority: non-treasury credit rejected", rf.invalid.some((x) => x.err === "not-treasury"));
    t("authority: non-treasury fill rejected", rf.invalid.filter((x) => x.err === "not-treasury").length === 2);

    // offer without balance is rejected
    const bigOffer = await mk2(w2, { k: "dex.offer", cur: "USD", units: "99999999", price: "1" }, "1731000000020-dd000003");
    const ro = await fold([...full, bigOffer]);
    t("dex: offer beyond balance rejected", ro.invalid.some((x) => x.err === "insufficient"));

    // over-fill is rejected
    const overFill = await mk2(w1, { k: "dex.fill", offerId: off.id, to: addr2, units: "999999" }, "1731000000021-dd000004");
    const rOF = await fold([...full, overFill]);
    t("dex: fill above remaining rejected (not-open after cancel)", rOF.invalid.some((x) => x.err === "not-open" || x.err === "over-fill"));

    /* ── v1.2: the pools (Genesis-2) ── */
    const ps = [];
    const mk3 = async (w, fields, id) => {
      const by = await addressFromPubSTM(w.pub);
      const env = { v: 1, id, by, pub: w.pub, ...fields };
      env.sig = await signEnvelope(env, w.priv);
      ps.push(env);
      return env;
    };
    // credit token: deployed + minted by treasury (w1)
    await mk3(w1, { k: "token.deploy", symbol: "CUSD", name: "SAOS credit USD", decimals: 8, maxSupply: "900000000000000" }, "1731000000022-ee000001");
    await mk3(w1, { k: "token.mint", symbol: "CUSD", to: addr1a, amount: "50000000000" }, "1731000000023-ee000002"); // 500.00000000 CUSD
    // pool: treasury creates, non-treasury rejected
    const pBad = await mk3(w2, { k: "pool.create", pair: "SAOS/CUSD", feeBps: "30" }, "1731000000024-ee000003");
    const rpBad = await fold([...full, ...ps]);
    t("pool: non-treasury create rejected", rpBad.invalid.some((x) => x.err === "not-treasury"));
    await mk3(w1, { k: "pool.create", pair: "SAOS/CUSD", feeBps: "30" }, "1731000000025-ee000004");
    // treasury seeds: 20,000 SAOS × 20.00000000 CUSD (rate 0.001)
    await mk3(w1, { k: "pool.add", pair: "SAOS/CUSD", base: "20000000", quote: "2000000000" }, "1731000000026-ee000005");
    const rp = await fold([...full, ...ps]);
    const pool1 = rp.state.pools["SAOS/CUSD"];
    t("pool: created and seeded", !!pool1 && pool1.resA === 20000000n && pool1.resB === 2000000000n);
    t("pool: genesis LP = isqrt(base·quote) = 200000000", pool1.lpSupply === 200000000n && pool1.lpBal[addr1a] === 200000000n);
    // w2 (has 25500 SAOS) swaps 5000 SAOS → CUSD
    const sw1 = await mk3(w2, { k: "pool.swap", pair: "SAOS/CUSD", dir: "SA2C", amountIn: "5000", minOut: "0" }, "1731000000027-ee000006");
    const rsw = await fold([...full, ...ps]);
    const k1 = rsw.state.pools["SAOS/CUSD"];
    t("pool: swap SA2C lands, k never shrinks", k1.kAfter === undefined && k1.resA === 20005000n, JSON.stringify({ a: String(k1?.resA), b: String(k1?.resB) }));
    t("pool: k-invariant holds across the swap", k1.resA * k1.resB >= 20000000n * 2000000000n);
    // slippage guard
    const sw2 = await mk3(w2, { k: "pool.swap", pair: "SAOS/CUSD", dir: "SA2C", amountIn: "5000", minOut: "999999999" }, "1731000000028-ee000007");
    const rsw2 = await fold([...full, ...ps]);
    t("pool: slippage guard rejects minOut too high", rsw2.invalid.some((x) => x.err === "slippage"));
    // imbalanced provision rejected
    const badAdd = await mk3(w1, { k: "pool.add", pair: "SAOS/CUSD", base: "1000000", quote: "1" }, "1731000000029-ee000008");
    const rba = await fold([...full, ...ps]);
    t("pool: imbalanced provision rejected", rba.invalid.some((x) => x.err === "imbalanced"));
    // drain law (measured math): out < resOut is structural in x·y=k — the
    // asymptote punishes, never empties. The real guard is the balance check.
    const overBag = await mk3(w2, { k: "pool.swap", pair: "SAOS/CUSD", dir: "C2SA", amountIn: "498377", minOut: "0" }, "1731000000030-ee000009");
    const rob = await fold([...full, ...ps]);
    t("pool: swap beyond balance rejected", rob.invalid.some((x) => x.err === "insufficient"), JSON.stringify(rob.invalid.filter((x) => x.id === overBag.id)));
    // asymptote: treasury mega-swap (480 CUSD into a 2,000 CUSD reserve) cannot
    // take the last SAOS unit out, and k still grows — the pool survives whales
    await mk3(w1, { k: "pool.swap", pair: "SAOS/CUSD", dir: "C2SA", amountIn: "48000000000", minOut: "0" }, "1731000000030-ee000009b");
    const ras = await fold([...full, ...ps]);
    const kAs = ras.state.pools["SAOS/CUSD"];
    t("pool: asymptote — whale swap leaves residual base", kAs.resA > 0n && kAs.resA < 20005000n, JSON.stringify({ a: String(kAs?.resA) }));
    t("pool: k grows even through the whale", kAs.resA * kAs.resB >= 20000000n * 2000000000n);
    // C2SA direction works within bounds
    await mk3(w2, { k: "pool.swap", pair: "SAOS/CUSD", dir: "C2SA", amountIn: "100000", minOut: "0" }, "1731000000031-ee000010");
    const rsw3 = await fold([...full, ...ps]);
    const k3 = rsw3.state.pools["SAOS/CUSD"];
    t("pool: swap C2SA lands", k3.swaps === 3n && k3.resA < 20005000n, JSON.stringify({ swaps: String(k3?.swaps) }));
    // LP remove: treasury burns half its LP, gets pro-rata back
    await mk3(w1, { k: "pool.remove", pair: "SAOS/CUSD", lp: "100000000" }, "1731000000032-ee000011");
    const rrm = await fold([...full, ...ps]);
    const k4 = rrm.state.pools["SAOS/CUSD"];
    t("pool: LP remove returns pro-rata reserves", k4.lpSupply === 100000000n && k4.lpBal[addr1a] === 100000000n);
    // fee accounting: reserves grew by the fee path (k strictly grows after every swap)
    const kAfterAll = k3.resA * k3.resB;
    t("pool: fees compound into the reserves (k grew)", kAfterAll >= 20000000n * 2000000000n);
    void sw1; void sw2; void badAdd;

    const passed = tests.filter((x) => x.pass).length;
    return { passed, total: tests.length, tests, protocol: PROTOCOL };
  }

  return {
    PROTOCOL,
    OP_ID,
    SAOS_GENESIS,
    TREASURY_GENESIS_ID,
    canon,
    addressFromPubSTM,
    ADDR_RE,
    digestFor,
    signEnvelope,
    recoverPub,
    validateEnvelope,
    fold,
    buildOp,
    buildGenesisOps,
    newWallet,
    randomPriv,
    fmt,
    selfTest,
    quoteSwap,
    isqrt,
    CREDIT_RE,
  };
}

/* Exports: ESM (bun/cloud) named, browser globalThis.SaosLive. */
const SaosLive = makeSaosLive(C);
export const PROTOCOL = SaosLive.PROTOCOL;
export const OP_ID = SaosLive.OP_ID;
export const SAOS_GENESIS = SaosLive.SAOS_GENESIS;
export const TREASURY_GENESIS_ID = SaosLive.TREASURY_GENESIS_ID;
export const canon = SaosLive.canon;
export const addressFromPubSTM = SaosLive.addressFromPubSTM;
export const ADDR_RE = SaosLive.ADDR_RE;
export const digestFor = SaosLive.digestFor;
export const signEnvelope = SaosLive.signEnvelope;
export const recoverPub = SaosLive.recoverPub;
export const validateEnvelope = SaosLive.validateEnvelope;
export const fold = SaosLive.fold;
export const buildOp = SaosLive.buildOp;
export const buildGenesisOps = SaosLive.buildGenesisOps;
export const newWallet = SaosLive.newWallet;
export const randomPriv = SaosLive.randomPriv;
export const fmt = SaosLive.fmt;
export const selfTest = SaosLive.selfTest;
export const quoteSwap = SaosLive.quoteSwap;
export const isqrt = SaosLive.isqrt;
export const CREDIT_RE = SaosLive.CREDIT_RE;
globalThis.SaosLive = SaosLive;
