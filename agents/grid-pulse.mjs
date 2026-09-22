// GRID-PULSE — פעימת הגריד הריבונית (R83 · אחות-הצייד של שער הדקות)
//
// דבר-המפעיל שיצר את הסוכן הזה: "אין מצב שעושים תוכנית ואז מחכים למשהו
// תקוע שיזוז. המערכת צריכה להיות דינמית ומבינה בשוק חי ולא לחכות אלא
// לפעול." מנוע ה-grid המקורי (saos-dex/grid-beat, ריפו פרטי) מת עם מכסת
// הדקות של ה-Actions — אבל האמת שהוא פרסם לא מתה איתו: היא נמדדת חסרי-
// מפתחות מהשרשרת הציבורית. הסוכן הזה הוא התשובה הריבונית: מראת-מדידה
// שרצה על הריפו הציבורי (דקות חינם לנצח), מפרסמת את dex/grid.json פעמיים
// ביום, ומעולם לא חותמת דבר — אפס מפתחות, אפס שידור, אפס סודות.
//
// חלוקת הסמכויות (המשך דוקטרינת R80/R81):
//   · מי שמציב/מבטל פקודות על השרשרת — המוביל (R81), מתוך סשן הסנדבוקס,
//     דרך /api/money שגוזר את מפתח-ה-active בזיכרון-ההרצה בלבד.
//   · מי שמודד ומפרסם — הסוכן הזה. חסר-מפתחות מהיסוד: כל מספר ניתן
//     לחישוב-מחדש על-ידי כל אחד, מ-RPC ציבורי בלבד.
//   · השופטת — השרשרת (Steem). פקודות, יתרות, מילויים ופאוורדאון נקראים
//     מ-api.steemit.com בכל ריצה; שום קובץ מקומי אינו מקור-אמת.
//
// המשכיות-המעקה (כנה): המונים המצטברים (placedTotal/cancelledTotal/
// filledTotal), היסטוריית הפקודות והמילויים ממשיכים מה-grid.json הקודם.
// פקודות שהוצבו על-ידי המוביל מתגלות כאן בפעם הראשונה שהן נצפות
// (placedBy: "observed-on-chain", txid: null — העד על השרשרת הוא
// המזהה), ופקודות שנעלמו בלי מילוי מסומנות "cancelled" בזמן-הגילוי.
//
// שומר-מקורי-חי: אם המנוע המקורי חזר לחיים (הדקות הוחזרו) ופרסם בשעה
// האחרונה — הסוכן נסוגה בכנות לפני כל כתיבה (אותו-דפוס-שמירה של R68).
// פרסום כפול בשני בתים חיים הוא מרכוז-מחדש חסר-נזק מעצם העיצוב — אבל
// נימוס זה נימוס.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const ACCOUNT = "headcorner";
const OUT_PATH = process.env.GRID_PATH || "dex/grid.json";
const RC_FUEL_VESTS = 242_330; // דלק-RC שמור לצי (הערך שנמדד במקור ב-grid-beat)
const COMMIT_PCT = 0.9;
const BID_LEVELS = 3;
const ASK_LEVELS = 3;
const MIN_LEVEL_STEEM = 1.0;
const MIN_LEVEL_SBD = 0.05;
const PARITY_BAND_BPS = 5_000;
const BACKOFF_IF_PUBLISHED_WITHIN_MS = 55 * 60 * 1000; // נסיגה מנומסת אם המקורי חי

const n = (s) => (s ? parseFloat(String(s).replace(/[A-Za-z ]+/g, "")) : 0);
const dp3 = (v) => v.toFixed(3);
const r6 = (v) => Math.round(v * 1e6) / 1e6;

