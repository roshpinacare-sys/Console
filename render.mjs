#!/usr/bin/env bun
// ─────────────────────────────────────────────────────────────────────
// THE WEAVE · render.mjs - the keyless console renderer (public chain only)
//
// Runs inside the PUBLIC Console repository (GitHub Actions, its own
// GITHUB_TOKEN, zero secrets). It re-reads THE WEAVE's anchor line from a
// public Steem RPC node: custom_json id=saos.weave.core.v1 from the witness
// account, posting authority. The chain is the source of truth: no private
// repository is read, no credential exists, no trust in GitHub is involved.
//
// Output: status.json next to this file. The workflow commits it and
// deploys GitHub Pages from the same content.
// ─────────────────────────────────────────────────────────────────────

const ACCOUNT = (process.env.WEAVE_STEEM_ACCOUNT || "cashmachine").toLowerCase();
const OP_ID = process.env.WEAVE_OP_ID || "saos.weave.core.v1";
const NODES = ["https://api.steemit.com", "https://api.justyy.com", "https://steem.61bts.com"];
const FRESH_THRESHOLD_H = 26; // the same life doctrine the heart uses (WEAVE_STALE_MIN)
const PAGE = 100; // condenser_api.get_account_history hard upper limit per call
const MAX_PAGES = 30; // ~3000 ops back: days of fleet noise, always enough for the anchor line
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
      let start = -1;
      for (let p = 0; p < MAX_PAGES && anchors.length < TARGET_ANCHORS; p++) {
        const hist = await rpc(node, "condenser_api.get_account_history", [ACCOUNT, start, PAGE]);
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
          });
        }
        if (lowest === Infinity || lowest <= 1) break;
        start = Math.max(1, lowest - 1);
      }
      if (anchors.length === 0) {
        throw new Error(`no ${OP_ID} checkpoint anchors in @${ACCOUNT} recent history (${MAX_PAGES} pages)`);
      }
      anchors.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
      // התאמת-שכפול (Task 26): אותו checkpoint שעוגן מחדש (ניסיון חוזר,
      // שידור-כפול, קו שהשלים את קודמו) הוא שורה אחת - העדות החדשה
      // ביותר שלו. השרשרת שופטת; הקונסולה מציגה אמת ייחודית.
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
  throw new Error(`no ${OP_ID} anchors found in @${ACCOUNT} history: the chain is the source, an empty read is a red run`);
}
const last = anchors[0];
const ageHours = (Date.now() - new Date(last.at).getTime()) / 3600000;
const verdict = ageHours < FRESH_THRESHOLD_H ? "FRESH" : "STALE";

const explorer = (txid) => `https://steemscan.com/transaction/${txid}`;

const status = {
  format: "weave-console-chain-v1",
  generatedAt: new Date().toISOString(),
  source: { kind: "steem-public-rpc", node: new URL(node).hostname, account: ACCOUNT, opId: OP_ID },
  freshness: {
    verdict,
    ageHours: Math.round(ageHours * 10) / 10,
    thresholdHours: FRESH_THRESHOLD_H,
    cadence: "1h",
  },
  witness: {
    account: ACCOUNT,
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
    `txid ${last.txid.slice(0, 12)}… · age ${Math.round(ageHours * 10) / 10}h (${verdict}) · ` +
    `${anchors.length} anchors read from ${new URL(node).hostname}`
);
if (verdict === "STALE") {
  console.log(`[render] HONEST STALE: witness older than ${FRESH_THRESHOLD_H}h; the page will show the takeover window`);
}
