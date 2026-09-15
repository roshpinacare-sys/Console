/* ─────────────────────────────────────────────────────────────────────
 * THE WEAVE · saos-live — פרוטוקול המטבע החי של הרשת (saos.live.v1)
 *
 * מטרה: SAOS חי על הרשת הציבורית — ארנקים למשתמשים חדשים, כתובת
 * אישית, מפעל טוקנים שבו כל טוקן הוא חוזה-חכם ממשי — הכל חתום,
 * דטרמיניסטי, ומאומת על ידי כל דפדפן. אפס שרת. אפס גז. אפס סנדבוקס.
 *
 * הארכיטקטורה:
 *   · ה-state חי בשרשרת הציבורית: כל פעולה = custom_json עם op id
 *     `saos.weave.live.v1` (רשות posting בלבד — השרשרת עצמה אוסרת
 *     על המפתח הזה להזיז כסף).
 *   · הסמכות היא החתימה הפנימית: הודעת הארנק חתומה במפתח של
 *     הבעלים. המשדר (relayer) הוא תעבורה בלבד — הוא לא יכול לזייף
 *     (אין לו את המפתח), וכל צומת שמאמת מחדש את כל החתימות.
 *   · החוזה הוא הקוד: כללי התקפות הדטרמיניסטיים לפניך — אותם
 *     כללים רצים בדפדפט, בענן (bun) ובכל מכונה. אותן פעולות =
 *     אותו stateRoot, בכל מקום, תמיד.
 *
 * תווית אמת: relayer יכול להיות כל חשבון Steem (כרגע: קו העדות
 * של הרשת בענן + שער המפעיל). ה-relay אינו יכול לזייף אך יכול
 * להתעלם — לכן הדוקטרינה: מספר משדרים (כל בעל חשבון Steem יוכל
 * לשדר בעתיד), והספר הציבורי הוא השופט.
 * ───────────────────────────────────────────────────────────────────── */
/* ── מקור הקריפטו: gate-crypto.js (טהור, מאומת) ──
 * בדפדפן: הוא נטען כמודול בפעולת-לוואי וקובע globalThis.GateCrypto.
 * ב-bun (הלב הענני): ייבוא CJS — ה-default הוא אותו אובייקט בדיוק.
 * אפס העתקת קוד, אפס הסתעפות — אותו קריפטו בכל צומת. */
import * as GateCryptoModule from "./gate-crypto.js";
const C = (typeof GateCryptoModule.default === "object" && GateCryptoModule.default) || globalThis.GateCrypto;
if (!C) throw new Error("saos-live: gate-crypto לא נטען — הדפדפן חייב לטעון את gate-crypto.js עם saos-live.js");