/* ── RPC ציבורי (חסר-מפתחות מהיסוד) ── */
async function steemRpc(method, params) {
  const r = await fetch("https://api.steemit.com", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  if (!r.ok) throw new Error(`steemit rpc ${method} -> ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`steemit rpc ${method}: ${String(j.error.message ?? "rpc-error").slice(0, 80)}`);
  return j.result;
}

async function jget(url, timeoutMs = 9000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "grid-pulse" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

/* ── פידי-USD חיים (אותם מקורות של /api/money) ──
 * שיעור-ריצה-ראשונה (נמדד חי 02:34Z): בינאנס חסום-גיאו מה-IP-ים של
 * GitHub Actions — steemUsd הגיע null וקו-הזהות אבד. שלוש שכבות-נפילה
 * כנות עתה: בינאנס → CoinGecko → money.json של הצופה (רענן כל רבע-שעה).
 * כל שכבה מתעדת את מקורה — הצרכן תמיד יודע מאיפה המספר. */
async function marksSide() {
  const sources = {};
  let steemUsd = null;
  let sbdUsd = null;

  // שכבה 1 — בינאנס (המחיר החי הטוב ביותר) עם ניסיון-כפול
  for (let attempt = 0; attempt < 2 && steemUsd == null; attempt++) {
    try {
      const j = await jget("https://api.binance.com/api/v3/ticker/price?symbol=STEEMUSDT", 8000);
      if (Number(j.price) > 0) {
        steemUsd = Number(j.price);
        sources.steem = "binance:STEEMUSDT";
      }
    } catch { /* נפילה לשכבה הבאה */ }
  }

  // שכבה 2 — CoinGecko (עובד מה-runnerים של GitHub; כך גם בצופה-הכסף)
  try {
    const j = await jget("https://api.coingecko.com/api/v3/simple/price?ids=steem,steem-dollars&vs_currencies=usd", 9000);
    if (steemUsd == null && typeof j?.steem?.usd === "number" && j.steem.usd > 0) {
      steemUsd = j.steem.usd;
      sources.steem = "coingecko:steem";
    }
    if (typeof j?.["steem-dollars"]?.usd === "number") {
      sbdUsd = j["steem-dollars"].usd;
      sources.sbd = "coingecko:steem-dollars";
    }
  } catch { /* נפילה לשכבה 3 */ }

  // שכבה 3 — money.json של הצופה (הצופה רץ כל רבע-שעה על CoinGecko מהריפו הזה)
  if (steemUsd == null || sbdUsd == null) {
    try {
      const m = await jget("https://roshpinacare-sys.github.io/Console/dex/money.json", 8000);
      if (steemUsd == null && typeof m?.marks?.steemUsd === "number" && m.marks.steemUsd > 0) {
        steemUsd = m.marks.steemUsd;
        sources.steem = `console:money.json@${String(m.publishedAt ?? "?").slice(0, 16)}Z`;
      }
      if (sbdUsd == null && typeof m?.marks?.sbdUsd === "number") {
        sbdUsd = m.marks.sbdUsd;
        sources.sbd = `console:money.json@${String(m.publishedAt ?? "?").slice(0, 16)}Z`;
      }
    } catch { /* בלי שער — בכנות */ }
  }
  const parity = steemUsd != null && sbdUsd != null && sbdUsd > 0 ? steemUsd / sbdUsd : null;
  return { steemUsd, sbdUsd, parity, sources };
}

/* ── צילום-חי מהשרשרת (פורט נאמן של realSnapshotSoft מ-saos-dex, חסר-מפתחות) ── */
async function snapshot() {
  const [accArr, dgp, openRaw] = await Promise.all([
    steemRpc("condenser_api.get_accounts", [[ACCOUNT]]),
    steemRpc("condenser_api.get_dynamic_global_properties", []),
    steemRpc("condenser_api.get_open_orders", [ACCOUNT]).catch(() => []),
  ]);
  const a = accArr?.[0];
  if (!a) throw new Error("account-empty");
  const spPerVest = n(String(dgp.total_vesting_fund_steem)) / n(String(dgp.total_vesting_shares));
  const vestOwn = n(a.vesting_shares);
  const delOut = n(a.delegated_vesting_shares);
  const twRaw = parseFloat(String(a.to_withdraw).replace(/[A-Za-z ]/g, "")) || 0;
  const toWithdraw = twRaw > 1e12 ? twRaw / 1e6 : twRaw;
  const rate = n(a.vesting_withdraw_rate);
  const active = rate > 0 && toWithdraw > 0;

  let bestBid = null, bestAsk = null;
  try {
    const book = await steemRpc("condenser_api.get_order_book", [5]);
    bestAsk = book.asks?.[0] ? parseFloat(book.asks[0].real_price) : null;
    bestBid = book.bids?.[0] ? parseFloat(book.bids[0].real_price) : null;
  } catch { /* הספר לא שובר את תמונת-המצב */ }
  const mid = bestBid != null && bestAsk != null ? (bestBid + bestAsk) / 2 : null;
  const spreadBps = bestBid != null && bestAsk != null ? Math.floor(((bestAsk - bestBid) / bestBid) * 10_000) : null;

  // מילויים-אמת: דפדוף-מדוד (עד 3 דפים × 100, עוצר ב-6 מילויים) — הפורט של R24
  const fills = [];
  try {
    let start = -1;
    for (let page = 0; page < 3 && fills.length < 6; page++) {
      const hist = await steemRpc("condenser_api.get_account_history", [ACCOUNT, start, 100]);
      if (!Array.isArray(hist) || hist.length === 0) break;
      for (const [, e] of hist) {
        if (e.op[0] !== "fill_order" || fills.length >= 6) continue;
        const o = e.op[1];
        const openOwner = String(o.open_owner ?? "");
        const isMaker = openOwner === ACCOUNT;
        if (!isMaker && String(o.current_owner ?? "") !== ACCOUNT) continue;
        const paysOf = (x) => (typeof x === "string" ? x : String(x?.amount ?? ""));
        const paid = paysOf(o.current_pays);
        const recv = paysOf(o.open_pays);
        fills.push({
          at: e.timestamp,
          side: isMaker ? "maker" : "taker",
          paid,
          received: recv,
          openOrderid: Number(o.open_orderid ?? 0) || undefined,
          currentOrderid: Number(o.current_orderid ?? 0) || undefined,
        });
      }
      const firstIdx = hist[0][0];
      if (firstIdx <= 0) break;
      start = Math.max(0, firstIdx - 100);
    }
  } catch { /* fail-soft בכנות */ }

  const openOrders = (openRaw ?? []).map((o) => {
    const b = n(o.sell_price?.base), q = n(o.sell_price?.quote);
    return {
      id: o.orderid,
      sell: o.sell_price?.base ?? "",
      receive: o.sell_price?.quote ?? "",
      price: b > 0 && q > 0 ? (b / q).toFixed(6) : "?",
      created: o.created ?? "",
      expiration: o.expiration ?? "",
    };
  });

  return {
    balances: { steem: n(a.balance), sbd: n(a.sbd_balance) },
    powerdown: {
      active,
      weeklySp: rate * spPerVest,
      remainingSp: toWithdraw * spPerVest,
      remainingWeeks: active ? Math.max(1, Math.ceil(toWithdraw / Math.max(rate, 1e-9))) : 0,
      nextPayout: active && a.next_vesting_withdrawal?.startsWith("2") ? a.next_vesting_withdrawal : null,
      rcFuelSp: RC_FUEL_VESTS * spPerVest,
    },
    book: { bestBid, bestAsk, mid, spreadBps },
    openOrders,
    fills,
  };
}

/* ═══ main ═══ */
let prev = null;
if (existsSync(OUT_PATH)) {
  try { prev = JSON.parse(readFileSync(OUT_PATH, "utf8")); } catch { prev = null; }
}

// שומר-נסיגה: אם מישהו (המנוע המקורי שחזר לחיים) פרסם בשעה האחרונה — לא נדרוס
if (prev?.publishedAt && Date.now() - Date.parse(prev.publishedAt) < BACKOFF_IF_PUBLISHED_WITHIN_MS) {
  console.log(`[grid-pulse] fresh publication detected (${prev.publishedAt}, engine: ${String(prev.engine ?? "?").slice(0, 50)}) — stepping aside politely, no write`);
  process.exit(0);
}

const [snap, marks] = await Promise.all([
  snapshot().catch((e) => {
    console.error(`[grid-pulse] snapshot failed honestly: ${e.message}`);
    process.exit(0); // כישלון-כנה: לא פרסום שקרי, לא ריצה אדומה מיותרת
  }),
  marksSide(),
]);

const { steemUsd, sbdUsd, parity } = marks;

/* ── המשכת המעקה מהפרסום הקודם ── */
const ordersLedger = Array.isArray(prev?.orders) ? [...prev.orders] : [];
const fillsLedger = Array.isArray(prev?.fills) ? [...prev.fills] : [];
let placedTotal = typeof prev?.run?.placedTotal === "number" ? prev.run.placedTotal : 0;
let cancelledTotal = typeof prev?.run?.cancelledTotal === "number" ? prev.run.cancelledTotal : 0;
let filledTotal = typeof prev?.run?.filledTotal === "number" ? prev.run.filledTotal : 0;
let externalFlowUsd = typeof prev?.externalFlowUsd === "number" ? prev.externalFlowUsd : 0;

/* 1) מילויים חדשים — נספרים בציון-דולר-חי בזמן-הגילוי (marked-at-detection) */
let observedFills = 0;
if (steemUsd != null && sbdUsd != null) {
  for (const f of snap.fills) {
    const key = `${f.at}|${f.paid}|${f.received}`;
    if (fillsLedger.some((x) => x.key === key)) continue;
    const paidAmt = n(f.paid), recvAmt = n(f.received);
    const paidSteem = f.paid.includes("STEEM"), recvSteem = f.received.includes("STEEM");
    if (!paidSteem && !recvSteem) continue;
    const paidUsd = paidSteem ? paidAmt * steemUsd : paidAmt * sbdUsd;
    const recvUsd = recvSteem ? recvAmt * steemUsd : recvAmt * sbdUsd;
    const edgeBps = paidUsd > 0 ? Math.floor(((recvUsd - paidUsd) / paidUsd) * 10_000) : 0;
    fillsLedger.push({
      key, at: f.at, side: f.side, direction: recvSteem ? "bought-steem" : "sold-steem",
      paid: f.paid, received: f.received, steemUsd, sbdUsd, paidUsd, recvUsd, edgeBps,
    });
    externalFlowUsd = Math.round((externalFlowUsd + (recvUsd - paidUsd)) * 1e6) / 1e6;
    observedFills++;
    const oid = f.openOrderid ?? f.currentOrderid;
    if (oid) {
      const rec = ordersLedger.find((x) => x.id === oid && x.status === "open");
      if (rec) { rec.status = "filled"; rec.lastSeenAt = new Date().toISOString(); filledTotal++; }
    }
    console.log(`[grid-pulse] FILL counted: ${f.paid} -> ${f.received} · edge ${edgeBps}bps (marked-at-detection)`);
  }
}

/* 2) הצלבת פקודות פתוחות — מה שנעלם בלי מילוי בוטל; מה שנצפה חדש הוצב (על-ידי המוביל) */
const openIds = new Set(snap.openOrders.map((o) => o.id));
let observedCancellations = 0;
let observedPlacements = 0;
for (const rec of ordersLedger) {
  if (rec.status === "open" && !openIds.has(rec.id)) {
    rec.status = "cancelled"; // נעלם מהספר בלי מילוי — ביטול/גרירה (המוביל R81 גורר סולם)
    rec.lastSeenAt = new Date().toISOString();
    cancelledTotal++;
    observedCancellations++;
  } else if (rec.status === "open" && openIds.has(rec.id)) {
    rec.lastSeenAt = new Date().toISOString();
  }
}
for (const o of snap.openOrders) {
  if (!ordersLedger.some((x) => x.id === o.id)) {
    const b = n(o.sell), q = n(o.receive);
    ordersLedger.push({
      id: o.id, at: o.created ? o.created + "Z" : new Date().toISOString(), txid: null,
      side: o.sell.includes("STEEM") ? "ask" : "bid",
      sell: o.sell, receive: o.receive,
      priceSbdPerSteem: b > 0 && q > 0 ? r6(q / b) : 0,
      status: "open", lastSeenAt: new Date().toISOString(),
      placedBy: "observed-on-chain (R81 mover) — the chain is the witness; txid unknown to this keyless agent",
    });
    placedTotal++;
    observedPlacements++;
  }
}

/* 3) חסמים חיים (מדידה בלבד — לסוכן הזה אין מפתח ואין פעולה) */
const blocker = [];
if (parity == null) blocker.push("external USD marks unavailable (steem/sbd feeds down): no marking, no trading");
if (snap.book.bestBid == null || snap.book.bestAsk == null) blocker.push("public book one-sided or unreachable");
if (parity != null && snap.book.mid != null) {
  const devBps = Math.floor(((snap.book.mid - parity) / parity) * 10_000);
  if (Math.abs(devBps) > PARITY_BAND_BPS) blocker.push(`book mid deviates ${devBps}bps from external parity: refusing to trade a broken market`);
}
const sbdCommit = Math.max(0, Math.floor(snap.balances.sbd * COMMIT_PCT * 1000) / 1000);
if (sbdCommit < MIN_LEVEL_SBD * BID_LEVELS) {
  blocker.push(`buy-side waiting for SBD inventory: ${dp3(sbdCommit)} SBD commitable < ${(MIN_LEVEL_SBD * BID_LEVELS).toFixed(2)} needed`);
}
const steemCommit = Math.max(0, Math.floor((snap.balances.steem - 0.5) * COMMIT_PCT * 1000) / 1000);
const openNow = snap.openOrders.length;
if (openNow === 0 && steemCommit < MIN_LEVEL_STEEM * ASK_LEVELS) {
  blocker.push(`sell-side waiting for fuel: ${dp3(steemCommit)} STEEM commitable < ${MIN_LEVEL_STEEM * ASK_LEVELS} needed (next powerdown: ${snap.powerdown.nextPayout ?? "?"})`);
}

const doc = {
  ok: true,
  publishedAt: new Date().toISOString(),
  engine: "Console/agents/grid-pulse · R83 sovereign grid mirror — keyless measurement, signs nothing",
  account: ACCOUNT,
  chain: "STEEM-internal-market",
  real: true,
  armed: openNow > 0, // נמדד מהספר: יש פקודות חיות שלנו על הקו
  verdict: openNow > 0 ? "ARMED-LIVE" : blocker.length ? "ARMED-WAITING" : "ARMED-STABLE",
  blocker: blocker.length ? blocker : null,
  policy: {
    principle: "never sell STEEM below its external USD value; every buy below parity is measured surplus",
    commitPct: COMMIT_PCT, bidLevels: BID_LEVELS, bidStepBps: 200,
    askLevels: ASK_LEVELS, askStepBps: 50, expiryDays: 27,
    directiveR24: "powerdown is read-only here: never opened, never replaced, fleet RC is sacred",
  },
  marks: { steemUsd, sbdUsd, paritySbdPerSteem: parity, sources: marks.sources },
  fuel: {
    powerdownActive: snap.powerdown.active,
    weeklySp: snap.powerdown.weeklySp,
    weeklyUsd: snap.powerdown.weeklySp != null && steemUsd != null ? Math.round(snap.powerdown.weeklySp * steemUsd * 100) / 100 : null,
    remainingSp: snap.powerdown.remainingSp,
    remainingWeeks: snap.powerdown.remainingWeeks,
    nextPayout: snap.powerdown.nextPayout,
    rcFuelSp: snap.powerdown.rcFuelSp,
  },
  inventory: { steem: snap.balances.steem, sbd: snap.balances.sbd },
  book: snap.book,
  openOrdersNow: openNow,
  run: {
    placed: 0, cancelled: 0, // הסוכן הזה לא חותם ולא משדר — אף-פעם
    observedPlacements, observedCancellations, observedFills, // מה שנצפה על השרשרת במחזור הזה
    placedTotal, cancelledTotal, filledTotal,
    note: "keyless measurement cycle: on-chain placements/cancellations are the R81 mover's (via /api/money, key derived in-run only); this agent observes and counts, signs nothing",
  },
  externalFlowUsd,
  fills: fillsLedger.slice(-12),
  orders: ordersLedger.slice(-24),
  honesty: "מדוד מול ספר-STEEM הציבורי ופידי-USD חיים. מילויים מסומנים בזמן-הגילוי (marked-at-detection); המעקה מתעד את הציון שנמדד. ה-SBD הפנימי נסחר בפרימיום מול הציון החיצוני; קו-הזהות מוצג בגלוי כדי שכל אחד יוכל לאמת שאנחנו לא מוכרים מתחת לערך. סוכן זה חסר-מפתחות מהיסוד: אין לו יכולת שידור, ולכן שום נתון כאן אינו תלוי בסוד כלשהו.",
};

writeFileSync(OUT_PATH, JSON.stringify(doc, null, 1) + "\n");

console.log(`[grid-pulse] published ${OUT_PATH} · verdict=${doc.verdict} · openOrdersNow=${openNow} · parity=${parity != null ? parity.toFixed(6) : "?"} · bestBid=${snap.book.bestBid ?? "?"}`);
console.log(`[grid-pulse] cycle: observed placements=${observedPlacements} cancellations=${observedCancellations} fills=${observedFills} · totals: placed=${placedTotal} cancelled=${cancelledTotal} filled=${filledTotal}`);
if (blocker.length) console.log(`[grid-pulse] honest blockers: ${blocker.join(" | ")}`);
