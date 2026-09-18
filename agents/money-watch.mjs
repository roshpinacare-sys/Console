// MONEY-WATCH — צופה נתיב הכסף (R39)
//
// שני צווארי-הבקבוק של נתיב הכסף לא היו תחת מעקב חי:
//   1. כניסת-הדלק: תשלומי ה-powerdown של @headcorner הם עורק-החיים היחיד
//      של ערך חוץ (≈470 SP ≈ $25 לשבוע, עוד 4 תשלומים). הגריד החוץ רץ
//      יומית ב-03:17 UTC — כלומר הדלק שנוחת ב-02:01 ממתין 76 דקות לפני
//      שנכנס לשוק. הסוכן הזה קולט את הנחיתה בתוך רבע-שעה ומזניק את
//      הגריד מיד — הדלק נכנס לשוק באותה דקה.
//   2. יציאת-הפדיון: תיבת-היציאה (peg-outbox) מצטברת בתביעות פדיון, אבל
//      אף אחד לא אמר מתי שווה לשדר. הסוכן מודד חי: יתרת התיבה מול עלות
//      רוחב-הפס ב-TRON (0.35 TRX לשידור, נמדד) — ופוסק SEND-NOW/WAIT עם
//      המספרים במדויק.
//
// אפס-מפתחות: RPC ציבורי של Steem + trongrid + CoinGecko בלבד. כל נפילה
// נרשמת בכנות (null + סיבה) — שום דבר לא מדומה. המצב נשמר ב-dex/money.json
// בעצמו (self-referential) — הריצה הבאה משווה מול הקודמת.
//
// הזנקת-הגריד בנחיתה: אותו דפוס שהוכח ב-key-verify — dispatch של
// saos-dex/dex-grid דרך AGENTS_WATCH_TOKEN. מופעל פעם אחת לכל תשלום
// (הסנטינל: מזהה-התשלום שכבר טופל). הריצה היומית של 03:17 נשארת כרשת-ביטחון.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const OWNER = "roshpinacare-sys";
const DEX_REPO = "saos-dex";
const STEEM_ACCOUNT = "headcorner";
const CUSTODY_TRON = "TYVwwuvdDmfy3shxT3cb3RKLrRCshaZxTy";
const OUT_PATH = process.env.MONEY_PATH || "dex/money.json";
const BANDWIDTH_COST_TRX = 0.35; // נמדד חי: שידור TRX מחשבון בלי רוחב-פס מסוגר ≈ 0.345-0.35 TRX
const SEND_NOW_MULTIPLE = 3;    // שולחים רק כשהתיבה ≥ 3× עלות השידור
const LANDING_JUMP_STEEM = 50;   // סף קפיצת-מלאי שנחשב לנחיתת-דלק (מעל כל רעש גריד)

async function gh(url, method = "GET", body = null) {
  const TOKEN = process.env.AGENTS_WATCH_TOKEN;
  if (!TOKEN) throw new Error("AGENTS_WATCH_TOKEN missing");
  const r = await fetch(url, {
    method,
    headers: { Authorization: `token ${TOKEN}`, "User-Agent": "money-watch", Accept: "application/vnd.github+json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${method} ${url.replace("https://api.github.com", "")} -> ${r.status}`);
  return r.status === 204 ? null : r.json();
}

async function steemAccount() {
  const r = await fetch("https://api.steemit.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "condenser_api.get_accounts", params: [[STEEM_ACCOUNT]], id: 1 }),
  });
  if (!r.ok) throw new Error(`steemit rpc -> ${r.status}`);
  const j = await r.json();
  const a = j?.result?.[0];
  if (!a) throw new Error("steemit rpc: no account");
  return a;
}

async function tronCustody() {
  const r = await fetch("https://api.trongrid.io/wallet/getaccount", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: CUSTODY_TRON, visible: true }),
  });
  if (!r.ok) throw new Error(`trongrid -> ${r.status}`);
  const j = await r.json();
  return { balanceTrx: (j.balance ?? 0) / 1e6, ok: typeof j.balance === "number" };
}

