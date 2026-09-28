// TRIGGER-MESH — מנוע "דבר גורר דבר" של הרשת · R130
//
// דבר-המפעיל שיצר את הסוכן הזה (2026-09-28): "צריך הנדסית דרך כלי הרשת
// ועוד כלים נוספים דרך גרידים ומכשירי DeFi חדשניים לייצר רשת של דבר
// גורר דבר אשר מייצרת לעצמה טריגרים. הטריגרים מריצים את כל המערכת."
//
// התשובה הריבונית — אותו עיקרון של grid-pulse (R83), הרחבה אחת צעד:
//   · אפס מפתחות מהיסוד — הסוכן קורא פרסומים פומביים (dex/*.json,
//     status.json) וספר-כללים גלוי (triggers/registry.json); כל מספר
//     ניתן לחישוב-מחדש על-ידי כל אחד.
//   · הוא לא מבצע ולא חותם — הוא מדליק. מי שמבצע: הסוכנים הקיימים
//     (grid-pulse / money-mover† / keeper / publisher). † = שער-מפעיל.
//   · כנות: כלל שנדלק נושא ראיה (מקור+שדה+ערך+סף+זמן). כלל שלא נדלק
//     לא נעלם — נרשם כ-WAIT בספר. מקור רקוב/חסר הוא טריגר בפני עצמו.
//   · המשכיות: קירור (cooldown) ותמונת-ערכים קודמת נשמרים ב-triggers/
//     state.json; היסטוריה append-only ב-triggers/log.jsonl — בדיוק
//     כמו המונים הממשיכים של grid-pulse.
//
// סוגי-כלל נתמכים (מפורשים, בלי eval, בלי קסם):
//   gt | lt | gte | lte      — השוואה סקלרית לסף
//   age_hours                — גיל הפרסום של המקור מול סף שעות
//   array_len_gt             — אורך מערך מול סף (למשל הפקדות חדשות)
//   diff_bps_gt              — סטייה ב-bps מול הערך שנמדד בריצה הקודמת
//
// צריכה: כל סוכן מבצע קורא triggers/current.json בתחילת ריצתו
// (תביעה Z-5 פתוחה למי שחובר ראשון). השרשרת היא השופטת.

import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";

const REGISTRY_PATH = process.env.TRIGGERS_REGISTRY || "triggers/registry.json";
const CURRENT_PATH = process.env.TRIGGERS_CURRENT || "triggers/current.json";
const LOG_PATH = process.env.TRIGGERS_LOG || "triggers/log.jsonl";
const STATE_PATH = process.env.TRIGGERS_STATE || "triggers/state.json";
const SOURCE_MAX_AGE_H = 36; // מעבר לזה — מקור נחשב רקוב (כנות, לא חסד)

const nowIso = () => new Date().toISOString();
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function loadJson(p) {
  if (!existsSync(p)) return { __missing: true };
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return { __corrupt: true };
  }
}

