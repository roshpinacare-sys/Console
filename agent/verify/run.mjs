#!/usr/bin/env node
// AGENT-VERIFY - הרשת מאמתת את הסוכן (Task 6)
//
// המאמת העצמאי של הרשת: קורא את assertions.json שלצידו, מודד את האתר
// החי הציבורי (לא את הריפו), וכותב את results.json לצידו. זרימת האמת:
// בקשה, בנייה, הרשת מודדת, תוצאה ציבורית.
//
// Zero dependencies, Node 20+ (global fetch). Doctrine: "no claim without
// measurement" - and results are data, never a crash: the exit code is
// always 0 and every failure is recorded honestly in the results file.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSERTIONS_PATH = join(HERE, "assertions.json");
const RESULTS_PATH = join(HERE, "results.json");
const FETCH_TIMEOUT_MS = 20_000;

const startedAt = Date.now();
const runBy = process.env.GITHUB_ACTIONS === "true" ? "github-actions" : "local";
const cacheBust = String(startedAt); // one cache-buster per run: one coherent snapshot

// ── Load the contract ────────────────────────────────────────────────────────
// Missing / broken assertions.json is an honest empty run (NO_ASSERTIONS),
// never a crash.
function loadAssertions() {
  try {
    const parsed = JSON.parse(readFileSync(ASSERTIONS_PATH, "utf8"));
    const list = Array.isArray(parsed?.assertions) ? parsed.assertions : null;
    if (!list) return { ok: false, reason: "assertions.json has no assertions array" };
    let baseUrl = String(parsed.baseUrl ?? "");
    if (baseUrl && !baseUrl.endsWith("/")) baseUrl += "/"; // relative targets need the trailing slash
    return { ok: true, baseUrl, assertions: list };
  } catch (err) {
    return { ok: false, reason: `cannot read assertions.json: ${err?.message ?? err}` };
  }
}

// ── Fetch layer ──────────────────────────────────────────────────────────────
// Each unique target is fetched once per run (with the run's cache-buster)
// so all assertions against the same document see identical bytes.
const fetchCache = new Map(); // target -> { status, body, error }

async function fetchTarget(baseUrl, target) {
  if (fetchCache.has(target)) return fetchCache.get(target);
  let entry;
  try {
    const url = new URL(target, baseUrl);
    url.searchParams.set("t", cacheBust); // ?t=<ms> - break the CDN cache
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const body = await res.text();
    entry = { status: res.status, body, error: null };
  } catch (err) {
    entry = { status: 0, body: "", error: err?.message ?? String(err) };
  }
  fetchCache.set(target, entry);
  return entry;
}