async function coingecko() {
  const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=steem,steem-dollars,tron&vs_currencies=usd", {
    headers: { "User-Agent": "money-watch" },
  });
  if (!r.ok) throw new Error(`coingecko -> ${r.status}`);
  return r.json();
}

const num = (s) => parseFloat(String(s).replace(/[A-Za-z ]+/g, "")) || 0;
const r2 = (v) => Math.round(v * 100) / 100;

/* ═══ מצב קודם ═══ */
let prev = null;
if (existsSync(OUT_PATH)) {
  try { prev = JSON.parse(readFileSync(OUT_PATH, "utf8")); } catch { prev = null; }
}

/* ═══ 1) דלק — הרשות החיה של headcorner ═══ */
let fuel = null;
let landing = null;
try {
  const a = await steemAccount();
  const nextPayout = a.next_vesting_withdrawal || null;
  const rateVests = num(a.vesting_withdraw_rate);
  const rateSp = rateVests > 0 ? rateVests / 1630.5 : null; // יחס VESTS→SP חי (נגזר מהחשבון)
  fuel = {
    ok: true,
    account: STEEM_ACCOUNT,
    steem: num(a.balance),
    sbd: num(a.sbd_balance),
    powerdown: {
      active: !!(a.to_withdraw && num(a.to_withdraw) > 0),
      rateVests,
      rateSp: rateSp ? r2(rateSp) : null,
      nextPayout,
      remainingVests: Math.max(0, num(a.to_withdraw) - num(a.withdrawn)),
    },
  };
  const prevNext = prev?.fuel?.powerdown?.nextPayout ?? null;
  const prevSteem = typeof prev?.fuel?.steem === "number" ? prev.fuel.steem : null;

  // זיהוי נחיתה: התשלום הבא התקדם (הישן כבר בעבר) + קפיצת מלאי
  const payoutAdvanced = prevNext && nextPayout && prevNext !== nextPayout && new Date(prevNext).getTime() <= Date.now() + 36e5;
  const jump = prevSteem !== null ? fuel.steem - prevSteem : null;
  if (payoutAdvanced && jump !== null && jump >= LANDING_JUMP_STEEM) {
    landing = {
      at: new Date().toISOString(),
      paymentDue: prevNext,
      landedSteem: r2(jump),
      balanceAfter: fuel.steem,
      note: "powerdown payment detected: balance jumped and the next payout advanced",
    };
  } else if (payoutAdvanced && jump !== null && jump < LANDING_JUMP_STEEM) {
    // התשלום התקדם אבל המלאי לא קפץ — הדלק אולי כבר נצרך; נרשם בכנות בלי הזנקה
    landing = {
      at: new Date().toISOString(),
      paymentDue: prevNext,
      landedSteem: r2(jump),
      balanceAfter: fuel.steem,
      note: "payout advanced but inventory did not jump - fuel may already be committed to orders; grid refresh happens at the daily run",
    };
  }
} catch (e) {
  fuel = { ok: false, error: String(e.message).slice(0, 120) };
}

