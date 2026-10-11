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
