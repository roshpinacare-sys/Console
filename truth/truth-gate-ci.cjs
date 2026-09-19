#!/usr/bin/env node
/**
 * TRUTH-GATE (CI) - the machine that grades this public site, from Actions.
 *
 * Doctrine (BENCHMARK.md, stage 3): the system proves itself, without an
 * agent. This script runs on an hourly cadence inside the PUBLIC Console
 * repository (its own GITHUB_TOKEN, zero secrets) and measures the LIVE
 * deployed site - never the repo, never a local copy. Every verdict is
 * measured at run time; nothing here is written by hand.
 *
 * Output:
 *   truth/latest.json   - the full report of this run
 *   truth/history.json  - one line per run (capped, oldest pruned)
 * Exit code: 1 when any gate FAILs (the Actions run turns red in public).
 *
 * Gates measured from the public internet (CI-scope):
 *   G1 site-up · G2 zero-broken-links · G3 witness-freshness ·
 *   G5 live-format · G6 bridgehead-sane · G8 single-generation
 * Sandbox-only gates (G4 local twins, G7 dev server) are recorded as SKIP
 * with an explicit reason - they belong to the sovereign machine
 * (scripts/benchmark-truth.cjs), not to this CI runner.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const BASE = "https://roshpinacare-sys.github.io/Console";
const HERE = __dirname;
const LATEST_PATH = path.join(HERE, "latest.json");
const HISTORY_PATH = path.join(HERE, "history.json");
const HISTORY_CAP = 200;

// The one-generation doctrine (R58): these fronts belong to previous
// interface generations. They must serve permanent redirect stubs - nothing
// bigger, nothing linked from any current page.
const RETIRED = [
  "money.html", "net.html", "acid.html", "gate.html", "roast.html",
  "defi.html", "deposits.html", "readiness.html", "sovereign.html", "versus.html",
];
const STUB_MAX_BYTES = 2500;
const STUB_REDIRECT_TO = "/Console/";

// The current-generation pages the link sweep walks (the console SPA, the
// wallet, the truth gate, the receipt wall, and the content hub entry).
const PAGES = ["", "wallet.html", "truth.html", "receipts/", "hub/index.html"];

const FRESH_THRESHOLD_H = 26; // the same life doctrine render.mjs lives by
const FETCH_TIMEOUT_MS = 15000;

const startedAt = Date.now();
const results = [];
function record(gate, status, measured, note) {
  results.push({ gate, status, measured: String(measured), note: note || "", at: new Date().toISOString() });
  const sym = status === "PASS" ? "PASS" : status === "SKIP" ? "skip" : status;
  console.log(`[${sym}] ${gate} · ${measured}${note ? " — " + note : ""}`);
}

async function fetchUrl(url, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: "follow", signal: ctrl.signal });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (err) {
    return { ok: false, status: 0, text: "", error: String((err && err.message) || err) };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, timeoutMs) {
  const r = await fetchUrl(url, timeoutMs);
  if (!r.text) return r;
  try { r.json = JSON.parse(r.text); } catch { r.json = null; }
  return r;
}

function hoursBetween(a, b) { return Math.abs(new Date(b) - new Date(a)) / 36e5; }

(async () => {
  console.log(`truth-gate-ci · ${new Date().toISOString()} · target ${BASE}\n`);

  // ── G1: the public site is up ─────────────────────────────────────
  const home = await fetchUrl(BASE + "/");
  const homeBytes = home.text ? Buffer.byteLength(home.text) : 0;
  record("G1-site-up", home.ok ? "PASS" : "FAIL", `HTTP ${home.status} · ${homeBytes} bytes`);

  // ── G2: zero broken links across the current generation ───────────
  const broken = [], blocked = [];
  let checked = 0;
  const seen = new Set();
  for (const page of PAGES) {
    const pageUrl = page ? `${BASE}/${page}` : `${BASE}/`;
    const ph = page ? await fetchUrl(pageUrl) : home;
    if (!ph.ok || !ph.text) { if (page) broken.push(`${page} page itself → HTTP ${ph.status}`); continue; }
    const base = new URL(pageUrl);
    const hrefs = new Set();
    const re = /href="([^"]*)"/g; let m;
    while ((m = re.exec(ph.text)) !== null) hrefs.add(m[1]);
    for (const h of hrefs) {
      if (!h || h.startsWith("#") || h.startsWith("data:") || h.startsWith("javascript:") ||
          h.startsWith("mailto:") || h.startsWith("tel:")) continue;
      // inline-JS template fragments (href built by string concat) are code, not links
      if (h.includes(String.fromCharCode(39)) || h.includes("+") || h.includes("<")) continue;
      let url;
      try { url = new URL(h, base); } catch { continue; }
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      url.hash = "";
      const key = url.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      checked++;
      const r = await fetchUrl(key, 12000);
      // Same-origin: any non-200 is broken, full stop - we own it.
      // Third-party: 404 (and other 4xx) = definitively broken; 403/5xx/network-0
      // = undetermined (bot walls, origin hiccups) - not proven broken, not blessed.
      const sameOrigin = url.origin === base.origin;
      if (sameOrigin ? !r.ok : (r.ok ? false : !(r.status === 403 || r.status === 0 || r.status >= 500))) {
        broken.push(`${page || "(home)"}: ${h} → HTTP ${r.status}`);
      } else if (!sameOrigin && !r.ok) {
        blocked.push(`${page || "(home)"}: ${h} (${r.status})`);
      }
    }
  }
  record("G2-zero-broken-links",
    home.ok ? (broken.length === 0 ? "PASS" : "FAIL") : "SKIP",
    `${PAGES.length} pages · ${checked} links · ${broken.length} broken · ${blocked.length} undetermined`,
    broken.join(" | "));

  // ── G3: witness freshness on the deployed site ────────────────────
  const depStatus = await fetchJson(BASE + "/status.json");
  if (depStatus.json && depStatus.json.generatedAt) {
    const ageH = hoursBetween(depStatus.json.generatedAt, new Date());
    const thr = (depStatus.json.freshness && depStatus.json.freshness.thresholdHours) || 26;
    record("G3-witness-freshness", ageH <= thr ? "PASS" : "FAIL",
      `cp#${depStatus.json.witness && depStatus.json.witness.checkpoint} · att ${depStatus.json.witness && depStatus.json.witness.attestations} · age ${ageH.toFixed(1)}h (threshold ${thr}h)`);
  } else record("G3-witness-freshness", "FAIL", `status.json unreadable (HTTP ${depStatus.status})`);

  // ── G5: the reserved name means exactly one format ────────────────
  const depLive = await fetchJson(BASE + "/saos-live.json");
  if (depLive.json) {
    const ok = depLive.json.format === "saos-live-v1";
    record("G5-live-format-consistency", ok ? "PASS" : "FAIL",
      `public book format="${depLive.json.format}"${ok ? "" : " (expected saos-live-v1)"}`);
  } else record("G5-live-format-consistency", "FAIL", `saos-live.json unreadable (HTTP ${depLive.status})`);

  // ── G6: the bridgehead is present and sane ────────────────────────
  const bridge = await fetchJson(BASE + "/agent/state.json");
  if (bridge.json) {
    const ok = bridge.json.format === "agent-bridgehead-state-v1";
    record("G6-bridgehead-sane", ok ? "PASS" : "FAIL",
      `format="${bridge.json.format}"${bridge.json.currentTask ? " · phase task present" : " · no task"}`,
      ok ? "" : "expected agent-bridgehead-state-v1");
  } else record("G6-bridgehead-sane", "FAIL", `agent/state.json unreadable (HTTP ${bridge.status})`);

  // ── G8: one interface generation ──────────────────────────────────
  const stubFailures = [];
  for (const p of RETIRED) {
    const r = await fetchUrl(`${BASE}/${p}`);
    if (!r.ok || !r.text) { stubFailures.push(`${p}: HTTP ${r.status}`); continue; }
    const bytes = Buffer.byteLength(r.text);
    if (bytes > STUB_MAX_BYTES) { stubFailures.push(`${p}: ${bytes}B > ${STUB_MAX_BYTES}B`); continue; }
    if (!r.text.includes(`content="0; url=${STUB_REDIRECT_TO}"`)) { stubFailures.push(`${p}: no permanent refresh to ${STUB_REDIRECT_TO}`); continue; }
    if (!r.text.includes('rel="canonical"')) { stubFailures.push(`${p}: no canonical`); continue; }
  }
  const indexText = home.text || "";
  const retiredHrefs = RETIRED.filter(p => indexText.includes(`href="${p}"`));
  const truthLinked = indexText.includes('href="truth.html"');
  const sitemap = await fetchUrl(BASE + "/sitemap.xml");
  const retiredInSitemap = sitemap.ok && sitemap.text
    ? RETIRED.filter(p => sitemap.text.includes(`/${p}`)) : ["(sitemap unreadable)"];
  const g8ok = stubFailures.length === 0 && retiredHrefs.length === 0 && truthLinked && retiredInSitemap.length === 0;
  record("G8-single-generation", g8ok ? "PASS" : "FAIL",
    `${RETIRED.length} retired stubs · index retired-hrefs ${retiredHrefs.length} · truth linked ${truthLinked ? "yes" : "NO"} · sitemap retired ${retiredInSitemap.length === 1 && retiredInSitemap[0] === "(sitemap unreadable)" ? "?" : retiredInSitemap.length}`,
    [stubFailures.join(" | "), retiredHrefs.join(" | "), retiredInSitemap.join(" | ")].filter(Boolean).join(" || "));

  // ── sandbox-only gates: recorded honestly as SKIP ─────────────────
  record("G4-no-forged-twins", "SKIP", "sandbox-only (sovereign machine: scripts/benchmark-truth.cjs)");
  record("G7-dev-server", "SKIP", "sandbox-only (the work server is not public infrastructure)");

  // ── verdict ───────────────────────────────────────────────────────
  const pass = results.filter(r => r.status === "PASS").length;
  const fail = results.filter(r => r.status === "FAIL").length;
  const skip = results.filter(r => r.status === "SKIP").length;
  const verdict = fail === 0 ? "ALL-GREEN" : `${fail} RED`;

  const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null;

  const report = {
    format: "truth-gate-v1",
    runner: "github-actions",
    at: new Date().toISOString(),
    target: BASE,
    verdict,
    counts: { pass, fail, skip },
    durationMs: Date.now() - startedAt,
    runUrl,
    results,
  };
  fs.writeFileSync(LATEST_PATH, JSON.stringify(report, null, 2) + "\n");

  // history: append one line per run, cap the list, prune the oldest
  let history = { format: "truth-gate-history-v1", runs: [] };
  try { history = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8")); } catch { /* first run */ }
  if (!Array.isArray(history.runs)) history.runs = [];
  history.runs.push({ at: report.at, verdict, pass, fail, skip, runUrl });
  if (history.runs.length > HISTORY_CAP) history.runs = history.runs.slice(-HISTORY_CAP);
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + "\n");

  console.log(`\nVERDICT: ${verdict} · ${pass} PASS · ${fail} FAIL · ${skip} SKIP · ${report.durationMs}ms`);
  console.log(`wrote: truth/latest.json · truth/history.json (${history.runs.length} runs)`);
  process.exitCode = fail === 0 ? 0 : 1;
})().catch((err) => {
  console.error("truth-gate-ci crashed:", err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