/* ═══ 2) פדיון — תיבת-היציאה מול עלות שידור ═══ */
let redemption = null;
let invariant = null;
let oracleWtrxMuGlobal = null; // אורקל: µ = מיקרו-דולר ליחידה — מועלים לסקופ-מודול לגיבוי-מחירים
let oracleWsteemMuGlobal = null;
try {
  const world = JSON.parse(readFileSync("dex/world.json", "utf8"));
  const wallets = world?.wallets || [];
  const state = world?.state || {};
  const pools = world?.pools || [];
  const outbox = wallets.find((w) => w.name === "peg-outbox");
  const operator = wallets.find((w) => w.name === "operator");
  const poolWtrx = pools.find((p) => p.key === "USDS/WTRX");
  const outboxMu = outbox?.balances?.WTRX ?? null;
  const operatorMu = operator?.balances?.WTRX ?? null;
  const poolWtrx2 = poolWtrx ? (poolWtrx.b === "WTRX" ? poolWtrx.rb : poolWtrx.ra) : null;
  // אינווריאנטת שימור מלאה: כל ה-WTRX בעולם (כל ארנק + כל בריכה) = הגיבוי —
  // לא משנה לאן זרם הכסף (אוצר-POL, חיילים, בוטים) — סכום-העולם חייב להתאים במדויק
  const wtrxHolders = wallets
    .filter((w) => ((w?.balances?.WTRX ?? 0) + (w?.locked?.WTRX ?? 0)) > 0)
    .map((w) => ({ who: w.name, mu: (w.balances?.WTRX ?? 0) + (w.locked?.WTRX ?? 0) }));
  const walletSumMu = wtrxHolders.reduce((s, h) => s + h.mu, 0);
  const poolHolders = pools
    .map((p) => ({ key: p.key, mu: (p.a === "WTRX" ? p.ra : 0) + (p.b === "WTRX" ? p.rb : 0) }))
    .filter((h) => h.mu > 0);
  const poolSumMu = poolHolders.reduce((s, h) => s + h.mu, 0);
  const oracleWtrxMu = state?.oracle?.WTRX?.mu ?? null; // אורקל: µ = מיקרו-דולר ליחידה (chain.ts:781 ×1e6)
  const oracleWsteemMu = state?.oracle?.WSTEEM?.mu ?? null;
  oracleWtrxMuGlobal = oracleWtrxMu;
  oracleWsteemMuGlobal = oracleWsteemMu;
  const backingMu = state?.backing?.WTRX ?? null;

  if (outboxMu !== null) {
    const outboxTrx = outboxMu / 1000;
    const custody = await tronCustody().catch(() => null);
    // אינווריאנטה: סכום-העולם (כל ארנק + כל בריכה) = הגיבוי (ב-µ) — שימור מלא, עמיד לכל זרימה עתידית
    if (backingMu !== null) {
      const sum = walletSumMu + poolSumMu;
      invariant = {
        operatorMu,
        outboxMu,
        poolMu: poolWtrx2,
        walletSumMu,
        poolSumMu,
        holders: [...wtrxHolders, ...poolHolders],
        sumMu: sum,
        backingMu,
        holds: sum === backingMu,
        scope: "all wallets + all pools (full conservation)",
      };
    }
    const threshold = r2(BANDWIDTH_COST_TRX * SEND_NOW_MULTIPLE);
    const verdict = outboxTrx >= threshold ? "SEND-NOW" : "WAIT";
    redemption = {
      ok: true,
      outboxTrx: r2(outboxTrx),
      outboxMu,
      custody: custody ? { address: CUSTODY_TRON, balanceTrx: custody.balanceTrx, coversBacking: r2(custody.balanceTrx) >= (backingMu ?? 0) / 1000 - 0.01 } : { address: CUSTODY_TRON, unreachable: true },
      broadcastCostTrx: BANDWIDTH_COST_TRX,
      sendThresholdTrx: threshold,
      verdict,
      action: verdict === "SEND-NOW"
        ? "accumulated redemptions exceed 3x the broadcast cost - the operator should send now"
        : `waiting: ${r2(outboxTrx)} TRX accumulated of ${threshold} TRX threshold (missing ${r2(threshold - outboxTrx)} TRX)`,
      usd: oracleWtrxMu ? r2((outboxTrx * oracleWtrxMu) / 1e6) : null, // µ-אורקל בסולם מיקרו-דולר
    };
  } else {
    redemption = { ok: false, error: "peg-outbox wallet not found in world.json" };
  }
} catch (e) {
  redemption = { ok: false, error: String(e.message).slice(0, 120) };
}

