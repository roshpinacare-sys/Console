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

  // ── steem_priority: the R27 priority-inversion detector ──────────────
  // Keyless public-history read from a Steem RPC. If the core anchor op
  // is older than staleHours AND a newer non-core custom_json op from the
  // same account exists, the anchor's RC budget was consumed by a
  // lower-priority op: exactly the 2026-09-17 incident (genesis deploy +
  // mint fired while the anchor line waited and the network stayed STALE
  // for 32.7h). Independent of the Console target: the chain is a second
  // witness, not a page fetch.
  if (a.kind === "steem_priority") {
    const account = String(a.account ?? "cashmachine");
    const coreOp = String(a.coreOp ?? "saos.weave.core.v1");
    const staleHours = Number(a.staleHours ?? 26);
    if (!Number.isFinite(staleHours)) return { id, ok: false, details: "invalid assertion: staleHours is not a number" };
    const rpc = String(a.rpc ?? "https://api.steemit.com");
    let hist;
    try {
      const r = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "condenser_api.get_account_history", params: [account, -1, 100] }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const j = await r.json();
      hist = j?.result;
      if (!Array.isArray(hist)) return { id, ok: false, details: `rpc returned no history array (HTTP ${r.status})` };
    } catch (err) {
      return { id, ok: false, details: `rpc fetch failed: ${err?.message ?? err}` };
    }
    let coreTs = "";
    let nonCore = null;
    for (const [, entry] of hist) {
      const op = entry?.op;
      if (!op || op[0] !== "custom_json") continue;
      const body = op[1] ?? {};
      if (!Array.isArray(body.required_posting_auths) || !body.required_posting_auths.includes(account)) continue;
      const ts = String(entry.timestamp ?? "");
      if (!ts) continue;
      if (body.id === coreOp) {
        if (ts > coreTs) coreTs = ts;
      } else if (!nonCore || ts > nonCore.ts) {
        nonCore = { id: String(body.id ?? "?"), ts };
      }
    }
    if (!coreTs) return { id, ok: false, details: `core op ${coreOp} not found in last 100 ops of @${account}` };
    const coreAgeH = (Date.now() - Date.parse(coreTs + "Z")) / 3_600_000;
    if (coreAgeH <= staleHours) {
      return { id, ok: true, details: `core anchor ${coreAgeH.toFixed(1)}h old (fresh, <= ${staleHours}h)` };
    }
    if (nonCore && nonCore.ts > coreTs) {
      return { id, ok: false, details: `priority inversion: core ${coreAgeH.toFixed(1)}h stale while ${nonCore.id} fired later (${nonCore.ts}Z) and consumed the anchor budget` };
    }
    return { id, ok: true, details: `core anchor ${coreAgeH.toFixed(1)}h stale but no non-core op fired after it (honest starvation: RC regen, no inversion)` };
  }

  // ── oracle_drift: R28 truth anchor ──────────────────────────────────
  // The DEX oracle claims to track real markets. This detector makes it
  // prove it: reads the live world.json oracle, fetches a public keyless
  // price source (CoinGecko first, CoinPaprika and CryptoCompare as
  // honest fallbacks, mirroring the engine's own multi-source doctrine)
  // and fails when any ACTIVE asset drifts beyond maxDriftPct.
  // Legacy frozen keys (not in the assets map) are ignored by design.
  if (a.kind === "oracle_drift") {
    const maxDriftPct = Number(a.maxDriftPct ?? 5);
    const assets = a.assets && typeof a.assets === "object" ? a.assets : {};
    if (Object.keys(assets).length === 0) return { id, ok: false, details: "invalid assertion: assets map is empty" };
    let world;
    try {
      const r = await fetchTarget(baseUrl, a.target ?? "dex/world.json");
      world = JSON.parse(r.body);
    } catch (err) {
      return { id, ok: false, details: `cannot read world.json: ${err?.message ?? err}` };
    }
    const oracle = world?.state?.oracle;
    if (!oracle || typeof oracle !== "object") return { id, ok: false, details: "field state.oracle is missing" };

    const cgIds = [...new Set(Object.values(assets))];
    const PAPRIKA = { "steem": "steem-steem", "hive": "hive-hive", "steem-dollars": "sbd-steem-dollars", "solana": "sol-solana", "tron": "trx-tron", "ethereum": "eth-ethereum", "bitcoin": "btc-bitcoin" };
    const CCSYMS = { "steem": "STEEM", "hive": "HIVE", "steem-dollars": "SBD", "solana": "SOL", "tron": "TRX", "ethereum": "ETH", "bitcoin": "BTC" };

    async function tryFetchJson(url) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (!r.ok) return { error: `HTTP ${r.status}` };
        return { json: await r.json() };
      } catch (err) {
        return { error: err?.message ?? String(err) };
      }
    }

    let cg = null, provider = "", providerErrs = [];
    const invPaprika = {};
    for (const [gid, pid] of Object.entries(PAPRIKA)) invPaprika[pid] = gid;
    const cgRes = await tryFetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${cgIds.join(",")}&vs_currencies=usd&t=${cacheBust}`);
    if (cgRes.json && cgIds.some((id) => Number(cgRes.json?.[id]?.usd) > 0)) { cg = cgRes.json; provider = "coingecko"; }
    else {
      providerErrs.push(`coingecko:${cgRes.error ?? "no-prices"}`);
      const ppRes = await tryFetchJson(`https://api.coinpaprika.com/v1/tickers?quotes=USD&t=${cacheBust}`);
      if (Array.isArray(ppRes.json)) {
        const m = {};
        for (const t of ppRes.json) {
          const gid = invPaprika[t.id];
          if (gid) m[gid] = { usd: Number(t?.quotes?.USD?.price) };
        }
        if (cgIds.some((id) => Number(m?.[id]?.usd) > 0)) { cg = m; provider = "coinpaprika"; }
        else providerErrs.push("coinpaprika:no-prices");
      } else providerErrs.push(`coinpaprika:${ppRes.error ?? "no-array"}`);
      if (!cg) {
        const ccRes = await tryFetchJson(`https://min-api.cryptocompare.com/data/pricemulti?fsyms=${cgIds.map((id) => CCSYMS[id] ?? id).join(",")}&tsyms=USD&t=${cacheBust}`);
        if (ccRes.json && !ccRes.json.Response) {
          const invCc = {};
          for (const [gid, sym] of Object.entries(CCSYMS)) invCc[sym] = gid;
          const m = {};
          for (const [sym, v] of Object.entries(ccRes.json)) {
            const gid = invCc[sym];
            if (gid) m[gid] = { usd: Number(v?.USD) };
          }
          if (cgIds.some((id) => Number(m?.[id]?.usd) > 0)) { cg = m; provider = "cryptocompare"; }
          else providerErrs.push("cryptocompare:no-prices");
        } else providerErrs.push(`cryptocompare:${ccRes.error ?? "error-shape"}`);
      }
    }
    if (!cg) return { id, ok: false, details: `all price sources failed: ${providerErrs.join(", ")}` };

    const parts = [];
    let worstAbs = 0, worstName = "", compared = 0;
    for (const [asset, cgId] of Object.entries(assets)) {
      const mu = Number(oracle?.[asset]?.mu);
      const market = Number(cg?.[cgId]?.usd);
      if (!Number.isFinite(mu) || mu <= 0) { parts.push(`${asset}:no-oracle`); continue; }
      if (!Number.isFinite(market) || market <= 0) { parts.push(`${asset}:no-market`); continue; }
      const driftPct = ((mu / 1e6 - market) / market) * 100;
      compared++;
      parts.push(`${asset} ${driftPct >= 0 ? "+" : ""}${driftPct.toFixed(2)}%`);
      if (Math.abs(driftPct) > worstAbs) { worstAbs = Math.abs(driftPct); worstName = asset; }
    }
    if (compared === 0) return { id, ok: false, details: `no asset could be compared via ${provider} (oracle or market missing)` };
    const ok = worstAbs <= maxDriftPct;
    return { id, ok, details: `${compared} assets vs ${provider}: ${parts.join(", ")} · worst ${worstName} ${worstAbs.toFixed(2)}%, limit ${maxDriftPct}%` };
  }

  // ── retired_pages: R58 single-generation doctrine ──────────────────
  // A page retired from a previous interface generation must serve a
  // permanent redirect stub: HTTP 200, tiny, http-equiv refresh to the
  // console root, canonical present. Anything bigger or livelier is a
  // second-generation front coexisting with the current one (the exact
  // disease this detector refuses to bless).
  if (a.kind === "retired_pages") {
    const pages = Array.isArray(a.pages) ? a.pages : [];
    if (pages.length === 0) return { id, ok: false, details: "invalid assertion: pages list is empty" };
    const maxBytes = Number(a.maxBytes ?? 2500);
    const redirectTo = String(a.redirectTo ?? "/Console/");
    const bad = [];
    for (const p of pages) {
      const path = String(p ?? "");
      const r = await fetchTarget(baseUrl, path);
      if (r.error) { bad.push(`${path}:fetch-error`); continue; }
      if (r.status !== 200) { bad.push(`${path}:HTTP${r.status}`); continue; }
      if (r.body.length > maxBytes) { bad.push(`${path}:${r.body.length}B>${maxBytes}B`); continue; }
      if (!r.body.includes(`content="0; url=${redirectTo}"`)) { bad.push(`${path}:no-refresh`); continue; }
      if (!r.body.includes(`rel="canonical"`)) { bad.push(`${path}:no-canonical`); continue; }
    }
    const ok = bad.length === 0;
    return { id, ok, details: ok ? `${pages.length}/${pages.length} retired fronts serve permanent redirect stubs (<= ${maxBytes}B)` : `${pages.length - bad.length}/${pages.length} stubs healthy · failing: ${bad.join(", ")}` };
  }

  // ── home_links: the complete map (R61) ─────────────────────────────
  // The home page must link every current system surface: the nine
  // restored system fronts plus the wallet, the truth gate, the content
  // hub and the receipt wall. A surface the home page does not link is
  // a door without a sign - this detector refuses to bless it.
  if (a.kind === "home_links") {
    const links = Array.isArray(a.links) ? a.links : [];
    if (links.length === 0) return { id, ok: false, details: "invalid assertion: links list is empty" };
    const home = await fetchTarget(baseUrl, "");
    if (home.error) return { id, ok: false, details: `home page fetch failed: ${home.error}` };
    if (home.status !== 200) return { id, ok: false, details: `home page HTTP ${home.status}, expected 200` };
    const missing = links.filter((l) => !home.body.includes(`href="${l}"`));
    const ok = missing.length === 0;
    return { id, ok, details: ok ? `${links.length}/${links.length} required system hrefs present on the home page` : `missing from the home page: ${missing.join(", ")}` };
  }

  // ── pages_gone: the artifact ban (R61) ──────────────────────────────
  // Internal session artifacts (hourly pulse rounds, claims-audit
  // snapshots, token dossiers) are not public content. A path on this
  // list must not serve content on the live site: any 2xx (including a
  // redirect that lands on content) is a violation.
  if (a.kind === "pages_gone") {
    const pages = Array.isArray(a.pages) ? a.pages : [];
    if (pages.length === 0) return { id, ok: false, details: "invalid assertion: pages list is empty" };
    const served = [];
    for (const p of pages) {
      const r = await fetchTarget(baseUrl, p);
      if (r.error) { served.push(`${p}:fetch-error(${r.error})`); continue; }
      if (r.status >= 200 && r.status < 300) { served.push(`${p}:HTTP${r.status}`); continue; }
      if (r.status === 0) { served.push(`${p}:network-error`); continue; }
    }
    const ok = served.length === 0;
    return { id, ok, details: ok ? `${pages.length}/${pages.length} artifact paths serve no content (banned, as required)` : `artifact ban violated: ${served.join(", ")}` };
  }

  // ── pages_ok: R28 inventory sweep ───────────────────────────────────
  // Every page the Console publicly promises must exist and carry real
  // content. A page that answers 200 with an empty shell is a lie this
  // detector refuses to bless: minBytes is the floor for "real content".
  if (a.kind === "pages_ok") {
    const pages = Array.isArray(a.pages) ? a.pages : [];
    if (pages.length === 0) return { id, ok: false, details: "invalid assertion: pages list is empty" };
    const bad = [];
    for (const p of pages) {
      const path = String(p?.path ?? "");
      const minBytes = Number(p?.minBytes ?? 1024);
      const r = await fetchTarget(baseUrl, path);
      if (r.error) { bad.push(`${path}:fetch-error`); continue; }
      if (r.status !== 200) { bad.push(`${path}:HTTP${r.status}`); continue; }
      if (r.body.length < minBytes) { bad.push(`${path}:${r.body.length}B<${minBytes}B`); }
    }
    const ok = bad.length === 0;
    return { id, ok, details: ok ? `${pages.length}/${pages.length} pages healthy (200 + content floor)` : `${pages.length - bad.length}/${pages.length} healthy · failing: ${bad.join(", ")}` };
  }

  const target = a.target ?? "";
  const res = await fetchTarget(baseUrl, target);

  if (res.error) return { id, ok: false, details: `fetch failed: ${res.error}` };

  switch (a.kind) {
    case "http_ok": {
      if (res.status !== 200) return { id, ok: false, details: `HTTP ${res.status}, expected 200` };
      return { id, ok: true, details: "HTTP 200" };
    }

    // A retired page must stay retired: any 2xx (or a redirect that lands on
    // content) is a failure. 3xx that fell through to 200 via redirect: "follow"
    // is also a failure, because the operator cancelled the page outright.
    case "http_gone": {
      if (res.error) return { id, ok: false, details: `fetch failed: ${res.error}` };
      if (res.status >= 200 && res.status < 300) {
        return { id, ok: false, details: `HTTP ${res.status}, the retired page still serves content (expected 4xx/5xx)` };
      }
      return { id, ok: true, details: `HTTP ${res.status} (retired, as required)` };
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

    // json_age: a date field must be at most maxHours old - liveness of a
    // publisher, measured against the live file (not a claim in a page).
    case "json_age": {
      let json;
      try {
        json = JSON.parse(res.body);
      } catch (err) {
        return { id, ok: false, details: `target is not valid JSON: ${err?.message ?? err}` };
      }
      const { found, value } = resolvePath(json, a.field);
      if (!found) return { id, ok: false, details: `field "${a.field}" is missing` };
      const t = Date.parse(String(value));
      if (!Number.isFinite(t)) return { id, ok: false, details: `field "${a.field}" = ${JSON.stringify(value)} is not a parsable date` };
      const ageH = (Date.now() - t) / 3_600_000;
      const maxH = Number(a.maxHours);
      if (!Number.isFinite(maxH)) return { id, ok: false, details: `invalid assertion: maxHours is not a number` };
      return { id, ok: ageH <= maxH, details: `field "${a.field}" = ${JSON.stringify(value)}, age ${ageH.toFixed(2)}h, maximum ${maxH}h` };
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
