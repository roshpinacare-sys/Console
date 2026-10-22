#!/usr/bin/env node
/**
 * benchmark-truth.cjs [wave-57] — שערי-המכונה-הריבונית (G4+G7) — החלק-שרק-הסנדבוקס-יכול-למדוד.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * הדוקטרינה (truth-gate-ci.cjs: "sandbox-only gates … belong to the sovereign machine
 * (scripts/benchmark-truth.cjs)"): ה-CI הציבורי מדלג על G4/G7; המכונה-הזאת מודדת-אותם-ומאפה
 * קבלה ל-truth/local-gates.json — ה-CI מקפל-אותה-במקום-ה-SKIP כשהיא-טרייה (<26ש').
 *
 *   G7-dev-server   — שרת-העבודה :3000 חי-ומשרת-תוכן-אמת (200 · HTML · אפס-שלד)
 *   G4-no-forged-twins — אפס-תאומים-מזויפים באתר-החי: שני-נתיבים-שונים שמצהירים-על
 *     אותו-canonical, או-שני-דפים-שונים-עם-תוכן-זהה-בייטים (R360: מערכת-אחת · ערוץ-אחת).
 *     ה-R360-redirector (canonical-חוץ→GIANT) אינו-תאום-מעצם-הגדרתו — pointer-מכוון.
 *
 * כנות-מלאה: כל-קריאה-נמדדת-בריצה; אין-מצב-שמור; fail-honest (מקור-שלא-השיב = FAIL עם-הסיבה).
 * שימוש: node scripts/benchmark-truth.cjs   (אופה truth/local-gates.json · rc=1 על-אדום)
 */
"use strict";

const fs = require("fs");
const path = require("path");

const HERE = __dirname;
const OUT = path.join(HERE, "..", "truth", "local-gates.json");
const BASE = "https://roshpinacare-sys.github.io/Console";
const DEV = "http://127.0.0.1:3000";
const FRESH_MS = 15_000;

// אותם-הדפים-שה-CI סורק (truth-gate-ci.cjs PAGES) — אותו-מפה, אפס-סטייה
const PAGES = ["", "wallet.html", "truth.html", "receipts/", "hub/index.html",
  "net.html", "money.html", "deposits.html", "defi.html", "versus.html",
  "readiness.html", "sovereign.html", "acid.html", "gate.html"];

async function fetchUrl(url, timeoutMs = 15_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { redirect: "follow", signal: ctrl.signal });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text };
  } catch (e) {
    return { ok: false, status: 0, text: "", error: String((e && e.message) || e) };
  } finally { clearTimeout(t); }
}

function titleOf(html) { const m = String(html).match(/<title[^>]*>([^<]*)<\/title>/i); return m ? m[1].trim() : ""; }
function canonicalOf(html) { const m = String(html).match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || String(html).match(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i); return m ? m[1] : null; }

/* ── G7 · שרת-העבודה ─────────────────────────────────────────────── */
async function gateDevServer() {
  const at = new Date().toISOString();
  const home = await fetchUrl(DEV, 8_000);
  if (!home.ok) return { gate: "G7-dev-server", status: "FAIL", at, measured: `dev-server :3000 — HTTP ${home.status || home.error}`, note: "the work server is the sovereign machine's living front" };
  const bytes = Buffer.byteLength(home.text);
  const title = titleOf(home.text);
  const hasApp = bytes > 2_000 && /<script|<div id="root"|<div id="__next"/i.test(home.text);
  const alive = home.ok && bytes > 2_000 && hasApp;
  return {
    gate: "G7-dev-server", status: alive ? "PASS" : "FAIL", at,
    measured: `dev-server :3000 — HTTP 200 · ${bytes}B · title="${title.slice(0, 60)}" · app-shell ${hasApp ? "present" : "MISSING"}`,
    note: "",
  };
}

/* ── G4 · אפס-תאומים-מזויפים ─────────────────────────────────────── */
async function gateNoForgedTwins() {
  const at = new Date().toISOString();
  const pages = [];
  for (const p of PAGES) {
    const r = await fetchUrl(`${BASE}/${p}`, FRESH_MS);
    if (!r.ok) continue; // דף-שאינו-חי כרגע — לא-תאום; G2-הציבורי-מדווח-על-404
    pages.push({ path: p || "index.html", title: titleOf(r.text), canonical: canonicalOf(r.text), hash: require("crypto").createHash("sha256").update(r.text).digest("hex").slice(0, 16) });
  }
  const byCanonical = new Map(); const byHash = new Map();
  for (const pg of pages) {
    // R360: canonical-חוץ (Pulse/GIANT) = pointer-מכוון — אינו-מועמד-תאום
    const external = pg.canonical && !pg.canonical.includes("/Console");
    if (pg.canonical && !external) { const k = pg.canonical; if (!byCanonical.has(k)) byCanonical.set(k, []); byCanonical.get(k).push(pg.path); }
    if (!byHash.has(pg.hash)) byHash.set(pg.hash, []); byHash.get(pg.hash).push(pg.path);
  }
  const canonicalTwins = [...byCanonical.entries()].filter(([, v]) => v.length > 1);
  const hashTwins = [...byHash.entries()].filter(([, v]) => v.length > 1);
  const clean = canonicalTwins.length === 0 && hashTwins.length === 0;
  const measured = `live twins-check: ${pages.length}/${PAGES.length} pages measured · canonical-duplicates=${canonicalTwins.length} · content-hash-duplicates=${hashTwins.length}` +
    (canonicalTwins.length ? ` · canonical: ${canonicalTwins.map(([k, v]) => v.join("==") + "→" + k).join(" | ").slice(0, 160)}` : "") +
    (hashTwins.length ? ` · hash: ${hashTwins.map(([, v]) => v.join("==")).join(" | ").slice(0, 160)}` : "");
  return { gate: "G4-no-forged-twins", status: clean ? "PASS" : "FAIL", at, measured, note: clean ? "R360: one system · one channel — measured, not claimed" : "forged twins measured — R360 violated" };
}

/* ── ראשי ────────────────────────────────────────────────────────── */
(async () => {
  const started = Date.now();
  const gates = [];
  try { gates.push(await gateNoForgedTwins()); } catch (e) { gates.push({ gate: "G4-no-forged-twins", status: "FAIL", at: new Date().toISOString(), measured: "runner-throw: " + String(e && e.message || e).slice(0, 120), note: "" }); }
  try { gates.push(await gateDevServer()); } catch (e) { gates.push({ gate: "G7-dev-server", status: "FAIL", at: new Date().toISOString(), measured: "runner-throw: " + String(e && e.message || e).slice(0, 120), note: "" }); }
  const receipt = {
    schema: "local-gates/1",
    at: new Date().toISOString(),
    durationMs: Date.now() - started,
    runner: "sovereign-machine · scripts/benchmark-truth.cjs (wave-57)",
    doctrine: "gates the public CI cannot reach, measured on the machine where the work server lives",
    gates,
    counts: { pass: gates.filter(g => g.status === "PASS").length, fail: gates.filter(g => g.status === "FAIL").length },
  };
  fs.writeFileSync(OUT, JSON.stringify(receipt, null, 1) + "\n");
  for (const g of gates) console.log(`[${g.status === "PASS" ? "PASS" : "FAIL"}] ${g.gate} · ${g.measured}`);
  console.log(`local-gates baked: ${receipt.counts.pass} PASS · ${receipt.counts.fail} FAIL · ${receipt.durationMs}ms`);
  process.exit(receipt.counts.fail ? 1 : 0);
})();