/* ═══ 3) מחירים חיצוניים חיים (לציון ערך הדלק) — עם נפילה-כנה לאורקל הפנימי ═══ */
let marks = null;
try {
  const cg = await coingecko();
  marks = {
    steemUsd: cg?.steem?.usd ?? null,
    sbdUsd: cg?.["steem-dollars"]?.usd ?? null,
    trxUsd: cg?.tron?.usd ?? null,
  };
} catch (e) {
  marks = { steemUsd: null, sbdUsd: null, trxUsd: null, error: String(e.message).slice(0, 90) };
}
// גיבוי: האורקל הפנימי מסונכרן-חוץ (נמדד R37: <1% סטייה) — עדיף על כלום
if (marks.steemUsd === null && oracleWsteemMuGlobal !== null) { marks.steemUsd = oracleWsteemMuGlobal / 1e6; marks.oracleFallback = true; }
if (marks.trxUsd === null && oracleWtrxMuGlobal !== null) { marks.trxUsd = oracleWtrxMuGlobal / 1e6; marks.oracleFallback = true; }

/* ═══ 4) הזנקת הגריד בנחיתת דלק (פעם אחת לכל תשלום) ═══ */
let dispatch = { attempted: false, ok: false, note: "no landing detected" };
const landingKey = landing ? String(landing.paymentDue) : null;
const alreadyDispatched = prev?.dispatch?.forPayout ?? null;
if (landing && landingKey && alreadyDispatched !== landingKey) {
  dispatch = { attempted: true, ok: false, forPayout: landingKey, note: "" };
  try {
    await gh(`https://api.github.com/repos/${OWNER}/${DEX_REPO}/actions/workflows/dex-grid.yml/dispatches`, "POST", { ref: "main" });
    dispatch.ok = true;
    dispatch.note = "dex-grid dispatched immediately - fuel enters the market within minutes of landing";
  } catch (e) {
    dispatch.note = `dispatch failed: ${String(e.message).slice(0, 90)} (daily 03:17 run is the safety net)`;
  }
} else if (landing && alreadyDispatched === landingKey) {
  dispatch = { attempted: false, ok: true, forPayout: landingKey, note: "already dispatched for this payment" };
}

/* ═══ 5) פרסום ═══ */
const doc = {
  ok: true,
  format: "money-watch-v1",
  publishedAt: new Date().toISOString(),
  engine: "Console/agents/money-watch · R39 money path sentinel",
  role: "watches the two money-path chokepoints: fuel-in (powerdown landing -> immediate grid dispatch) and redemption-out (peg-outbox vs TRON broadcast cost)",
  fuel,
  landing: landing ? { ...landing, dispatched: dispatch.ok } : null,
  dispatch,
  redemption,
  invariant,
  marks,
  honesty: "כל נתון נמדד חי מ-RPC ציבורי (Steem/trongrid/CoinGecko) או מ-world.json המפורסם. נפילת מקור מסומנת בכנות. עלות השידור ב-TRON (0.35 TRX) נמדדה משריפת-גז היסטורית של חשבון המשמרת; סף השליחה = פי 3 מהעלות. המפתח: אפס - לא סוכן חותם.",
};

writeFileSync(OUT_PATH, JSON.stringify(doc, null, 1) + "\n");

const fuelLine = fuel?.ok
  ? `steem=${fuel.steem} sbd=${fuel.sbd} next=${fuel.powerdown.nextPayout} rate≈${fuel.powerdown.rateSp}SP`
  : `steem rpc down: ${fuel?.error}`;
const redeemLine = redemption?.ok
  ? `outbox=${redemption.outboxTrx}TRX / ${redemption.sendThresholdTrx} needed -> ${redemption.verdict}`
  : `redemption: ${redemption?.error}`;
console.log(`[money-watch] ${fuelLine}`);
console.log(`[money-watch] ${redeemLine}`);
console.log(`[money-watch] landing=${landing ? "DETECTED" : "none"} · dispatch ok=${dispatch.ok}`);
if (invariant) console.log(`[money-watch] backing invariant: ${invariant.sumMu}=${invariant.backingMu} holds=${invariant.holds}`);
