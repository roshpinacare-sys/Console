// KEY-VERIFY — בדיקת מפתח-המפעיל שהוזן בגיטהאב (R38).
//
// רקע: המפעיל הוסיף בעצמו סוד בשם HEADCORNER לכספת של ריפו-הקונסולה
// (GitHub → Settings → Secrets). רק Actions של הריפו הזה יכולים לקרוא
// אותו — ולכן סוכן זה חי כאן. הוא עושה שלושה דברים, בכנות מלאה:
//
//   1. בודק מה באמת הוזן: מפתח-ציבורי בטעות? ה-posting במקום ה-active?
//      WIF או סיסמת-אב — הכל נגזר עם הקריפטו הריבוני (gate-crypto.js).
//   2. משווה ביט-מול-ביט מול הרשויות החיות של @headcorner בשרשרת Steem.
//   3. אם ורק אם יש התאמה מלאה ל-active — מאטם את ה-WIF (libsodium
//      sealed-box ממפתח-הציבורי של ריפו-המנוע) אל כספת saos-dex בתור
//      STEEM_ACTIVE_WIF, ומזניק את הגריד החוץ (dex-grid).
//
// דוקטרינה: ערך-הסוד לעולם לא נכתב לדיסק, לא ללוג ולא לקבלה. מתפרסם
// רק פסק-דין, מפתח-ציבורי נגזר (מידע ציבורי ממילא) וחותמות-זמן.
// אי-התאמה = שום דבר לא נכתב לשום כספת.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import Gate from "../gate-crypto.js";

const OWNER = "roshpinacare-sys";
const ACCOUNT = "headcorner";
const DEX_REPO = "saos-dex";
const SECRET_NAME = "STEEM_ACTIVE_WIF";
const SOURCE_SECRET = "HEADCORNER";
const GH_API = "https://api.github.com";
const STEEM_RPC = "https://api.steemit.com";

const value = (process.env.HEADCORNER || "").trim();
const relayToken = (process.env.AGENTS_WATCH_TOKEN || "").trim();
const sodiumDir = process.env.SODIUM_DIR || "/tmp/sodium";
const sodium = createRequire(path.join(sodiumDir, "probe.cjs"))("libsodium-wrappers");

// ── הקבלה: מה שהעולם רואה. אף-פעם לא ערך-הסוד ────────────────────────

const receipt = {
  format: "saos/key-check/1",
  generatedAt: new Date().toISOString(),
  source: { repo: "Console", secret: SOURCE_SECRET },
  target: { repo: DEX_REPO, secret: SECRET_NAME },
  account: ACCOUNT,
  verdict: "unknown",
  detail: "",
};

function writeReceipt() {
  mkdirSync(path.join(process.cwd(), "receipts"), { recursive: true });
  writeFileSync(
    path.join(process.cwd(), "receipts", "key-check.json"),
    JSON.stringify(receipt, null, 2) + "\n"
  );
  const logPath = path.join(process.cwd(), "receipts", "key-check-log.jsonl");
  const prev = existsSync(logPath) ? readFileSync(logPath, "utf8").trimEnd() : "";
  writeFileSync(logPath, (prev ? prev + "\n" : "") + JSON.stringify(receipt) + "\n");
  console.log(
    `[key-verify] receipt → receipts/key-check.json · verdict=${receipt.verdict}`
  );
}

function fail(verdict, detail) {
  receipt.verdict = verdict;
  receipt.detail = detail;
  writeReceipt();
  console.error(`[key-verify] ✗ ${verdict}: ${detail}`);
  process.exit(1);
}

// ── GitHub API ────────────────────────────────────────────────────────

