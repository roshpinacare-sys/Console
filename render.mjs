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
// page sign as the account the key declares (acct-41 / acct-40 /
// acct-44 — the fleet matrix). The reader scans every fleet account's history
// and merges the anchors into one line, deduped by checkpoint; each row
// records its witness. A acct-40-signed anchor now refreshes the line
// exactly like a acct-41 one.
//
// Output: status.json next to this file. The workflow commits it and
// deploys GitHub Pages from the same content.
// ─────────────────────────────────────────────────────────────────────

// R75 — the line is multi-signer: anchor machines and the sovereign page sign
// as the account the key declares. The LIVE sovereign publisher is `headcorner`
// (measured 2026-10-19: fresh anchor cp#1694 from the weave organ). The acct-41/
// acct-40/acct-44 matrix is the sovereign's own future fleet expansion — the
// sovereignty is authorized to create and onboard those accounts itself (owner
// mandate: the laws direct correct execution, they do not limit sovereignty).
// The reader scans every fleet account's history and merges the anchors into
// one line, deduped by checkpoint; each row records its witness.
const DEFAULT_FLEET = ["headcorner", "acct-41", "acct-40", "acct-44"];
const FLEET = (process.env.WEAVE_FLEET || DEFAULT_FLEET.join(","))
  .split(",").map((a) => a.trim().toLowerCase()).filter(Boolean);
const OP_ID = process.env.WEAVE_OP_ID || "saos.weave.core.v1";
// FIX(2026-10-19 · console-publish red streak): הכשל-החוזר היה רגעי — שני-צמתים
// בלבד ואפס-ניסיונות-חוזרים = כל-blip-רשת-מה-runner הופך-את-הפרסום-השעתי-לאדום.
// ארבעת-הצמתים-החיים (נמדדו-חי 2026-10-19) + שני-ניסיונות-פר-צומת עם-הפוגה.
// הזריקה-הכנה-בסוף-נשארת — אחרי-אכילת-כל-הצמתים-והניסיונות-ההכשל-עדיין-אמת.
const NODES = [
  "https://api.steemit.com",
  "https://api.justyy.com",
  "https://steemapi.boylikegirl.club",
  "https://api.steem.fans",
];
const NODE_TRIES = 2;
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
    for (let attempt = 1; attempt <= NODE_TRIES; attempt++) {
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
        // MEASURED, not failed: every page answered and the window still holds zero
        // checkpoint anchors. Returning the empty read honestly (wave-19.33) lets the
        // top level publish the takeover-window state instead of red-failing hourly
        // on a documented owner decision — the chain read itself is green.
        return { node, anchors: [] };
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
      console.log(`[render] node ${node} (attempt ${attempt}/${NODE_TRIES}) failed: ${e && e.message ? e.message : e}`);
      if (attempt < NODE_TRIES) await new Promise((r) => setTimeout(r, 3000));
    }
    }
  }
  throw new Error(`all public RPC nodes failed (last: ${lastErr && lastErr.message})`);
}

const { node, anchors } = await readAnchorLine();
// wave-19.33 owner fix-order ('תקן הכל'): zero anchors in the scanned window is a
// MEASURED chain state with a documented cause — the fleet audit (giant worklog)
// records the weave chain dark since 2026-10-12T07:27Z, the intended signer out of
// keys since R280, and the alternative requiring key material = OWNER red-line
// decision. The designed behavior (already in this file for old anchors) is to
// PUBLISH the honest STALE/takeover-window state — the page renders it — not to
// red-fail the hourly cron with an email per hour. The secret gate below still
// guards every byte we publish.
const TAKEOVER_NOTE =
  "no " + OP_ID + " checkpoint anchors in the scanned window (" + FLEET.length + " accounts x " + MAX_PAGES +
  " pages) - the weave anchor chain has been dark since 2026-10-12T07:27Z per the fleet audit " +
  "(signer out of keys since R280; the alternative needs key material = owner red-line). " +
  "The console displays the takeover window honestly; anchor resumption is an owner decision.";
const last = anchors[0] || null;
const ageHours = last ? (Date.now() - new Date(last.at).getTime()) / 3600000 : null;
const verdict = last ? (ageHours < FRESH_THRESHOLD_H ? "FRESH" : "STALE") : "STALE";

const explorer = (txid) => `https://steemscan.com/transaction/${txid}`;

const status = {
  format: "weave-console-chain-v1",
  generatedAt: new Date().toISOString(),
  source: { kind: "steem-public-rpc", node: new URL(node).hostname, accounts: FLEET, account: last ? last.witness : null, opId: OP_ID },
  freshness: {
    verdict,
    ageHours: last ? Math.round(ageHours * 10) / 10 : null,
    thresholdHours: FRESH_THRESHOLD_H,
    cadence: "1h",
    ...(last ? {} : { note: TAKEOVER_NOTE }),
  },
  witness: last ? {
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
  } : null,
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

if (last) {
  console.log(
    `[render] ${OP_ID} · latest anchor cp#${last.checkpoint} · root ${last.root.slice(0, 18)}… · ` +
      `txid ${last.txid.slice(0, 12)}… · witness @${last.witness} · age ${Math.round(ageHours * 10) / 10}h (${verdict}) · ` +
      `${anchors.length} anchors read from ${new URL(node).hostname} (${FLEET.length} fleet accounts scanned)`
  );
} else {
  console.log(`[render] HONEST TAKEOVER-WINDOW: ${TAKEOVER_NOTE}`);
}
if (verdict === "STALE" && last) {
  console.log(`[render] HONEST STALE: witness older than ${FRESH_THRESHOLD_H}h; the page will show the takeover window`);
}