// ── Dotted-path resolver ─────────────────────────────────────────────────────
// "agents.length" on { agents: [...] } resolves to the array length;
// any other segment walks object keys. Returns { found, value } so callers
// can report an honest "missing" instead of a silent undefined.
function resolvePath(root, dotted) {
  let cur = root;
  for (const seg of String(dotted ?? "").split(".")) {
    if (seg === "") continue;
    if (Array.isArray(cur) && seg === "length") { cur = cur.length; continue; }
    if (cur === null || typeof cur !== "object" || !(seg in cur)) {
      return { found: false, value: undefined };
    }
    cur = cur[seg];
  }
  return { found: true, value: cur };
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

// ── Assertion evaluator ──────────────────────────────────────────────────────
// Returns { id, ok, details }. Every branch ends in an honest details string.
async function evaluate(a, baseUrl) {
  const id = a?.id ?? "?";
  if (!a || typeof a !== "object") return { id, ok: false, details: "invalid assertion: not an object" };
  if (typeof a.kind !== "string") return { id, ok: false, details: "invalid assertion: kind is missing" };

  const target = a.target ?? "";
  const res = await fetchTarget(baseUrl, target);

  if (res.error) return { id, ok: false, details: `fetch failed: ${res.error}` };

  switch (a.kind) {
    case "http_ok": {
      if (res.status !== 200) return { id, ok: false, details: `HTTP ${res.status}, expected 200` };
      return { id, ok: true, details: "HTTP 200" };
    }

    case "contains": {
      const found = res.body.includes(String(a.value ?? ""));
      return {
        id, ok: found,
        details: found
          ? `"${a.value}" found in body`
          : `"${a.value}" not found in body (${res.body.length} bytes fetched)`,
      };
    }

    case "contains_min": {
      const n = countOccurrences(res.body, String(a.value ?? ""));
      const min = Number(a.min);
      if (!Number.isFinite(min)) return { id, ok: false, details: `invalid assertion: min is not a number` };
      return { id, ok: n >= min, details: `${n} occurrence(s) of "${a.value}", minimum is ${min}` };
    }

    case "json_field":
    case "json_min": {
      let json;
      try {
        json = JSON.parse(res.body);
      } catch (err) {
        return { id, ok: false, details: `target is not valid JSON: ${err?.message ?? err}` };
      }
      const { found, value } = resolvePath(json, a.field);
      if (!found) return { id, ok: false, details: `field "${a.field}" is missing` };

      if (a.kind === "json_field") {
        const ok = String(value) === String(a.value);
        return { id, ok, details: `field "${a.field}" = ${JSON.stringify(value)}, expected ${JSON.stringify(a.value)}` };
      }

      // json_min: value must be a real number - null/boolean/empty do not count.
      if (value === null || typeof value === "boolean" || (typeof value === "string" && value.trim() === "")) {
        return { id, ok: false, details: `field "${a.field}" = ${JSON.stringify(value)} is not numeric` };
      }
      const num = Number(value);
      if (!Number.isFinite(num)) {
        return { id, ok: false, details: `field "${a.field}" = ${JSON.stringify(value)} is not numeric` };
      }
      const min = Number(a.min);
      if (!Number.isFinite(min)) return { id, ok: false, details: `invalid assertion: min is not a number` };
      return { id, ok: num >= min, details: `${a.field} = ${num}, minimum is ${min}` };
    }

    case "regex_absent": {
      let re;
      try {
        re = new RegExp(a.regex, a.flag || "u");
      } catch (err) {
        return { id, ok: false, details: `invalid regex: ${err?.message ?? err}` };
      }
      const first = res.body.match(re);
      if (!first) return { id, ok: true, details: "pattern not found in body (0 matches)" };
      const global = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      const total = [...res.body.matchAll(global)].length;
      return { id, ok: false, details: `pattern matched ${total} time(s), first match ${JSON.stringify(first[0])}` };
    }

    default:
      return { id, ok: false, details: `unknown kind: ${a.kind}` };
  }
}

// ── Output ───────────────────────────────────────────────────────────────────
function writeResults(payload) {
  writeFileSync(RESULTS_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

function emptyResults(note, durationMs) {
  return {
    format: "agent-verify-results-v1",
    generatedAt: new Date().toISOString(),
    runBy,
    durationMs,
    summary: { total: 0, passed: 0, failed: 0, verdict: "NO_ASSERTIONS" },
    results: [],
    note,
  };
}

function printTable(payload) {
  const { summary, results } = payload;
  const idW = Math.max(2, ...results.map((r) => String(r.id).length), 2);
  console.log(`agent-verify · ${payload.generatedAt} · runBy ${payload.runBy} · ${payload.durationMs} ms`);
  console.log(`${"ID".padEnd(idW)}  RESULT    MS     DETAILS`);
  for (const r of results) {
    const mark = r.ok ? "PASS" : "FAIL";
    console.log(`${String(r.id).padEnd(idW)}  ${mark.padEnd(8)}  ${String(r.ms).padStart(5)}  ${r.details}`);
  }
  if (payload.note) console.log(`note: ${payload.note}`);
  console.log("");
  console.log(`VERDICT: ${summary.verdict} · passed ${summary.passed}/${summary.total} · failed ${summary.failed}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const loaded = loadAssertions();
  if (!loaded.ok) {
    const payload = emptyResults(loaded.reason, Date.now() - startedAt);
    writeResults(payload);
    printTable(payload);
    return;
  }

  const results = [];
  for (const a of loaded.assertions) {
    const t0 = Date.now();
    const r = await evaluate(a, loaded.baseUrl);
    results.push({ id: r.id, ok: r.ok, details: r.details, ms: Date.now() - t0 });
  }

  const total = results.length;
  const passed = results.filter((r) => r.ok).length;
  const failed = total - passed;
  const verdict = total === 0 ? "NO_ASSERTIONS" : failed === 0 ? "ALL_PASS" : "HAS_FAILURES";

  const payload = {
    format: "agent-verify-results-v1",
    generatedAt: new Date().toISOString(),
    runBy,
    durationMs: Date.now() - startedAt,
    summary: { total, passed, failed, verdict },
    results,
  };
  writeResults(payload);
  printTable(payload);
}

// Last-resort honesty: an unexpected crash still writes a results file and
// exits 0. Results are data, not a crash.
main().catch((err) => {
  const payload = emptyResults(`verifier crashed: ${err?.stack ?? err}`, Date.now() - startedAt);
  try { writeResults(payload); } catch { /* nothing more we can honestly do */ }
  printTable(payload);
});
