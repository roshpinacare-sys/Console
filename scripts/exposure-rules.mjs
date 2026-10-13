// exposure-rules — THE SINGLE SOURCE OF EXPOSURE LAW (one law, two enforcers).
//
// WHY this module exists (measured failure 2026-10-12T21:27Z): the dex-mirror
// scrubbed mirrored books with the refs layer only, the refs roster-map was
// missing after wipe #3, the scrub silently no-oped, and poisoned content
// reached the public tree — caught only LATER by exposure-scan (the gate).
// The producer and the auditor were running DIFFERENT detectors. Law now:
// BOTH run this module. A producer that writes public bytes and the gate
// that scans the tree can never again disagree.
//
// Consumers:
//   · scripts/exposure-scan.mjs  — the tree-wide auditor (CLI, exit 1 on fail)
//   · agents/dex-mirror.mjs      — producer-side gate (rejects poisoned sources)
//
// Law text: hub/disclosure-policy.html + PUBLISHING-POLICY.json (Sandbox/ops).
// NOTE: pattern literals are assembled from parts so no file here ever
// matches itself (self-scan-safe by construction; the scanner additionally
// carves the law files out of the content scan — see its SELF regex).
import { execSync } from "node:child_process";

// assembled literals (self-scan-safe)
const HC = ["head", "corner"].join("");
const TOVH = ["tov", "-hive"].join("");
const CASHM = ["@cash", "machine"].join("");
const UPLOAD_HC = ["upload/", HC].join("");
const MP = ["master", " password"].join("");
const MPH = ["master", "-password"].join("");
const SIMA = ["סיסמת", "-האב"].join("");
const HZ = ["/home", "/z/"].join("");
const TR = ["trace-1a", "12"].join("");
const TRHEX = ["1a12", "fff10c"].join("");

// v3 (19-a): estate-name law — no estate account names anywhere in the public tree.
// Distinctive tokens scan bare; short collision-prone tokens (wic/woq/wog/siq/tov/lsa)
// are scrubbed by the engines' refs layer (agents/refs.mjs) and checked contextually here.
const RX = (parts, flags = "i") => new RegExp(parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(""), flags);
const ESTATE_NAMES = [
  { parts: ["cash", "machine"], why: "estate account name (fleet worker)" },
  { parts: ["hcs", "oldier"], re: null, why: "estate account name (soldier fleet)" },
  { parts: ["headc", "oner"], why: "estate account name (typo twin)" },
  { parts: ["israel", "news"], why: "estate account name (fleet worker)" },
  { parts: ["ha", "ran"], word: true, why: "estate account name (fleet worker)" },
  { parts: ["y", "net"], word: true, why: "estate account name (retired)" },
  { parts: ["corner", "stone"], word: true, why: "estate account name (legacy treasury)" },
].map(({ parts, word, why }) => ({ re: word ? new RegExp("\\b" + RX(parts).source + "\\b", "i") : RX(parts), why }));

// short tokens: only in identity-bearing contexts (@handle, quoted keys/values)
const SHORT_ESTATE = ["wic", "woq", "wog", "siq", "tov", "lsa", "macrame"]
  .map((n) => ({ re: new RegExp("[@\"']" + n + "[@\"':,\\s\\])}]", "i"), why: "estate account handle (short token, identity context)" }));

export const FORBIDDEN_PATHS = [
  /^agent\/inspections\/INS-R\d+.*\.json$/,          // inspection receipts narrate custody
  /^receipts\/key-check(\.json|-log\.jsonl)$/,        // key-verification receipts
  /^about\/team\.json$/,                              // fleet desk roster
  /^agents\/personas\.json$/,                         // T3/P0-1: coordination doctrine (roster+desks) — sealed store only
  /^agents\/persona-slots\.json$/,                    // T3/P0-1: cadence windows/weights/budgets — sealed store only
  /^agents\/community-founder\.json$/,                // T-70: estate book (identity-bearing account names) — CI-workspace only, never committed
  /(^|\/)ssh-keys\.tar\.enc$/,                        // sealed key bundles
  /(^|\/)keys\.env(\.enc|\.bak.*)?$/,
  /(^|\/)vault\/.*\.enc$/,
];

