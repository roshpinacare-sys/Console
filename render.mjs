#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · render.mjs - the keyless console renderer (public chain only)
//
// Runs inside the PUBLIC Console repository (GitHub Actions, its own
// GITHUB_TOKEN, zero secrets). It re-reads THE WEAVE's anchor line from a
// public Steem RPC node: custom_json id=saos.weave.core.v1, posting
// authority. The chain is the source of truth: no private repository is
// read, no credential exists, no trust in GitHub is involved.
//
// R75 — the line is multi-signer: the anchor machines and the sovereign
// page sign as the account the key declares — the fleet matrix. The reader
// scans every fleet account's history and merges the anchors into one line,
// deduped by checkpoint; each row records its witness. Any matrix-signed
// anchor refreshes the line exactly like another.
//
// Exposure law (19-d, one-law-two-enforcers): zero account names AND zero
// pseudo-refs-as-code in this file (measured CI failure 06:06Z: literal
// acct-NN candidates never exist on-chain — refs are book-speak, not
// chain-speak). The candidate signer set is derived at RUNTIME from the
// FLEET_ROSTER_MAP secret (refs layer). The book speaks refs (acct-NN).
//
// Output: status.json next to this file. The workflow commits it and
// deploys GitHub Pages from the same content.
// ─────────────────────────────────────────────────────────────────────

// SHAPE-AGNOSTIC refs layer (19-d): every pair (k,v) is indexed by the
// acct-NN shape test — the acct-NN-looking side is the REF, the other side
// is the NAME. Accepts {refs:{ref:name}} / {names:{name:ref}} / flat / nested.
const REF_SHAPE = /^acct-\d+$/i;
function rosterFromEnv() {
  try {
    const m = JSON.parse(process.env.FLEET_ROSTER_MAP || "null");
    if (!m || typeof m !== "object") return { byName: null, byRef: null };
    const byName = {};
    const byRef = {};
    const feed = (k, v) => {
      if (typeof k !== "string" || typeof v !== "string") return;
      const kIsRef = REF_SHAPE.test(k);
      const vIsRef = REF_SHAPE.test(v);
      if (kIsRef && !vIsRef) { byRef[k.toLowerCase()] = v; byName[v.toLowerCase()] = k.toLowerCase(); }
      else if (vIsRef && !kIsRef) { byRef[v.toLowerCase()] = k; byName[k.toLowerCase()] = v.toLowerCase(); }
      // both refs or both plain — ambiguous shape, skip (fail-honest, no guessing)
    };
    for (const [k, v] of Object.entries(m)) {
      if (typeof v === "string") feed(k, v);
      else if (v && typeof v === "object") for (const [k2, v2] of Object.entries(v)) feed(k2, v2);
    }
    return { byName, byRef };
  } catch { return { byName: null, byRef: null }; }
}
const { byName, byRef } = rosterFromEnv();
const refOf = (n) => (byName && byName[String(n).toLowerCase()]) || String(n); // name → ref (unknown passes through)

// Candidate signer set: all resolvable NAMES from the runtime map (superset —
// the chain is the judge, dedupe by checkpoint keeps the line exact).
// Fail-honest: no names → red run, never a fake line, never literal refs.
function candidateAccounts() {
  if (!byName || !Object.keys(byName).length) {
    throw new Error("roster-unresolved: FLEET_ROSTER_MAP secret missing/empty — refusing to guess the signer set (fail-honest)");
  }
  const pool = [...new Set([...Object.keys(byName), ...Object.values(byName)])]
    .filter((s) => !REF_SHAPE.test(s))
    .map((s) => s.toLowerCase());
  if (!pool.length) {
    throw new Error("roster-unresolved: roster map carries no resolvable account names — refusing to scan refs (fail-honest)");
  }
  return [...new Set(pool)].sort();
}
const FLEET = candidateAccounts();
const OP_ID = process.env.WEAVE_OP_ID || "saos.weave.core.v1";
const NODES = ["https://api.steemit.com", "https://api.justyy.com"];
const FRESH_THRESHOLD_H = 26; // the same life doctrine the heart uses (WEAVE_STALE_MIN)
const PAGE = 100; // condenser_api.get_account_history hard upper limit per call
const MAX_PAGES = 30; // ~3000 ops back per account: days of fleet noise, always enough for the anchor line
const TARGET_ANCHORS = 24; // scan wide, dedupe by checkpoint - retries/re-broadcasts of the same cp are one row
const RECENT_ROWS = 8; // unique checkpoints shown on the anchor line

async function rpc(node, method, params) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(node, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (j.error) throw new Error(j.error.message || "rpc error");
    return j.result;
  } finally {
    clearTimeout(t);
  }
}

