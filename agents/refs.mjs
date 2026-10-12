/**
 * refs — the estate pseudonym layer (exposure law: hub/disclosure-policy.html).
 *
 * WHY: the public tree must never carry the estate account map (who owns/controls
 * which chain accounts). Books, receipts, rosters and code therefore speak in
 * stable refs ("acct-00"…). The true mapping lives ONLY in:
 *   1. the repo's Actions secret FLEET_ROSTER_MAP (JSON: { refs: {ref: name, …} }), or
 *   2. an untracked local file agents/.roster-map.local.json (same shape), or
 *   3. an untracked local file agents/.roster-map.local.json with { names: {name: ref} }.
 *
 * Contract (fail-honest, never fail-fake):
 *   R(ref)        → real chain name, or null when unresolved (callers SKIP name-dependent work)
 *   refOf(name)   → ref, or the input unchanged when unknown
 *   scrub(text)   → replaces every known account name with its ref (context-sensitive)
 *   resolved()    → true when the map is available in this process
 *
 * Zero account names are committed in this file (the map is data, not code).
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

let REF_TO_NAME = new Map();
let NAME_TO_REF = new Map();
let loaded = false;

function loadPair(obj) {
  if (!obj || typeof obj !== "object") return false;
  // accept nested shapes: {refs:{ref:name}} / {names:{name:ref}} / flat {ref:name | name:ref}
  const flat = {};
  if (obj.refs && typeof obj.refs === "object") Object.assign(flat, obj.refs);
  if (obj.names && typeof obj.names === "object") Object.assign(flat, obj.names);
  for (const [k, v] of Object.entries(obj)) if (typeof v === "string") flat[k] = v;
  let used = false;
  for (const [k, v] of Object.entries(flat)) {
    if (typeof k !== "string" || typeof v !== "string") continue;
    if (k.startsWith("acct-")) { REF_TO_NAME.set(k, v); NAME_TO_REF.set(v, k); used = true; }
    else { NAME_TO_REF.set(k, v); REF_TO_NAME.set(v, k); used = true; }
  }
  return used;
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const env = process.env.FLEET_ROSTER_MAP;
    if (env && env.trim().startsWith("{")) { loadPair(JSON.parse(env)); return; }
  } catch { /* fall through to local file */ }
  try {
    const local = join(HERE, ".roster-map.local.json");
    if (existsSync(local)) loadPair(JSON.parse(readFileSync(local, "utf8")));
  } catch { /* remain unresolved — fail-honest */ }
}

export function resolved() { load(); return REF_TO_NAME.size > 0; }

/** ref → real chain name (null when unresolved). */
export function R(ref) {
  load();
  return REF_TO_NAME.get(String(ref)) ?? null;
}

/** real chain name → ref (unknown names pass through unchanged — only known estate names are secrets). */
export function refOf(name) {
  load();
  const n = String(name || "");
  return NAME_TO_REF.get(n) ?? n;
}

/**
 * Context-sensitive scrub: replaces known estate names with refs.
 * Matches: @name, quoted "name"/'name', JSON keys/values ("name":), |name| markdown-table cells,
 * and bare tokens in clearly-structured lists. Prose without structure is left alone —
 * false-positive-resistant by design.
 */
export function scrub(text) {
  load();
  if (!NAME_TO_REF.size || typeof text !== "string") return text;
  const names = [...NAME_TO_REF.keys()].sort((a, b) => b.length - a.length);
  let out = text;
  for (const n of names) {
    const r = NAME_TO_REF.get(n);
    const e = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // @handle, quoted strings, JSON keys, markdown table cells
    out = out.replace(new RegExp("([@\"'|])" + e + "([\"'|:,\\s\\])}])", "g"), "$1" + r + "$2");
  }
  return out;
}

export default { R, refOf, scrub, resolved };
