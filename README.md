# SAOS· Console — the public beacon of THE WEAVE

This repository is the public console of the SAOS ecosystem: a single static
page plus one status file. No build step, no tracking, no external
dependencies, no CDN assets. Everything it serves lives in this repository.

## What updates it

Nothing pushes to this repository from the outside. A workflow inside this
repository runs every 6 hours and:

1. reads THE WEAVE's anchor line back from a public Steem RPC node
   (custom_json `saos.weave.core.v1` from the witness account, posting
   authority: free, zero capital risk, already public on-chain)
2. renders `status.json` from what the chain returned
3. commits it and deploys GitHub Pages, using only this repository's own
   GITHUB_TOKEN

The workflow holds zero secrets. There is no credential to leak: the public
chain is the source of truth. The commit history of this repository is the
publish beacon: one commit per cycle, timestamped, auditable by anyone.

## What it contains

- `index.html` — the console page (static marketing surface with a live
  THE WEAVE status panel)
- `status.json` — the live network status, read back from the chain:
  latest checkpoint root, transaction id, block, covered attestation range,
  ledger head hash at anchor time, sealing commit, witness freshness
- `render.mjs` — the keyless renderer (zero dependencies, plain fetch)
- `.github/workflows/console-publish.yml` — the publish cycle
- `assets/og-cover.png` — the social preview image

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