async function readAnchorLine() {
  let lastErr = null;
  for (const node of NODES) {
    try {
      const anchors = [];
      for (const account of FLEET) {
        // per-account isolation (superset roster): one odd account must never
        // kill the whole node scan — the chain is the judge, the line survives.
        try {
        let start = -1;
        let own = 0;
        for (let p = 0; p < MAX_PAGES && own < TARGET_ANCHORS; p++) {
          // steem asserts start >= limit (except the -1 head read) — clamp limit
          // to start when paging backwards so short histories never explode.
          const lim = start === -1 ? PAGE : Math.min(PAGE, start);
          const hist = await rpc(node, "condenser_api.get_account_history", [account, start, lim]);
          if (!Array.isArray(hist) || !hist.length) break;
          let lowest = Infinity;
          for (const [idx, entry] of hist) {
            if (typeof idx === "number" && idx < lowest) lowest = idx;
            const op = entry && entry.op;
            if (!op || op[0] !== "custom_json") continue;
            if (!op[1] || op[1].id !== OP_ID) continue;
            let pl;
            try {
              pl = JSON.parse(String(op[1].json || "{}"));
            } catch {
              continue;
            }
            // honest noise filter: only real checkpoint anchors carry action=checkpoint
            if (pl.action !== "checkpoint" || typeof pl.checkpoint !== "number") continue;
            anchors.push({
              checkpoint: pl.checkpoint,
              root: String(pl.root || ""),
              attFrom: typeof pl.attFrom === "number" ? pl.attFrom : null,
              attTo: typeof pl.attTo === "number" ? pl.attTo : null,
              attestations: typeof pl.attestations === "number" ? pl.attestations : null,
              headHash: String(pl.headHash || ""),
              commit: String(pl.commit || ""),
              at: String(pl.at || ""),
              txid: String(entry.trx_id || ""),
              block: typeof entry.block === "number" ? entry.block : null,
              witness: account,
            });
            own++;
          }
          if (lowest === Infinity || lowest <= 1) break;
          start = Math.max(1, lowest - 1);
        }
        } catch (e) {
          console.log(`[render] account scan skipped (${e && e.message ? String(e.message).slice(0, 80) : e})`);
        }
      }
      if (anchors.length === 0) {
        throw new Error(`no ${OP_ID} checkpoint anchors in fleet history (${FLEET.join(", ")}; ${MAX_PAGES} pages each)`);
      }
      anchors.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
      // התאמת-שכפול (Task 26): אותו checkpoint שעוגן מחדש (ניסיון חוזר,
      // שידור-כפול, קו שהשלים את קודמו) הוא שורה אחת - העדות החדשה
      // ביותר שלו, ממי שחתם אותה. השרשרת שופטת; הקונסולה מציגה אמת ייחודית.
      const seenCp = new Set();
      const unique = anchors.filter((a) => {
        if (seenCp.has(a.checkpoint)) return false;
        seenCp.add(a.checkpoint);
        return true;
      });
      return { node, anchors: unique };
    } catch (e) {
      lastErr = e;
      console.log(`[render] node ${node} failed: ${e && e.message ? e.message : e}`);
    }
  }
  throw new Error(`all public RPC nodes failed (last: ${lastErr && lastErr.message})`);
}

const { node, anchors } = await readAnchorLine();
if (anchors.length === 0) {
  throw new Error(`no ${OP_ID} anchors found in fleet history (${FLEET.join(", ")}): the chain is the source, an empty read is a red run`);
}
const last = anchors[0];
const ageHours = (Date.now() - new Date(last.at).getTime()) / 3600000;
const verdict = ageHours < FRESH_THRESHOLD_H ? "FRESH" : "STALE";

const explorer = (txid) => `https://steemscan.com/transaction/${txid}`;

const status = {
  format: "weave-console-chain-v1",
  generatedAt: new Date().toISOString(),
  source: { kind: "steem-public-rpc", node: new URL(node).hostname, accounts: FLEET.map(refOf), account: refOf(last.witness), opId: OP_ID }, // books speak refs (19-d)
  freshness: {
    verdict,
    ageHours: Math.round(ageHours * 10) / 10,
    thresholdHours: FRESH_THRESHOLD_H,
    cadence: "1h",
  },
  witness: {
    account: refOf(last.witness), // ref at source — the scrub stays belt-and-braces
    opId: OP_ID,
    txid: last.txid,
    block: last.block,
    explorer: explorer(last.txid),
    at: last.at,
    checkpoint: last.checkpoint,
    root: last.root,
    attFrom: last.attFrom,
    attTo: last.attTo,
    attestations: last.attestations,
    headHash: last.headHash,
    commit: last.commit,
  },
  recent: anchors.slice(0, RECENT_ROWS).map((a) => ({
    checkpoint: a.checkpoint,
    root: a.root,
    attFrom: a.attFrom,
    attTo: a.attTo,
    at: a.at,
    txid: a.txid,
    witness: refOf(a.witness), // ref at source (19-d)
    explorer: explorer(a.txid),
  })),
};

// שער הסודות של הקונסולה - שום מפתח/טוקן לא עולה לריפו הציבורי.
// hash-ים ציבוריים (root/headHash: 0x+64hex בשדות קנוניים) אינם סוד.
const text = JSON.stringify(status, null, 2);
const PATTERNS = [
  ["steem/hive WIF", /\b5[1-9A-HJ-NP-Za-km-z]{50}\b/],
  ["blurt WIF", /\bB[1-9A-HJ-NP-Za-km-z]{50}\b/],
  ["github token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ["github_pat token", /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ["PEM private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["x-access-token url", /x-access-token:[A-Za-z0-9_-]+@/],
];
const suspicious = text
  .split("\n")
  .filter((line) => /0x[0-9a-fA-F]{64}/.test(line))
  .filter((line) => !/"(root|headHash|entryHash)"\s*:/i.test(line));
for (const [name, re] of PATTERNS) {
  if (re.test(text)) throw new Error(`secret gate blocked status.json: ${name}`);
}
if (suspicious.length > 0) throw new Error(`secret gate blocked status.json: unrecognized 64hex line`);

const { writeFileSync } = await import("fs");
writeFileSync(new URL("./status.json", import.meta.url), text + "\n");

console.log(
  `[render] ${OP_ID} · latest anchor cp#${last.checkpoint} · root ${last.root.slice(0, 18)}… · ` +
    `txid ${last.txid.slice(0, 12)}… · witness @${last.witness} · age ${Math.round(ageHours * 10) / 10}h (${verdict}) · ` +
    `${anchors.length} anchors read from ${new URL(node).hostname} (${FLEET.length} fleet accounts scanned)`
);
if (verdict === "STALE") {
  console.log(`[render] HONEST STALE: witness older than ${FRESH_THRESHOLD_H}h; the page will show the takeover window`);
}
