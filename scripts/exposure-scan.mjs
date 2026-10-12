#!/usr/bin/env node
// exposure-scan — P0-1 enforcement (master plan T6) — v4, one-law-two-enforcers.
// Law: hub/disclosure-policy.html + Sandbox/ops/PUBLISHING-POLICY.json —
//   never publish: owner identity/account linkage, key structure or key-file paths,
//   master-password narrative, owner verbatim quotes, owner chat/trace ids,
//   host filesystem paths, holdings tied to a named account.
// v4 (2026-10-13, trace 1a1319c4): ALL patterns moved to scripts/exposure-rules.mjs —
//   the single source both the auditor (this CLI) and the producers
//   (agents/dex-mirror.mjs) run. Measured failure this cures: the mirror's
//   refs-scrub no-oped (roster map lost to wipe #3) and poisoned content was
//   caught only HERE, minutes later — detector disagreement is now structurally
//   impossible.
// v4.1 (25-d): the law module itself is carved out of the content scan, same class
//   as the scanner — it must carry its literals (assembled parts, token tables,
//   class labels) and cannot both state the law and avoid matching it. Measured:
//   once exposure-rules.mjs became TRACKED (25-d), the inline-token tables
//   self-matched SHORT_ESTATE/MPH/mnemonic patterns (10 hits, all self-referential).
//   FORBIDDEN_PATHS still applies to the law files.
// Scans EVERY tracked file of this public repo (workflows + engine + books included),
// except office3d/** (separate deployment lane) and the law files themselves.
// Run locally: node scripts/exposure-scan.mjs — exits non-zero on any violation.
import { readFileSync } from "node:fs";
import { FORBIDDEN_PATHS, FORBIDDEN_CONTENT, ENGINE_RE, ENGINE_WAIVED, SIGLOCKED_FILES, trackedFiles } from "./exposure-rules.mjs";

const SKIP_RE = /(^|\/)(node_modules|\.git)\//;
const LANE_SKIP = /^office3d\//;        // parallel deployment lane (do-not-touch zone)
const SELF = /^scripts\/exposure-(scan|rules)\.mjs$/;
// Narrow waiver: engine code implements the custody contract of the PRIVATE checkout
// (agent/recovery-meta.json lives in the private steem repo, never here). The field
// name keysZipPass is that cross-repo contract — renaming it one-sidedly breaks
// custody unlock. Every other pattern still applies to engine code at full strength.

const tracked = trackedFiles();
const targets = tracked.filter((p) => !SKIP_RE.test(p) && !LANE_SKIP.test(p) && !SELF.test(p));

const findings = [];

for (const p of tracked) {
  for (const fp of FORBIDDEN_PATHS) if (fp.test(p)) findings.push({ p, why: "forbidden path" });
}

for (const p of targets) {
  let body = "";
  try { body = readFileSync(p, "utf8"); } catch { continue; }
  if (body.includes("\u0000")) continue; // binary
  if (SIGLOCKED_FILES.some((re) => re.test(p))) continue; // sig-locked evidence — content law waived by the law file itself (see SIGLOCKED_FILES)
  const waived = ENGINE_RE.test(p) && ENGINE_WAIVED.test(body);
  for (const { re, why } of FORBIDDEN_CONTENT) {
    if (waived && re.source === "keysZipPass") continue;
    if (re.test(body)) findings.push({ p, why });
  }
}

if (findings.length) {
  console.error("EXPOSURE-GATE FAIL — public-surface violations found:\n");
  for (const f of findings.slice(0, 40)) console.error(`  x ${f.p} — ${f.why}`);
  if (findings.length > 40) console.error(`  ... and ${findings.length - 40} more`);
  console.error("\nLaw: hub/disclosure-policy.html + PUBLISHING-POLICY.json (Sandbox/ops) - remediation: remove at HEAD; history rewrite is an owner decision only");
  process.exit(1);
}
console.log(`exposure-scan: PASS — ${targets.length} files scanned (full tree, office3d lane excluded), 0 violations`);