async function gh(pathname, method = "GET", body = null, expect = 200) {
  const res = await fetch(`${GH_API}${pathname}`, {
    method,
    headers: {
      Authorization: `token ${relayToken}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "key-verify/1.0",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== expect) {
    throw new Error(`gh ${method} ${pathname} → ${res.status}: ${(await res.text()).slice(0, 120)}`);
  }
  return res.status === 204 || method === "POST" ? null : res.json();
}

// ── השרשרת החיה ──────────────────────────────────────────────────────

async function chainAuthorities() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(STEEM_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "condenser_api.get_accounts",
          params: [[ACCOUNT]],
        }),
      });
      if (!r.ok) throw new Error(`http-${r.status}`);
      const j = await r.json();
      const a = j && j.result && j.result[0];
      const active = a?.active?.key_auths?.[0]?.[0];
      if (!active) throw new Error("active-not-readable");
      return {
        active: String(active),
        posting: a?.posting?.key_auths?.[0]?.[0]
          ? String(a.posting.key_auths[0][0])
          : null,
        owner: a?.owner?.key_auths?.[0]?.[0]
          ? String(a.owner.key_auths[0][0])
          : null,
        memo: a?.memo_key ? String(a.memo_key) : null,
      };
    } catch (e) {
      if (attempt === 3) fail("chain-unreadable", `קריאת השרשרת נכשלה: ${String(e.message).slice(0, 80)}`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

// ── ראשי ──────────────────────────────────────────────────────────────

async function main() {
  await sodium.ready;
  console.log(`[key-verify] boot · reading ${SOURCE_SECRET} from this repo's vault only`);

  if (!value) fail("no-secret", `הסוד ${SOURCE_SECRET} לא סופק לריצה — אין מה לבדוק`);

  // אבחון קלט-שגוי הנפוץ ביותר: הדבקת מפתח-ציבורי במקום פרטי
  if (/^STM[1-9A-HJ-NP-Za-km-z]{40,}/.test(value)) {
    fail(
      "not-a-private-key",
      "הערך שהוזן נראה כמפתח-ציבורי (STM…) — הסוד צריך להכיל את ה-WIF הפרטי (מתחיל ב-5/K/L) או סיסמת-אב של Steemit"
    );
  }

  // גזירה ריבונית: WIF ישירות, אחרת סיסמת-אב (תקן Steemit)
  let wif = "";
  let pub = "";
  try {
    const d = await Gate.deriveAny(value, ACCOUNT, "active");
    wif = d.wif;
    pub = d.pub;
  } catch (e) {
    fail("derive-failed", `לא הצלחתי לגזור מפתח מהערך (checksum/פורמט): ${String(e.message).slice(0, 80)}`);
  }
  receipt.derivedPublicKey = pub;
  console.log(`[key-verify] derived pub ${pub.slice(0, 12)}…`);

  // הרשויות החיות מהשרשרת
  const chain = await chainAuthorities();
  receipt.chainActive = chain.active;

  if (chain.posting && pub === chain.posting) {
    fail(
      "posting-key",
      `המפתח שהוזן הוא ה-posting של @${ACCOUNT} (משמש לעיגון/כניסה לאתר) — הגריד דורש את ה-active (WIF)`
    );
  }
  if (chain.owner && pub === chain.owner) {
    fail(
      "owner-key",
      `המפתח שהוזן הוא ה-owner של @${ACCOUNT} — מפתח-על שלא צריך לצאת מהכספת. הגריד דורש את ה-active`
    );
  }
  if (chain.memo && pub === chain.memo) {
    fail("memo-key", `המפתח שהוזן הוא ה-memo של @${ACCOUNT} — הגריד דורש את ה-active`);
  }
  if (pub !== chain.active) {
    fail(
      "authority-mismatch",
      `המפתח שהוזן אינו ה-active החי של @${ACCOUNT}. הנגזר: ${pub.slice(0, 12)}… · בשרשרת: ${chain.active.slice(0, 12)}… · שום דבר לא נכתב`
    );
  }

  // התאמה מלאה ← העברה לכספת-המנוע (sealed-box — רק ה-Actions של saos-dex יכולים לפתוח)
  if (!relayToken) {
    fail("no-relay-token", "המפתח אומת מול השרשרת ✓ אך AGENTS_WATCH_TOKEN חסר — לא בוצעה העברה");
  }

  const pk = await gh(`/repos/${OWNER}/${DEX_REPO}/actions/secrets/public-key`).catch((e) => {
    fail("relay-public-key", `קריאת מפתח-הציבורי של ריפו-המנוע נכשלה: ${String(e.message).slice(0, 90)}`);
  });
  const keyId = pk && pk.key_id;
  const keyB64 = pk && pk.key;

  const sealed = sodium.to_base64(
    sodium.crypto_box_seal(
      sodium.from_string(wif),
      sodium.from_base64(keyB64, sodium.base64_variants.ORIGINAL)
    ),
    sodium.base64_variants.ORIGINAL
  );
  await gh(`/repos/${OWNER}/${DEX_REPO}/actions/secrets/${SECRET_NAME}`, "PUT", {
    encrypted_value: sealed,
    key_id: keyId,
  }).catch((e) => {
    fail("relay-put", `האטימה אל כספת המנוע נדחתה: ${String(e.message).slice(0, 90)} — המפתח לא נשמר בשום מקום`);
  });

  // עדות: הסוד קיים בכספת, עם חותמת-זמן
  const list = await gh(`/repos/${OWNER}/${DEX_REPO}/actions/secrets?per_page=100`).catch(() => null);
  const found = (list?.secrets || []).find((s) => s.name === SECRET_NAME);
  if (!found) {
    fail("relay-unverified", "ה-PUT התקבל אך הסוד לא נראה ברשימה — דוח כנה, לא מזויף");
  }
  receipt.relay = { repo: DEX_REPO, secret: SECRET_NAME, updatedAt: found.updated_at };

  // הזנקת הגריד (ריצה ראשונה מיידית; אי-הצלחה אינה פטל — ניתן להזניק ידנית)
  let dispatched = false;
  try {
    await gh(`/repos/${OWNER}/${DEX_REPO}/actions/workflows/dex-grid.yml/dispatches`, "POST", { ref: "main" });
    dispatched = true;
  } catch (e) {
    receipt.dispatchNote = String(e.message).slice(0, 90);
  }

  receipt.verdict = "armed";
  receipt.detail =
    "המפתח אומת ביט-מול-ביט מול ה-active החי של @" +
    ACCOUNT +
    " בשרשרת, ונאטם בכספת ריפו-המנוע (sealed-box). " +
    (dispatched ? "הגריד החוץ הוזנק לריצה ראשונה." : "ההזנקה הידנית זמינה במרכז הפיקוד.");
  writeReceipt();
  console.log(`[key-verify] ✓ ARMED · relay=${JSON.stringify(receipt.relay)} · dispatched=${dispatched}`);
}

void main();