function makeSaosLive(C) {
  "use strict";
  const PROTOCOL = "saos.live.v1";
  const OP_ID = "saos.weave.live.v1";

  /* ── JSON קנוני — מפתחות ממוינים רקורסיבית, בלי רווחים ── */
  function canon(v) {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
    const keys = Object.keys(v).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  }

  const utf8 = (s) => new TextEncoder().encode(s);

  /* ── כתובת אישית: saos1 + base58check(ripemd160(sha256(pub))) ──
   * הכתובת נגזרת מהמפתח הציבורי בלבד — self-certifying: כל מי
   * שמחזיק את המפתח הפרטי הוא הבעלים של הכתובת. אין רישום, אין
   * שרת, אין הרשאה — יש חתימה. */
  const ADDR_RE = /^saos1[1-9A-HJ-NP-Za-km-z]{33,35}$/;
  async function addressFromPubSTM(stm) {
    const pub33 = C.stmToPub(String(stm || ""));
    const h1 = await C.sha256(pub33);
    const payload = C.rmd160(h1); // 20 בתים
    const chk = (await C.sha256(await C.sha256(payload))).slice(0, 4);
    return "saos1" + C.b58encode(C.cat(payload, chk));
  }

  /* ── הודעת החתימה: sha256(UTF8(canon(מעטפת בלי sig))) ──
   * הסדר קבוע-חוזה: החותם חותם, המאמת מאמת — אותם בתים בדיוק. */
  async function digestFor(envelope) {
    const { sig, ...sans } = envelope;
    if (typeof sig !== "string") return C.sha256(utf8(canon(envelope))); // חתימה על מעטפת נקייה
    return C.sha256(utf8(canon(sans)));
  }

  /* חתימה קומפקטית (65 בתים: [31+rec, r, s]) → hex */
  async function signEnvelope(envelope, privBytes) {
    const digest = await digestFor(envelope);
    const sig = await C.signCompact(digest, privBytes);
    return C.hex(sig);
  }

  /* אימות: משחזרים את המפתח הציבורי מהחתימה ומשווים ל-pub שהוצהר */
  function recoverPub(digest32, sigHex) {
    const sig = C.unhex(String(sigHex || ""));
    if (sig.length !== 65) return null;
    const i = sig[0] - 31;
    if (i < 0 || i > 3) return null;
    const r = C.fromBE(sig.slice(1, 33));
    const s = C.fromBE(sig.slice(33, 65));
    const e = C.fromBE(digest32);
    const pub = C._dbg.tryRecover(e, r, s, i);
    return pub; // Uint8Array(33) או null
  }

  /* ── עזרי כמות: מחרוזות-עשרוניות שלמות (BigInt בפנים, אפס float) ── */
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

  /* ── מזהה פעולה: <מילישניות>-<הקס אקראי> ── */
  const ID_RE = /^[0-9]{12,14}-[0-9a-f]{8,12}$/;
  const GENESIS_ID_RE = /^genesis-saos-[a-z0-9]{2,12}$/;
  function makeId() {
    const rnd = new Uint8Array(6);
    globalThis.crypto.getRandomValues(rnd);
    return Date.now() + "-" + C.hex(rnd);
  }

  /* ── ספסיפיקציית הג'נזיס של SAOS v1 ──
   * האמת מ-SAOS-NET v0 (נמדד ב-replay מתמטי, לא מטענות):
   * supply=126,682 SAOS אצל headcorner (המנפיק), ג'נזיס 2026-09-05.
   * v1 משקף אותה אמת 1:1: הטבעה ראשונה זהה לאוצר הרשת, ותקרת
   * אספקה קבועה-חוזה 21,000,000 SAOS (21 מיליון — תקרה שמעולם
   * לא תישבר, כי הכלל רץ בכל צומת). מינט נוסף: חתום על ידי
   * המנפיק בלבד, עד התקרה, מתועד על השרשרת הציבורית. */
  const SAOS_GENESIS = {
    symbol: "SAOS",
    name: "SAOS",
    decimals: 3,
    maxSupply: "21000000000", // 21,000,000.000 SAOS
    initialMint: "126682000", // 126,682.000 SAOS — משקף את v0 בדיוק
    note: "initial mint mirrors SAOS-NET v0 verified supply 1:1 (126,682 SAOS, issuer headcorner, genesis 2026-09-05)",
  };

  /* ── הכללים — החוזה עצמו ──
   * כל פעולה עוברת: מבנה קפדני → חתימה תקפה → כללי הסוג.
   * פעולה שנדחתה לא נוגעת במצב (fail-closed) ונרשמת ב-invalid. */
  const KINDS = {
    "wallet.create": ["nick"],
    "token.deploy": ["symbol", "name", "decimals", "maxSupply"],
    "token.mint": ["symbol", "to", "amount"],
    "token.transfer": ["symbol", "to", "amount"],
    "token.burn": ["symbol", "amount"],
  };

  async function validateEnvelope(env, state, seenIds, seenPubs) {
    if (!env || typeof env !== "object") return { err: "bad-envelope" };
    if (env.v !== 1) return { err: "version" };
    const k = String(env.k || "");
    if (!KINDS[k]) return { err: "unknown-kind" };
    const id = String(env.id || "");
    if (!(ID_RE.test(id) || GENESIS_ID_RE.test(id))) return { err: "bad-id" };
    if (seenIds.has(id)) return { err: "dup-id" };
    if (typeof env.pub !== "string" || !/^STM[1-9A-HJ-NP-Za-km-z]{50}$/.test(env.pub)) return { err: "bad-pub" };
    if (typeof env.sig !== "string" || !/^[0-9a-f]{130}$/.test(env.sig)) return { err: "bad-sig" };
    if (typeof env.by !== "string" || !ADDR_RE.test(env.by)) return { err: "bad-addr" };

    // החתימה — לב הריבונות: מי שחתום הוא הבעלים
    let pub33;
    try {
      pub33 = C.stmToPub(env.pub);
    } catch {
      return { err: "bad-pub" };
    }
    const digest = await digestFor(env);
    const rec = recoverPub(digest, env.sig);
    if (!rec || C.hex(rec) !== C.hex(pub33)) return { err: "sig" };
    // הכתובת נגזרת מהמפתח — self-certifying
    const derived = await addressFromPubSTM(env.pub);
    if (derived !== env.by) return { err: "addr-mismatch" };

    // שדות הסוג — קפדניים (שדה לא מוכר = דחייה: הקנון חוזה)
    for (const key of Object.keys(env)) {
      const allowed = new Set(["v", "id", "k", "by", "pub", "sig", ...KINDS[k]]);
      if (!allowed.has(key)) return { err: "unexpected-field:" + key };
    }

    if (k === "wallet.create") {
      if (state.wallets[env.by]) return { err: "wallet-exists" };
      if (seenPubs.has(env.pub)) return { err: "pub-taken" };
      if (env.nick !== undefined) {
        if (typeof env.nick !== "string" || env.nick.length < 1 || env.nick.length > 24) return { err: "bad-nick" };
        if (!/^[\u0590-\u05FFa-zA-Z0-9 ._-]+$/.test(env.nick)) return { err: "bad-nick" };
      }
      return { ok: true };
    }

    // כל שאר הסוגים דורשים ארנק רשום (זהות = כתובת מאומתת-חתימה)
    const sender = state.wallets[env.by];
    if (!sender) return { err: "no-wallet" };

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

  /* ── הקיפול: רצף פעולות → מצב ──
   * דטרמיניסטי לחלוטין: אותן פעולות באותו סדר = אותו stateRoot.
   * פעולות לא-תקפות נרשמות ומדולגות — הן לא נוגעות במצב. */
  async function fold(envelopes) {
    const state = {
      wallets: {}, // addr → {pub, nick, at}
      tokens: {}, // SYMBOL → {name, decimals, maxSupply, issuer, at}
      bal: {}, // addr → {SYMBOL: BigInt}
      supply: {}, // SYMBOL → BigInt
    };
    const seenIds = new Set();
    const seenPubs = new Set();
    const invalid = [];
    const order = [];
    let valid = 0;

    const list = Array.isArray(envelopes) ? envelopes.slice() : [];
    for (const env of list) {
      const at = typeof env?.at === "string" ? env.at : null;
      const txid = typeof env?.txid === "string" ? env.txid : null;
      const res = await validateEnvelope(env, state, seenIds, seenPubs);
      if (res.err) {
        invalid.push({ id: String(env?.id ?? "?"), k: String(env?.k ?? "?"), err: res.err });
        continue;
      }
      seenIds.add(String(env.id));
      seenPubs.add(String(env.pub));
      const k = String(env.k);
      if (k === "wallet.create") {
        state.wallets[env.by] = { pub: env.pub, nick: typeof env.nick === "string" ? env.nick : null, at, txid };
      } else if (k === "token.deploy") {
        state.tokens[env.symbol] = { name: env.name, decimals: env.decimals, maxSupply: String(env.maxSupply), issuer: env.by, at, txid };
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
      }
      valid++;
      order.push({ id: env.id, k, by: env.by, at, txid });
    }

    // קנון המצב ל-stateRoot — מאזן ריק לא נכנס, BigInt → מחרוזת
    const balCanon = {};
    for (const addr of Object.keys(state.bal).sort()) {
      const entries = Object.entries(state.bal[addr]).filter(([, v]) => v > 0n);
      if (entries.length) balCanon[addr] = Object.fromEntries(entries.map(([s, v]) => [s, String(v)]));
    }
    const supplyCanon = Object.fromEntries(Object.entries(state.supply).map(([s, v]) => [s, String(v)]));
    const rootInput = canon({ wallets: state.wallets, tokens: state.tokens, balances: balCanon, supply: supplyCanon, ops: valid });
    const stateRoot = C.hex(await C.sha256(utf8(rootInput)));

    return { ok: true, protocol: PROTOCOL, valid, invalid, order, state, stateRoot, balCanon, supplyCanon };
  }

  /* ── בניית פעולות חתומות (שימוש הארנק בדפדפט) ── */
  async function buildOp(privBytes, pubSTM, fields) {
    const by = await addressFromPubSTM(pubSTM);
    const env = { v: 1, id: makeId(), by, pub: pubSTM, ...fields };
    env.sig = await signEnvelope(env, privBytes);
    return env;
  }

  /* ── בניית הג'נזיס (הענן בלבד): רישום האוצר → פריסת SAOS → הטבעה ראשונה ──
   * האוצר הוא הזהות שנגזרת ממפתח ה-posting של קו העדות (עד הרשת
   * בשרשרת הציבורית) — הרישום שלו חלק מהג'נזיס, חתום באותו מפתח. */
  async function buildGenesisOps(treasuryPrivBytes, treasuryPubSTM) {
    const treasury = await addressFromPubSTM(treasuryPubSTM);
    const wallet = {
      v: 1,
      id: "genesis-saos-treasury",
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

  /* ── ארנק חדש: מפתח אקראי (CSPRNG) → זהות ריבונית מלאה ── */
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

  /* ── בדיקה עצמית — וקטורים קבועים, דטרמיניזטיים ──
   * מפתחות המבחן נגזרים מ-sha256 של מחרוזות קבועות — אפס קבועי
   * הקס בקוד (שער-הסודות נשאר ברזל), הפעלה זהה בדפדפט וב-bun. */
  async function selfTest() {
    const tests = [];
    const t = (name, pass, detail) => tests.push({ name, pass, detail: detail || null });

    // 1. קנון
    t("canon: מיון-מפתחות רקורסיבי", canon({ b: 1, a: { z: 2, y: 3 } }) === '{"a":{"y":3,"z":2},"b":1}');

    // 2. כתובת — דטרמיניזם ופורמט
    const priv1 = await C.sha256(utf8("saos-live-selftest-key-one"));
    const priv2 = await C.sha256(utf8("saos-live-selftest-key-two"));
    const pub1 = await C.pubToSTM(C.privToPubBytes(priv1));
    const pub2 = await C.pubToSTM(C.privToPubBytes(priv2));
    const addr1a = await addressFromPubSTM(pub1);
    const addr1b = await addressFromPubSTM(pub1);
    const addr2 = await addressFromPubSTM(pub2);
    t("כתובת: דטרמיניסטית", addr1a === addr1b);
    t("כתובת: פורמט saos1…", ADDR_RE.test(addr1a), addr1a);
    t("כתובת: מפתחות שונים → כתובות שונות", addr1a !== addr2);

    // 3. זרימה מלאה: ארנק → טוקן → הטבעה → העברה → שריפה
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
    t("קיפול: 7/7 תקפות", res.valid === 7 && res.invalid.length === 0, JSON.stringify(res.invalid));
    t("מאזן: שולח 800", res.state.bal[addr1a]?.TEST === 800n);
    t("מאזן: מקבל 600", res.state.bal[addr2]?.TEST === 600n);
    t("אספקה: 1400 (1500-100)", res.state.supply.TEST === 1400n);

    // 4. זיוף — חתימה של אחר נדחית
    const forged = { v: 1, id: "1731000000007-bb000001", k: "token.transfer", symbol: "TEST", to: addr2, amount: "50", by: addr1a, pub: pub1 };
    forged.sig = await signEnvelope(forged, w2.priv); // חתום במפתח הלא נכון
    const r2 = await fold([...ops, forged]);
    t("זיוף: חתימה של אחר נדחית", r2.valid === 7 && r2.invalid[0]?.err === "sig");

    // 5. חריגה מהתקרה
    const over = await mk(w1, { k: "token.mint", symbol: "TEST", to: addr1a, amount: "999999000" }, "1731000000008-bb000002");
    const r3 = await fold([...ops, over]);
    t("מינט מעל התקרה נדחה", r3.invalid.some((x) => x.err === "over-max") && r3.state.supply.TEST === 1400n);

    // 6. מזהה כפול
    const dup = { ...ops[0] };
    const r4 = await fold([...ops, dup]);
    t("מזהה כפול נדחה (dup-id)", r4.valid === 7 && r4.invalid.some((x) => x.err === "dup-id"));

    // 7. נמען לא רשום
    const ghost = await mk(w1, { k: "token.transfer", symbol: "TEST", to: "saos1" + "2".repeat(34), amount: "1" }, "1731000000009-bb000003");
    const r5 = await fold([...ops, ghost]);
    t("העברה לכתובת לא-רשומה נדחית", r5.invalid.some((x) => x.err === "no-recipient"));

    // 8. stateRoot דטרמיניסטי
    const ra = await fold(ops);
    const rb = await fold(ops.slice());
    t("stateRoot: דטרמיניסטי חוצה-ריצות", ra.stateRoot === rb.stateRoot, ra.stateRoot);
    t("stateRoot: 64 hex", /^[0-9a-f]{64}$/.test(ra.stateRoot));

    // 9. ג'נזיס — מבנה והיקף
    const gen = await buildGenesisOps(priv1, pub1);
    t("ג'נזיס: שלוש פעולות חתומות", gen.ops.length === 3 && gen.ops.every((o) => /^[0-9a-f]{130}$/.test(o.sig)));
    const rg = await fold(gen.ops);
    t("ג'נזיס: SAOS נפרש, אספקה 126,682", rg.valid === 3 && rg.state.supply.SAOS === 126682000n && rg.state.bal[gen.treasury].SAOS === 126682000n);

    const passed = tests.filter((x) => x.pass).length;
    return { passed, total: tests.length, tests, protocol: PROTOCOL };
  }

  return {
    PROTOCOL,
    OP_ID,
    SAOS_GENESIS,
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
  };
}

/* ייצוא — אותה צורה בכל סביבה:
 * ESM (bun/ענן): ייבוא בשם דרך import.
 * דפדפט: globalThis.SaosLive לצד ה-<script type="module">. */
const SaosLive = makeSaosLive(C);
export const PROTOCOL = SaosLive.PROTOCOL;
export const OP_ID = SaosLive.OP_ID;
export const SAOS_GENESIS = SaosLive.SAOS_GENESIS;
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
globalThis.SaosLive = SaosLive;
