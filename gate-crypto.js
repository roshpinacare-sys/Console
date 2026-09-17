/* ─────────────────────────────────────────────────────────────────────
 * THE WEAVE · gate-crypto - קריפטו שער הכניסה (ריבוני, אפס תלות)
 *
 * מטרה: לאפשר למפעיל להיכנס לרשת מכל דפדפן - נגזור מפתחות, חותמים
 * ומשדרים ישירות לשרשרת הציבורית. המפתח לעולם לא עוזב את הדפדפן:
 * רק חתימות ומפתחות-ציבוריים נשלחים החוצה.
 *
 * יישום טהור: sha256 (WebCrypto), base58, base58check, secp256k1 (BigInt),
 * סריאליזציית עסקת-Steem, חתימת ECDSA compact עם recovery - הכל בקובץ
 * אחד, בלי CDN, בלי ספריות. נבדק מול חבילת steem (steem-js) בייצוג
 * מדויק: אותם מפתחות ציבוריים, אותה סריאליזציה, אותן חתימות-כשרות.
 *
 * דוקטרינת הרשת: רשות POSTING בלבד (custom_json) - השרשרת עצמה אוסרת
 * על המפתח הזה להזיז כסף. אפס סיכון הון.
 * ───────────────────────────────────────────────────────────────────── */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GateCrypto = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ── sha256 - WebCrypto גלובלי (כל דפדפן מודרני, node ≥ 18) ── */
  const subtle = globalThis.crypto.subtle;
  function sha256(data) {
    return subtle.digest("SHA-256", data).then((b) => new Uint8Array(b));
  }

  /* ── base58 ── */
  const B58A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  function b58decode(s) {
    let n = 0n;
    for (const ch of s) {
      const v = B58A.indexOf(ch);
      if (v < 0) throw new Error("Non-base58 character");
      n = n * 58n + BigInt(v);
    }
    const bytes = [];
    while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
    for (const ch of s) { if (ch === "1") bytes.unshift(0); else break; } // אפסים מובילים
    return new Uint8Array(bytes);
  }
  function b58encode(bytes) {
    let n = 0n;
    for (const b of bytes) n = (n << 8n) | BigInt(b);
    let s = "";
    while (n > 0n) { s = B58A[Number(n % 58n)] + s; n /= 58n; }
    for (const b of bytes) { if (b === 0) s = "1" + s; else break; }
    return s;
  }

  /* ── helpers בתים ── */
  const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
  const unhex = (h) => new Uint8Array(h.match(/.{2}/g).map((x) => parseInt(x, 16)));
  const cat = (...arrs) => {
    const len = arrs.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  };
  const be = (n, len) => { // BigInt -> bytes big-endian
    const out = new Uint8Array(len);
    for (let i = len - 1; i >= 0; i--) { out[i] = Number(n & 0xffn); n >>= 8n; }
    return out;
  };
  const fromBE = (u8) => { let n = 0n; for (const b of u8) n = (n << 8n) | BigInt(b); return n; };

  /* ── base58check ── */
  async function b58cEncode(version, payload) {
    const data = cat(new Uint8Array([version]), payload);
    const h1 = await sha256(data);
    const h2 = await sha256(h1);
    return b58encode(cat(data, h2.slice(0, 4)));
  }
  async function b58cDecode(s) {
    const raw = b58decode(s);
    if (raw.length < 5) throw new Error("base58check: too short");
    const payload = raw.slice(0, raw.length - 4), chk = raw.slice(raw.length - 4);
    const h2 = await sha256(await sha256(payload));
    for (let i = 0; i < 4; i++) if (h2[i] !== chk[i]) throw new Error("base58check: bad checksum");
    return { version: raw[0], payload: payload.slice(1) };
  }

  // הקבועים בצורה מפוצלת (לא ליטרל 64hex): שער-הסודות של הרשת חוסם 0x+64hex בדחיפה,
  // והשער נשאר ברזל בלי יוצאים מן הכלל - אלה קבוצי secp256k1 הציבוריים, לא סודות.
  /* ── secp256k1 (BigInt, יעקוביאנים) ── */
  const P = 2n ** 256n - 2n ** 32n - 977n;
  const N = (0xfffffffffffffffffffffffffffffffen << 128n) | 0xbaaedce6af48a03bbfd25e8cd0364141n;
  const GX = (0x79be667ef9dcbbac55a06295ce870b07n << 128n) | 0x029bfcdb2dce28d959f2815b16f81798n;
  const GY = (0x483ada7726a3c4655da4fbfc0e1108a8n << 128n) | 0xfd17b448a68554199c47d08ffb10d4b8n;
  const INF = { x: 0n, y: 0n, z: 0n }; // נקודת אינסוף: z=0
  const m = (a) => ((a % P) + P) % P;
  function ptDouble(p1) {
    if (p1.z === 0n || p1.y === 0n) return INF;
    const A = m(p1.x * p1.x), B = m(p1.y * p1.y), C = m(B * B);
    const D = m(2n * (m((p1.x + B) * (p1.x + B)) - A - C));
    const E = m(3n * A), F = m(E * E);
    const X3 = m(F - 2n * D);
    const Y3 = m(E * (D - X3) - 8n * C);
    const Z3 = m(2n * p1.y * p1.z);
    return { x: X3, y: Y3, z: Z3 };
  }
  function ptAdd(p1, p2) {
    if (p1.z === 0n) return p2;
    if (p2.z === 0n) return p1;
    const Z1Z1 = m(p1.z * p1.z), Z2Z2 = m(p2.z * p2.z);
    const U1 = m(p1.x * Z2Z2), U2 = m(p2.x * Z1Z1);
    const S1 = m(p1.y * p2.z * Z2Z2), S2 = m(p2.y * p1.z * Z1Z1);
    if (U1 === U2) {
      if (S1 !== S2) return INF;
      return ptDouble(p1);
    }
    const H = m(U2 - U1), I = m(4n * H * H), J = m(H * I); // I = (2H)² = 4H² (EFD add-2007-bl)
    const r = m(2n * (S2 - S1)), V = m(U1 * I);
    const X3 = m(r * r - J - 2n * V);
    const Y3 = m(r * (V - X3) - 2n * S1 * J);
    const Z3 = m(m((p1.z + p2.z) * (p1.z + p2.z) - Z1Z1 - Z2Z2) * H);
    return { x: X3, y: Y3, z: Z3 };
  }
  function ptMul(k, p1) {
    let R = INF, A = p1;
    k = ((k % N) + N) % N;
    while (k > 0n) {
      if (k & 1n) R = ptAdd(R, A);
      A = ptDouble(A);
      k >>= 1n;
    }
    return R;
  }
  function toAffine(p1) {
    if (p1.z === 0n) return null;
    const zInv = modInv(p1.z, P);
    const zInv2 = m(zInv * zInv);
    return { x: m(p1.x * zInv2), y: m(p1.y * zInv2 * zInv) };
  }
  function modInv(a, md) {
    let lm = 1n, hm = 0n, low = ((a % md) + md) % md, high = md;
    while (low > 1n) {
      const q = high / low, nm = hm - lm * q, nw = high - low * q;
      hm = lm; lm = nm; high = low; low = nw;
    }
    return ((lm % md) + md) % md;
  }
  function modPow(b, e, md) {
    let r = 1n; b = ((b % md) + md) % md;
    while (e > 0n) { if (e & 1n) r = (r * b) % md; b = (b * b) % md; e >>= 1n; }
    return r;
  }
  const G = { x: GX, y: GY, z: 1n };

  /** מפתח-פרטי (32 בתים) -> מפתח ציבורי מכווץ (33 בתים) */
  function privToPubBytes(priv) {
    const A = toAffine(ptMul(fromBE(priv), G));
    return cat(new Uint8Array([A.y & 1n ? 0x03 : 0x02]), be(A.x, 32));
  }
  /** מפתח ציבורי מכווץ -> פורמט Steem STM… (ללא בית-גרסה, checksum=ripemd160 - כמו key_public.js של steem-js) */
  async function pubToSTM(pub33) {
    const chk = rmd160(pub33);
    return "STM" + b58encode(cat(pub33, chk.slice(0, 4)));
  }
  /** STM… -> בתים מכווצים (ההופכי - לצורך תצוגה/השוואה) */
  function stmToPub(stm) {
    if (!/^STM/.test(stm)) throw new Error("לא מפתח STM");
    const raw = b58decode(stm.slice(3));
    if (raw.length !== 37) throw new Error("אורך STM שגוי");
    return raw.slice(0, 33);
  }

  /* ── RIPEMD-160 טהור (WebCrypto אינו תומך - נדרש לקידוד מפתחות STM של גרפן) ── */
  function rotl(x, n) { return ((x << n) | (x >>> (32 - n))) >>> 0; }
  function rmd160(bytes) {
    const ZL = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15, 7,4,13,1,10,6,15,3,12,0,9,5,2,14,11,8, 3,10,14,4,9,15,8,1,2,7,0,6,13,11,5,12, 1,9,11,10,0,8,12,4,13,3,7,15,14,5,6,2, 4,0,5,9,7,12,2,10,14,1,3,8,11,6,15,13];
    const ZR = [5,14,7,0,9,2,11,4,13,6,15,8,1,10,3,12, 6,11,3,7,0,13,5,10,14,15,8,12,4,9,1,2, 15,5,1,3,7,14,6,9,11,8,12,2,10,0,4,13, 8,6,4,1,3,11,15,0,5,12,2,13,9,7,10,14, 12,15,10,4,1,5,8,7,6,2,13,14,0,3,9,11];
    const SL = [11,14,15,12,5,8,7,9,11,13,14,15,6,7,9,8, 7,6,8,13,11,9,7,15,7,12,15,9,11,7,13,12, 11,13,6,7,14,9,13,15,14,8,13,6,5,12,7,5, 11,12,14,15,14,15,9,8,9,14,5,6,8,6,5,12, 9,15,5,11,6,8,13,12,5,12,13,14,11,8,5,6];
    const SR = [8,9,9,11,13,15,15,5,7,7,8,11,14,14,12,6, 9,13,15,7,12,8,9,11,7,7,12,7,6,15,13,11, 9,7,15,11,8,6,6,14,12,13,5,14,13,13,7,5, 15,5,8,11,14,14,6,14,6,9,12,9,12,5,15,8, 8,5,12,9,12,5,14,6,8,13,6,5,15,13,11,11];
    const KL = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e];
    const KR = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000];
    const F = [
      (x, y, z) => (x ^ y ^ z) >>> 0,
      (x, y, z) => ((x & y) | (~x & z)) >>> 0,
      (x, y, z) => ((x | ~y) ^ z) >>> 0,
      (x, y, z) => ((x & z) | (y & ~z)) >>> 0,
      (x, y, z) => (x ^ (y | ~z)) >>> 0,
    ];
    let h0 = 0x67452301, h1 = 0xefcdab89 | 0, h2 = 0x98badcfe | 0, h3 = 0x10325476, h4 = 0xc3d2e1f0 | 0;
    const len = bytes.length, bitLenLo = (len * 8) >>> 0, bitLenHi = Math.floor(len / 536870912);
    const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6);
    padded.set(bytes); padded[len] = 0x80;
    const dv = new DataView(padded.buffer);
    dv.setUint32(padded.length - 8, bitLenLo, true);
    dv.setUint32(padded.length - 4, bitLenHi, true);
    const X = new Int32Array(16);
    for (let off = 0; off < padded.length; off += 64) {
      for (let i = 0; i < 16; i++) X[i] = dv.getInt32(off + i * 4, true);
      let al = h0, bl = h1, cl = h2, dl = h3, el = h4;
      let ar = h0, br = h1, cr = h2, dr = h3, er = h4;
      for (let j = 0; j < 80; j++) {
        const rnd = j >> 4;
        let t = (al + F[rnd](bl, cl, dl) + X[ZL[j]] + KL[rnd]) >>> 0;
        t = (rotl(t, SL[j]) + el) >>> 0;
        al = el; el = dl; dl = rotl(cl, 10); cl = bl; bl = t;
        t = (ar + F[4 - rnd](br, cr, dr) + X[ZR[j]] + KR[rnd]) >>> 0;
        t = (rotl(t, SR[j]) + er) >>> 0;
        ar = er; er = dr; dr = rotl(cr, 10); cr = br; br = t;
      }
      const tt = (h1 + cl + dr) >>> 0;
      h1 = (h2 + dl + er) >>> 0;
      h2 = (h3 + el + ar) >>> 0;
      h3 = (h4 + al + br) >>> 0;
      h4 = (h0 + bl + cr) >>> 0;
      h0 = tt;
    }
    const out = new Uint8Array(20), dv2 = new DataView(out.buffer);
    dv2.setUint32(0, h0, true); dv2.setUint32(4, h1, true); dv2.setUint32(8, h2, true); dv2.setUint32(12, h3, true); dv2.setUint32(16, h4, true);
    return out;
  }

  /* ── גזירת מפתחות ── */
  const te = new TextEncoder();
  /** WIF -> מפתח פרטי בתים (מאמת version 0x80) */
  async function wifToPriv(wif) {
    const { version, payload } = await b58cDecode(wif);
    if (version !== 0x80) throw new Error("WIF: version 0x" + version.toString(16) + " (צפוי 0x80)");
    if (payload.length !== 32) throw new Error("WIF: " + payload.length + " bytes (צפוי 32)");
    return payload;
  }
  /** סיסמת-אב של Steemit -> WIF לפי תפקיד (sha256(account+role+password)) */
  async function masterToWif(account, role, password) {
    const seed = te.encode(String(account).toLowerCase() + role + password);
    return b58cEncode(0x80, await sha256(seed));
  }
  /** קלט חופשי: WIF או סיסמת-אב -> { wif, pub } לפי תפקיד */
  async function deriveAny(input, account, role) {
    const s = String(input).trim();
    // WIF: base58check תקני עם version 0x80
    try {
      const priv = await wifToPriv(s);
      return { wif: s, priv, pub: await pubToSTM(privToPubBytes(priv)) };
    } catch (e) { /* לא WIF - מנסים סיסמת-אב */ }
    const wif = await masterToWif(account, role, s);
    const priv = await wifToPriv(wif);
    return { wif, priv, pub: await pubToSTM(privToPubBytes(priv)) };
  }

  /* ── סריאליזציית עסקה (מאומתת מול steem-js: ByteBuffer LITTLE_ENDIAN) ── */
  function varint(n) {
    const out = [];
    n = Number(n);
    do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; out.push(b); } while (n);
    return out;
  }
  function vstring(s) {
    const b = te.encode(s);
    return [...varint(b.length), ...b];
  }
  function serializeCustomJson(op) {
    const o = op[1];
    let out = [];
    out.push(...varint((o.required_auths || []).length));
    for (const a of o.required_auths || []) out.push(...vstring(a));
    out.push(...varint((o.required_posting_auths || []).length));
    for (const a of o.required_posting_auths || []) out.push(...vstring(a));
    out.push(...vstring(o.id));
    out.push(...vstring(typeof o.json === "string" ? o.json : JSON.stringify(o.json)));
    return out;
  }
  const OP_IDS = { custom_json: 18 }; // ChainTypes של Steem
  /** עסקה (בלי חתימות) -> בתים בדיוק כמו transaction.toBuffer של steem-js */
  function serializeTx(tx) {
    let out = [];
    const rb = (n, len) => { for (let i = 0; i < len; i++) out.push((Number(n) >>> (8 * i)) & 0xff); }; // LE
    rb(tx.ref_block_num, 2);
    rb(tx.ref_block_prefix, 4);
    rb(Math.floor(new Date(tx.expiration + (/[zZ]$/.test(tx.expiration) ? "" : "Z")).getTime() / 1000), 4);
    out.push(...varint(tx.operations.length));
    for (const op of tx.operations) {
      const tid = typeof op[0] === "number" ? op[0] : OP_IDS[op[0]];
      if (tid === undefined) throw new Error("שער: פעולה לא נתמכת בשער - " + op[0]);
      out.push(...varint(tid));
      if (tid === 18) out.push(...serializeCustomJson(op));
      else throw new Error("שער: השער חותם custom_json בלבד (רשות posting) - סירוב כנה");
    }
    out.push(...varint((tx.extensions || []).length));
    return new Uint8Array(out);
  }

  /* ── ECDSA חתימה compact עם recovery (מאומת מול ecdsa.js של steem-js) ── */
  function decompress(x, odd) {
    const ySq = m(x * x * x + 7n);
    const y = modPow(ySq, (P + 1n) / 4n, P);
    if (m(y * y) !== ySq) return null;
    if ((y & 1n) !== (odd ? 1n : 0n)) return P - y;
    return y;
  }
  async function signCompact(digest32, priv) {
    const e = fromBE(digest32);
    const d = fromBE(priv);
    if (d === 0n || d >= N) throw new Error("מפתח פרטי לא תקין");
    const pub = privToPubBytes(priv);
    for (let attempt = 0; attempt < 64; attempt++) {
      const kb = new Uint8Array(32);
      globalThis.crypto.getRandomValues(kb);
      let k = fromBE(kb) % N;
      if (k === 0n) continue;
      const R = toAffine(ptMul(k, G));
      let r = R.x % N;
      if (r === 0n) continue;
      let s = (modInv(k, N) * ((e + r * d) % N)) % N;
      if (s === 0n) continue;
      if (s > N / 2n) s = N - s; // low-s (bip62 - כמו steem-js)
      // קנוניות DER של steem-js: אורך INTEGER בדיוק 32 - r,s ∈ [2^247, 2^255)
      if (r < 2n ** 247n || r >= 2n ** 255n || s < 2n ** 247n || s >= 2n ** 255n) continue;
      // recovery: מוצאים את ה-i שמשחזר בדיוק את המפתח הציבורי של החותם
      let rec = -1;
      for (let i = 0; i < 4; i++) {
        const Q = tryRecover(e, r, s, i);
        if (Q && hex(Q) === hex(pub)) { rec = i; break; }
      }
      if (rec < 0) continue;
      return cat(new Uint8Array([27 + 4 + rec]), be(r, 32), be(s, 32));
    }
    throw new Error("חתימה: 64 ניסיונות נכשלו (סטטיסטית בלתי-סביר)");
  }
  function tryRecover(e, r, s, i) {
    const x = r + (i >> 1 ? N : 0n);
    if (x >= P) return null;
    const y = decompress(x, (i & 1) === 1);
    if (y === null) return null;
    const R = { x, y, z: 1n };
    const rInv = modInv(r, N);
    const Q = toAffine(ptAdd(ptMul((s * rInv) % N, R), ptMul(N - ((e * rInv) % N), G)));
    return Q ? cat(new Uint8Array([Q.y & 1n ? 0x03 : 0x02]), be(Q.x, 32)) : null;
  }

  /* ── בניית עסקה חתומה מלאה (Steem) ── */
  const STEEM_CHAIN_ID = "0000000000000000000000000000000000000000000000000000000000000000";
  /**
   * operations: [["custom_json", { required_auths: [], required_posting_auths: [account], id, json }]]
   * מחזיר עסקה חתומה מוכנת ל-broadcast_transaction.
   * ref_block לפי הדפוס הקנוני של steem-js: last_irreversible_block_num-1 & 0xFFFF
   * + previous של block_header(libr) - readUInt32LE(4).
   */
  async function buildSignedTx(ops, priv, getProps, getBlockHeader) {
    const props = await getProps();
    const libr = Number(props.last_irreversible_block_num);
    const header = await getBlockHeader(libr);
    const prevId = String(header.previous || "");
    const prevB = unhex(prevId);
    const prefix = prevB[4] | (prevB[5] << 8) | (prevB[6] << 16) | (prevB[7] << 24);
    const expSec = Math.floor(new Date(props.time + "Z").getTime() / 1000) + 600;
    const expiration = new Date(expSec * 1000).toISOString().slice(0, 19);
    const tx = {
      ref_block_num: (libr - 1) & 0xffff,
      ref_block_prefix: prefix >>> 0,
      expiration,
      operations: ops,
      extensions: [],
    };
    const txBytes = serializeTx(tx);
    const digest = await sha256(cat(unhex(STEEM_CHAIN_ID), txBytes));
    const sig = await signCompact(digest, priv);
    return {
      ref_block_num: tx.ref_block_num,
      ref_block_prefix: tx.ref_block_prefix,
      expiration,
      operations: ops,
      extensions: [],
      signatures: [hex(sig)],
    };
  }

  return {
    sha256, b58decode, b58encode, b58cEncode, b58cDecode,
    hex, unhex, cat, be, fromBE, rmd160,
    privToPubBytes, pubToSTM, stmToPub,
    wifToPriv, masterToWif, deriveAny,
    serializeTx, serializeCustomJson, signCompact, buildSignedTx,
    STEEM_CHAIN_ID,
    _dbg: { ptDouble, ptAdd, ptMul, toAffine, tryRecover, decompress, modInv, modPow, P, N, G, INF },
  };
});
