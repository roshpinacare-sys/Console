#!/usr/bin/env node
// redact-telemetry.mjs — write-time redaction for public telemetry (zai 9-b, exposure policy 7-b).
// Tier-A (keyless aggregates: totals, counts, verdicts, digests, chain marks) stays public.
// Tier-B leaves at write time: personal addresses (keep 4-char prefix), exact grid
// spread/commit params (coarse bands), secret-name fields, roster/account identity tables.
// Usage: node agents/redact-telemetry.mjs <file.json> [file.json ...]
// Idempotent, fail-closed on unreadable JSON (exits 1 so the commit step notices).
import fs from 'node:fs';

const PREFIXES = ['TG6S', 'TYVw', '0x01Bd']; // personal redemption box, TRON guard, sovereign EOA (prefix-only by design)
const RE_TRON = /\bT[1-9A-HJ-NP-Za-km-z]{33}\b/g;
const RE_EVM = /\b0x[a-fA-F0-9]{40}\b/g; // exactly 40 hex — 32-byte digests (64 hex) are tier-A and survive
const RE_STMKEY = /\bSTM[7-9A-HJ-NP-Za-km-z]{50,}\b/g;
const RE_SOL = /\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/g;
const DEPOSIT_KEY = /deposit|receive|inbox|payee|payto/i; // deposit/receive addresses are public-by-design (tier A)
const PARAM_KEY = /(commitPct|spread|stepBps|EdgeBps|edgePct|pegOut|threshold|feePct|requote|minEdge|expiryDays)/i;
const ID_KEY = /^(account|username|user|owner)$/i;
const SECRET_KEY = /^(secret|secretName|secretRef|secretKey)$/i;
const ROSTER_KEY = /roster|soldiers|accounts|members|keycheck|registry/i;

// estate-name law (19-a, loader refactor 19-d): no estate account names anywhere in
// the public tree — replaced with stable refs (same scheme as agents/refs.mjs).
// The name→ref map is DATA, not code: it is loaded at runtime from
//   1. env FLEET_ROSTER_MAP (the Actions secret — estate-scrub.yml passes it), or
//   2. agents/.roster-map.local.json (untracked, gitignored),
// and if NEITHER is present the estate scrub is an honest NO-OP with a loud log —
// never fabricated, never committed here. Zero account names in this file.
const ESTATE = new Map();
let ESTATE_LOADED = false;
function loadEstateMap() {
  if (ESTATE_LOADED) return;
  ESTATE_LOADED = true;
  const ingest = (pairs) => {
    let used = 0;
    for (const [ref, name] of pairs) {
      if (typeof ref !== 'string' || !/^acct-\d\d$/.test(ref) || typeof name !== 'string' || !name) continue;
      ESTATE.set(name, ref); used++;
    }
    return used;
  };
  try {
    const env = process.env.FLEET_ROSTER_MAP;
    if (env && env.trim().startsWith('{')) {
      const j = JSON.parse(env);
      const src = (j && j.refs && typeof j.refs === 'object') ? j.refs
        : (j && j.names && typeof j.names === 'object') ? Object.fromEntries(Object.entries(j.names).map(([n, r]) => [r, n]))
        : j;
      const used = ingest(Object.entries(src || {}));
      if (used) { console.log(`[refs] roster loaded from env FLEET_ROSTER_MAP (${used} refs)`); return; }
    }
  } catch (e) { console.error(`[refs] env FLEET_ROSTER_MAP unreadable: ${e.message}`); }
  try {
    const local = new URL('./.roster-map.local.json', import.meta.url);
    if (fs.existsSync(local)) {
      const j = JSON.parse(fs.readFileSync(local, 'utf8'));
      const src = (j && j.refs && typeof j.refs === 'object') ? j.refs
        : (j && j.names && typeof j.names === 'object') ? Object.fromEntries(Object.entries(j.names).map(([n, r]) => [r, n]))
        : j;
      const used = ingest(Object.entries(src || {}));
      if (used) { console.log(`[refs] roster loaded from local .roster-map.local.json (${used} refs)`); return; }
    }
  } catch (e) { console.error(`[refs] local roster map unreadable: ${e.message}`); }
  console.error('[refs] roster-unresolved: no FLEET_ROSTER_MAP env and no .roster-map.local.json — estate scrub is a NO-OP this run (pass the secret!)');
}
const IS_REF = /^acct-\d\d/;
// 25-d host-path law: host filesystem paths never publish (exposure-rules FORBIDDEN_CONTENT
// "host filesystem path"). Books used to republish sandbox paths on every beat.
const RE_HOSTPATH = /\/home\/[A-Za-z0-9_.-]+\//g;
function estateScrubStr(s) {
  loadEstateMap();
  let out = s.replace(RE_HOSTPATH, '[host]/');
  for (const [n, r] of ESTATE) {
    // case-insensitive + 19-c boundary law (alphanumeric lookarounds, not \b):
    // catches underscore-adjacent uppercase pointer forms (CI_<NAME>_CRED class) too
    if (out.toLowerCase().includes(n.toLowerCase())) out = out.replace(new RegExp('(?<![A-Za-z0-9])' + n + '(?![A-Za-z0-9])', 'gi'), r);
  }
  return out;
}