function get(d, path) {
  const parts = String(path).split(".");
  let cur = d;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

function ageHours(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 3600000;
}

function main() {
  const registry = loadJson(REGISTRY_PATH);
  const state = loadJson(STATE_PATH);
  const cooldowns = state.cooldowns || {};
  const lastValues = state.lastValues || {};
  const fired = [];
  const waited = [];
  const broken = [];

  if (registry.__missing || registry.__corrupt || !Array.isArray(registry.rules)) {
    broken.push({ id: "T-REGISTRY", reason: registry.__missing ? "missing" : "corrupt" });
  } else {
    for (const rule of registry.rules) {
      const src = loadJson(rule.source);
      if (src.__missing || src.__corrupt) {
        broken.push({ id: rule.id, reason: src.__missing ? "source-missing" : "source-corrupt", source: rule.source });
        continue;
      }
      // בריאות-מקור: פרסום רקוב מדווח — שקיפות לפני כל כלל אחר
      const pubAge = ageHours(get(src, rule.publishedAtField || "publishedAt"));
      if (pubAge !== null && pubAge > SOURCE_MAX_AGE_H) {
        broken.push({ id: "T-SOURCE-STALE", source: rule.source, ageHours: Math.round(pubAge * 10) / 10 });
      }

      const raw = get(src, rule.field);
      let value = null;
      let hit = false;

      switch (rule.type) {
        case "age_hours":
          value = pubAge;
          hit = value !== null && num(rule.threshold) !== null && value > rule.threshold;
          break;
        case "array_len_gt": {
          const arr = Array.isArray(raw) ? raw : null;
          value = arr ? arr.length : null;
          hit = value !== null && value > num(rule.threshold);
          break;
        }
        case "gt": case "lt": case "gte": case "lte": {
          value = num(raw);
          if (value === null || num(rule.threshold) === null) break;
          hit =
            (rule.type === "gt" && value > rule.threshold) ||
            (rule.type === "lt" && value < rule.threshold) ||
            (rule.type === "gte" && value >= rule.threshold) ||
            (rule.type === "lte" && value <= rule.threshold);
          break;
        }
        case "diff_bps_gt": {
          const cur = num(raw);
          const prev = num(lastValues[rule.id]);
          value = cur;
          if (cur === null || prev === null || prev === 0) { hit = false; break; }
          const bps = Math.abs(cur - prev) / prev * 10000;
          value = Math.round(bps * 10) / 10; // מדווח ב-bps
          hit = bps > num(rule.threshold);
          break;
        }
        default:
          broken.push({ id: rule.id, reason: "unsupported-type", type: rule.type });
          continue;
      }

      if (rule.type === "diff_bps_gt" && num(raw) !== null) {
        lastValues[rule.id] = num(raw); // תמונה לריצה הבאה — גם אם לא ירה
      }

      const cd = cooldowns[rule.id] || 0;
      const cooled = (Date.now() - cd) / 1000 >= (rule.cooldownSeconds || 3600);
      const entry = {
        id: rule.id,
        consumer: rule.consumer,
        source: rule.source,
        field: rule.field,
        value: typeof value === "number" ? Math.round(value * 1e6) / 1e6 : value ?? null,
        threshold: rule.threshold,
        at: nowIso(),
      };

      if (hit && cooled) {
        fired.push({ ...entry, status: "FIRED", evidence: `${rule.source}#${rule.field}=${entry.value} vs ${rule.threshold}` });
        cooldowns[rule.id] = Date.now();
      } else if (hit && !cooled) {
        waited.push({ ...entry, status: "FIRED_COOLDOWN" });
      } else {
        waited.push({ ...entry, status: "WAIT" });
      }
    }
  }

  const out = {
    ok: broken.length === 0 ? true : fired.length > 0,
    publishedAt: nowIso(),
    engine: "trigger-mesh v1.0.0 (R130, keyless)",
    rulesTotal: Array.isArray(registry.rules) ? registry.rules.length : 0,
    fired,
    waited,
    broken,
    doctrine: "שום טריגר בלי ראיה · טריגר שלא הופעל נרשם WAIT · אפס מפתחות",
  };

  writeFileSync(CURRENT_PATH, JSON.stringify(out, null, 2) + "\n");
  appendFileSync(LOG_PATH, JSON.stringify({ at: out.publishedAt, fired: fired.map((f) => f.id), broken: broken.map((b) => b.id) }) + "\n");
  writeFileSync(STATE_PATH, JSON.stringify({ cooldowns, lastValues }, null, 2) + "\n");

  console.log(`[trigger-mesh] rules=${out.rulesTotal} fired=${fired.length} waited=${waited.length} broken=${broken.length}`);
  for (const f of fired) console.log(`  FIRED ${f.id} → ${f.consumer} · ${f.evidence}`);
  for (const b of broken) console.log(`  BROKEN ${b.id || JSON.stringify(b)}`);
}

main();
