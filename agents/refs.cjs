/**
 * refs.cjs — CJS mirror of refs.mjs (the estate pseudonym layer).
 * Same contract, same fail-honest law. Zero account names committed here.
 */
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
let REF_TO_NAME = new Map();
let NAME_TO_REF = new Map();
let loaded = false;

function loadPair(obj) {
  if (!obj || typeof obj !== 'object') return false;
  // accept nested shapes: {refs:{ref:name}} / {names:{name:ref}} / flat {ref:name | name:ref}
  const flat = {};
  if (obj.refs && typeof obj.refs === 'object') Object.assign(flat, obj.refs);
  if (obj.names && typeof obj.names === 'object') Object.assign(flat, obj.names);
  for (const [k, v] of Object.entries(obj)) if (typeof v === 'string') flat[k] = v;
  let used = false;
  for (const [k, v] of Object.entries(flat)) {
    if (typeof k !== 'string' || typeof v !== 'string') continue;
    if (k.startsWith('acct-')) { REF_TO_NAME.set(k, v); NAME_TO_REF.set(v, k); used = true; }
    else { NAME_TO_REF.set(k, v); REF_TO_NAME.set(v, k); used = true; }
  }
  return used;
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const env = process.env.FLEET_ROSTER_MAP;
    if (env && env.trim().startsWith('{')) { loadPair(JSON.parse(env)); return; }
  } catch { /* fall through */ }
  try {
    const local = path.join(HERE, '.roster-map.local.json');
    if (fs.existsSync(local)) loadPair(JSON.parse(fs.readFileSync(local, 'utf8')));
  } catch { /* remain unresolved — fail-honest */ }
}

function resolved() { load(); return REF_TO_NAME.size > 0; }

/** ref → real chain name (null when unresolved). */
function R(ref) {
  load();
  return REF_TO_NAME.get(String(ref)) ?? null;
}

/** real chain name → ref (unknown names pass through unchanged). */
function refOf(name) {
  load();
  const n = String(name || '');
  return NAME_TO_REF.get(n) ?? n;
}

/** Context-sensitive scrub: known estate names → refs (@handles, quoted, JSON keys, table cells). */
function scrub(text) {
  load();
  if (!NAME_TO_REF.size || typeof text !== 'string') return text;
  const names = [...NAME_TO_REF.keys()].sort((a, b) => b.length - a.length);
  let out = text;
  for (const n of names) {
    const r = NAME_TO_REF.get(n);
    const e = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp('([@"\'])' + e + '(["\'|:,\\s\\])}])', 'g'), '$1' + r + '$2');
  }
  return out;
}

module.exports = { R, refOf, scrub, resolved };