const band = (k, v) => {
  if (!Number.isFinite(v)) return v;
  if (/bps/i.test(k)) return Math.round(v / 100) * 100;
  if (/pct/i.test(k)) return v <= 1 ? Math.round(v * 4) / 4 : Math.round(v / 25) * 25;
  if (/expiryDays/i.test(k)) return Math.round(v / 10) * 10;
  if (/pegOut|threshold/i.test(k)) return Math.round(v * 2) / 2;
  return Math.round(v * 100) / 100;
};
const short = (s) => String(s).slice(0, 4) + '\u2026[redacted]';

function maskStr(key, s) {
  s = estateScrubStr(String(s));
  if (IS_REF.test(s)) return s; // already a pseudonym ref — leave it
  if (PREFIXES.some((p) => s.startsWith(p))) return short(s);
  if (SECRET_KEY.test(key || '')) return '[redacted]';
  if (DEPOSIT_KEY.test(key || '')) return s; // tier A: public receive addresses stay
  let out = s.replace(RE_STMKEY, (m) => 'STM\u2026[redacted]');
  out = out.replace(RE_EVM, (m) => m.slice(0, 6) + '\u2026[redacted]');
  out = out.replace(RE_TRON, (m) => m.slice(0, 4) + '\u2026[redacted]');
  if (/address|wallet|pubkey/i.test(key || '')) out = out.replace(RE_SOL, (m) => m.slice(0, 4) + '\u2026[redacted]');
  return out;
}

function walk(node, key, inRoster) {
  if (Array.isArray(node)) {
    if (ROSTER_KEY.test(key || '')) inRoster = true;
    return node.map((x) => walk(x, key, inRoster));
  }
  if (node && typeof node === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(node)) {
      if (v !== null && typeof v === 'object') { o[k] = walk(v, k, inRoster || ROSTER_KEY.test(k)); continue; }
      if (typeof v === 'string') {
        const scrubbed = estateScrubStr(v);
        if (IS_REF.test(scrubbed)) { o[k] = scrubbed; continue; }
        if (ID_KEY.test(k) && /^[a-z0-9][a-z0-9.-]{2,24}$/i.test(v)) o[k] = v.slice(0, 4) + '\u2026[redacted]';
        else o[k] = maskStr(k, v);
      } else if (typeof v === 'number' && PARAM_KEY.test(k)) o[k] = band(k, v);
      else o[k] = v;
    }
    return o;
  }
  return node;
}

let failed = 0;
for (const f of process.argv.slice(2)) {
  try {
    const raw = fs.readFileSync(f, 'utf8');
    if (f.endsWith('.jsonl')) {
      // Receipt-log law (2-d): the log may hold compact JSONL lines, a pretty-printed
      // object, or a mix (historic append-after-pretty writes) — whole-file JSON.parse
      // dies on every appended log, which silently killed the key-verify publish step.
      // Split into complete JSON documents (error-position guided), redact each,
      // re-emit as compact JSONL. Fail-closed on any true garbage.
      const docs = [];
      let rest = raw;
      while (rest.trim()) {
        try {
          docs.push(JSON.parse(rest));
          rest = '';
        } catch (e) {
          const m = /after JSON at position (\d+)/.exec(String(e.message));
          if (!m) throw e;
          const pos = Number(m[1]);
          docs.push(JSON.parse(rest.slice(0, pos)));
          rest = rest.slice(pos);
        }
      }
      const out = docs.map((d) => JSON.stringify(walk(d, '', false))).join('\n') + (docs.length ? '\n' : '');
      fs.writeFileSync(f, out);
      console.log(`[redact] ${f} ok (jsonl, ${docs.length} docs)`);
      continue;
    }
    const obj = JSON.parse(raw);
    fs.writeFileSync(f, JSON.stringify(walk(obj, '', false), null, 2) + '\n');
    console.log(`[redact] ${f} ok`);
  } catch (e) {
    if (e && e.code === 'ENOENT') { console.log(`[redact] ${f} absent - skip`); continue; }
    console.error(`[redact] ${f} FAILED: ${e.message}`);
    failed = 1;
  }
}
process.exit(failed);
