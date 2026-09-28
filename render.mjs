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
// page sign as the account the key declares (cashmachine / headcorner /
// lsa — the fleet matrix). The reader scans every fleet account's history
// and merges the anchors into one line, deduped by checkpoint; each row
// records its witness. A headcorner-signed anchor now refreshes the line
// exactly like a cashmachine one.
//
// Output: status.json next to this file. The workflow commits it and
// deploys GitHub Pages from the same content.
// ─────────────────────────────────────────────────────────────────────

const FLEET = ["cashmachine", "headcorner", "lsa"].map((a) => a.toLowerCase()); // R75: the key declares who signs
const OP_ID = process.env.WEAVE_OP_ID || "saos.weave.core.v1";
// Z-14 hardening: a 2-node ladder died on a transient blip (run 36432539809:
// "all public RPC nodes failed - Upstream temporarily unavailable"). The
// beacon is the fleet's public face; a transient node outage must never
// break it. Six independent public nodes, two rounds with backoff, and a
// fail-soft honest UNREACHABLE beacon if everything is truly down.
const NODES = [
  "https://api.steemit.com",
  "https://api.justyy.com",
  "https://api.steemitdev.com",
  "https://steem.61bts.com",
  "https://api.steem.fans",
  "https://rpc.ausbit.dev",
];
const ROUNDS = 2; // passes over the node ladder; backoff between rounds
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  for (let round = 0; round < ROUNDS; round++) {
    if (round > 0) await sleep(3000 * round); // backoff: give blipped nodes a second chance
    for (const node of NODES) {
    try {
      const anchors = [];
      for (const account of FLEET) {
        let start = -1;
        let own = 0;
        for (let p = 0; p < MAX_PAGES && own < TARGET_ANCHORS; p++) {
          const hist = await rpc(node, "condenser_api.get_account_history", [account, start, PAGE]);
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
      console.log(`[render] node ${node} failed (round ${round + 1}/${ROUNDS}): ${e && e.message ? e.message : e}`);
    }
    }
  }
  throw new Error(`all public RPC nodes failed (${NODES.length} nodes × ${ROUNDS} rounds; last: ${lastErr && lastErr.message})`);
}

let read;
try {
  read = await readAnchorLine();
} catch (readErr) {
  // Z-14 FAIL-SOFT BEACON: if every public node × every round is
  // unreachable, publish an honest UNREACHABLE beacon and exit 0 so the
  // commit still lands. The page then says the truth ("the chain is
  // unreachable right now") instead of silently showing an old
  // FRESH-looking snapshot with no warning. Honest red on the page beats
  // a dead beacon and a red run on a transient blip.
  console.log(`[render] HONEST UNREACHABLE: ${readErr && readErr.message ? readErr.message : readErr}`);
  const unreachable = {
    format: "weave-console-chain-v1",
    generatedAt: new Date().toISOString(),
    source: { kind: "steem-public-rpc-unreachable", node: null, accounts: FLEET, account: null, opId: OP_ID },
    freshness: { verdict: "UNREACHABLE", ageHours: null, thresholdHours: FRESH_THRESHOLD_H, cadence: "1h" },
    witness: { account: null, opId: OP_ID, txid: "", block: null, explorer: "", at: null, checkpoint: null, root: "", attFrom: null, attTo: null, attestations: null, headHash: "", commit: "" },
    recent: [],
    unreachable: { message: String((readErr && readErr.message) || "all public RPC nodes unreachable"), nodesTried: NODES.length, rounds: ROUNDS },
  };
  const { writeFileSync } = await import("fs");
  writeFileSync(new URL("./status.json", import.meta.url), JSON.stringify(unreachable, null, 2) + "\n");
  console.log(`[render] beacon committed as UNREACHABLE (${NODES.length} nodes × ${ROUNDS} rounds tried) - honest red on the page, beacon stays alive`);
  process.exit(0);
}
const { node, anchors } = read;
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
  source: { kind: "steem-public-rpc", node: new URL(node).hostname, accounts: FLEET, account: last.witness, opId: OP_ID },
  freshness: {
    verdict,
    ageHours: Math.round(ageHours * 10) / 10,
    thresholdHours: FRESH_THRESHOLD_H,
    cadence: "1h",
  },
  witness: {
    account: last.witness,
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
    witness: a.witness,
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