// Content patterns — identity, key-mechanics, custody narrative, host paths, chat ids.
export const FORBIDDEN_CONTENT = [
  { re: new RegExp(HC, "i"), why: "owner account handle (any case/inflection)" },
  { re: new RegExp(TOVH, "i"), why: "owner-only key identity" },
  { re: new RegExp(CASHM, "i"), why: "owner-tied account @handle in narrative" },
  ...ESTATE_NAMES,
  ...SHORT_ESTATE,
  { re: new RegExp(UPLOAD_HC, "i"), why: "key-file path" },
  { re: new RegExp(MP, "i"), why: "master-password narrative" },
  { re: new RegExp(MPH, "i"), why: "master-password classification label" },
  { re: new RegExp(SIMA, "i"), why: "master-password narrative (Hebrew)" },
  { re: new RegExp(HZ, "i"), why: "host filesystem path" },
  { re: new RegExp(TR, "i"), why: "owner chat trace id" },
  { re: new RegExp(TRHEX, "i"), why: "owner chat trace hex" },
  { re: /hq\.password/i, why: "restoration passphrase pointer" },
  { re: /keysZipPass/i, why: "vault-zip passphrase pointer" },
  { re: /BEGIN (RSA |EC )?PRIVATE KEY/, why: "private key material" },
  { re: /(?:הסיסמה|המפתח) (?:היא|הוא|האמיתית)|מסמך העברת הסיסמה|הסיסמה של\s/i, why: "master-password narrative (disclosure, not form label)" },
  { re: /\b[5JKL][1-9A-HJ-NP-Za-km-z]{50,51}\b/, why: "WIF-shaped token (52-char base58)" },
  { re: /\b(?:mnemonic|seed[- ]phrase)\b[^\n]{0,40}\b(?:word|12|24)\b/i, why: "mnemonic phrase hint" },
];

// Sig-locked evidence waiver (25-d): ledger.json is a keccak-chained attestation ledger —
// entries carry content INSIDE signed claims that are non-recomputable by design; rewriting
// them falsifies the evidence chain. 3-c UPDATE (2026-10-13): all 1870 estate-name
// occurrences (headcorner ×1179 → acct-00, cashmachine ×691 → acct-01) and 45 host-path
// evidences were scrubbed to refs/[host]/ by the 3-c remediation + the estate-scrub
// --names-only lane (chain-verifiable evidence — txids/roots/hashes/sigs — untouched).
// The waiver STAYS for the one remaining sig-locked class: a single AUDIT claim's
// keysZipPass/keysBackupPass length-pointer narrative (no value inside) — removing it is
// an owner call (one more falsified row vs one narrative pointer). Estate NAMES are now
// enforced on this book by the estate-scrub survivor check (RAW_FILES) instead.
export const SIGLOCKED_FILES = [/^ledger\.json$/];

export const ENGINE_RE = /^(agents\/.*\.(cjs|mjs)|scripts\/.*\.mjs)$/;
export const ENGINE_WAIVED = /keysZipPass/;

// violations(body, path?) → [{ why }] — the ONE detector every enforcer runs.
// path optional: applies the engine waiver exactly like the tree scan does.
export function violations(body, path = "") {
  const waived = path ? ENGINE_RE.test(path) && ENGINE_WAIVED.test(body) : false;
  const out = [];
  for (const { re, why } of FORBIDDEN_CONTENT) {
    if (waived && re.source === "keysZipPass") continue;
    if (re.test(body)) out.push({ why, sample: re.source.slice(0, 24) });
  }
  return out;
}

// pathViolations(p) → "forbidden path" or null — for producers that generate files.
export function pathViolations(p) {
  for (const fp of FORBIDDEN_PATHS) if (fp.test(p)) return "forbidden path";
  return null;
}

// trackedFiles() — the audited surface (used by the CLI scanner).
export function trackedFiles() {
  return execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
}
