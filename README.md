# SAOS· Console - the public beacon of THE WEAVE

This repository is the public console of the SAOS ecosystem: one complete,
comprehensive console - a single-page app plus the wallet, the truth gate,
the receipt wall, the content hub and the nine system fronts. No build step,
no tracking, no external dependencies, no CDN assets. Everything it serves
lives in this repository.

## What updates it

Nothing pushes to this repository from the outside. A workflow inside this
repository runs every 6 hours and:

1. reads THE WEAVE's anchor line back from a public Steem RPC node (deduplicated by checkpoint - a re-anchored checkpoint is one row, its newest witness)
   (custom_json `saos.weave.core.v1` from the witness account, posting
   authority: free, zero capital risk, already public on-chain)
2. renders `status.json` from what the chain returned
3. commits it and deploys GitHub Pages, using only this repository's own
   GITHUB_TOKEN

The workflow holds zero secrets. There is no credential to leak: the public
chain is the source of truth. The commit history of this repository is the
publish beacon: one commit per cycle, timestamped, auditable by anyone.

## What it contains

- `index.html` - the console SPA (one complete map: live status, network,
  agents, exchange, knowledge and admin views, bilingual)
- `wallet.html` - the sovereign wallet (keys never leave the browser)
- `truth.html` - the truth gate (the public face of the CI truth machine)
- `receipts/` - the receipt wall (every receipt opens in a public explorer)
- `hub/` - the content hub (articles, explainers, guides, fact sheet)
- the nine system fronts, all real measured pages:
  `money.html` (the money path), `net.html` (the live network mirror),
  `acid.html` (the discovery engine), `gate.html` (the operator gate),
  `defi.html` (the DeFi innovation map), `deposits.html` (the liquidity
  door), `readiness.html` (the readiness exam), `sovereign.html` (the
  sovereign verdict), `versus.html` (the honest comparison)
- `acid-engine.js` - the discovery engine that powers acid.html
- `status.json` - the live network status, read back from the chain:
  latest checkpoint root, transaction id, block, covered attestation range,
  ledger head hash at anchor time, sealing commit, witness freshness
- `render.mjs` - the keyless renderer (zero dependencies, plain fetch)
- `truth/truth-gate-ci.cjs` - the CI truth machine (hourly, measures the
  live site, commits its verdict)
- `agent/verify/` - the verification contract the network runs against
  the agent (assertions.json, run.mjs, public results.json)
- `.github/workflows/console-publish.yml` - the publish cycle
- `assets/og-cover.png` - the social preview image

## What it never contains

Keys, tokens, passphrases, wallet balances, treasury maps, internal
documents, or personal information. The renderer runs a secret gate on
every publish and refuses to commit anything matching key or token
patterns.

## How to verify

1. Read `status.json` and note the witness transaction id.
2. Open that transaction on any Steem explorer (link is on the page).
3. The custom_json payload carries the checkpoint root and the covered
attestation range: this is the network's own testimony, signed by the
posting authority of the witness account and validated by the chain
itself at inclusion.
4. The commit that wrote the status file is one click away, timestamped.

A claim without a receipt is not a claim here.

## Provenance

Site content derives from the ecosystem's approved public marketing
materials (receipt-backed claims only). The live panel derives from the
public chain. The site's canonical source lives in the ecosystem's
sovereign repository. Operator: roshpinacare-sys.

## One comprehensive console (R61)

The console serves **one complete map**: the console SPA (`index.html`), the
wallet, the truth gate, the receipt wall, the content hub, and the nine
system fronts (money · net · acid · gate · defi · deposits · readiness ·
sovereign · versus). Every page the home page links is a real page, and the
CI truth machine measures the whole map every hour (gate G8 complete-map:
each system front must answer 200, carry real content above the size floor,
be linked from the home page, and be present in the sitemap).

The roast front stays retired: its content was a stale claims-audit
snapshot, superseded by the living truth gate, and it serves a permanent
redirect.

Internal session artifacts (hourly pulse rounds, claims-audit snapshots,
token dossiers) are not public content. They were removed from the public
hub in R61 and stay in this repository's history, where anyone can still
find them.

The operator console itself lives on the sovereign side, not here. The local
crypto engine `gate-crypto.js` (pure JS: sha256 + RIPEMD-160 + secp256k1 over
BigInt + Steem transaction serialization + compact ECDSA with recovery)
remains and serves the live pages. No CDN, no external dependencies,
nothing to trust but math anyone can audit.

## What never enters this repository

Keys, tokens, passphrases, wallet balances, treasury maps, internal
documents, or personal information. The renderer runs a secret gate on
every publish and refuses to commit anything matching key or token
patterns. The operator's key lives only in the operator's browser session
(memory), never in this repository or its history.
