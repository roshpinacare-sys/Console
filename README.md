# SAOS· Console - the public beacon of THE WEAVE

This repository is the public console of the SAOS ecosystem: one complete,
comprehensive console - a single-page app plus the wallet, the truth gate,
the receipt wall, the content hub and the nine system fronts. No build step,
no tracking, no external dependencies, no CDN assets. Everything it serves
lives in this repository.

## What updates it

Two hearts keep this console alive, both visible in the commit history:

1. **The in-repo beacon** - a workflow inside this repository runs hourly
   at :45 (see `.github/workflows/console-publish.yml`) and:

   1. reads THE WEAVE's anchor line back from a public Steem RPC node (deduplicated by checkpoint - a re-anchored checkpoint is one row, its newest witness)
      (custom_json `saos.weave.core.v1` from the witness account, posting
      authority: free, zero capital risk, already public on-chain)
   2. renders `status.json` from what the chain returned
   3. commits it and deploys GitHub Pages, using only this repository's own
      GITHUB_TOKEN

   The in-repo workflow holds zero secrets: the public chain is the source
   of truth for the beacon.

2. **The sovereign heart** - the operator's sovereign machine additionally
   syncs the mirror, the ledger books and the console assets (this README,
   `render.mjs`, `wallet.html`, the public verifier under `verify/`) into
   this repository via a scoped PAT - honest, timestamped commits by the
   `weave-*` bots, one file per change.

The commit history of this repository is the publish beacon: timestamped,
auditable by anyone.

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

## Console truth — 2026-10-02 (Task 14-a, measured, only proven claims)

**Security verdict (gitleaks, pinned v8.24.3, same invocation as the org
workflow — `detect --source .` over full history + `dir` at HEAD):**

- The 8 HEAD findings reported by the org receipts (findingsHead=8,
  asOf 2026-10-02T07:58Z) were triaged one-by-one: all 8 are the same
  known-inert class — `ledger.json` weave brain-seal envelope fields
  (`encKey` / `keyIv` / `keyTag`), the by-design PUBLIC replay book's
  AES-256-GCM ciphertext and its 12-byte nonce / 16-byte auth tag. Ciphertext
  metadata, not secret material; the KEK is derived outside this repository
  (devKeyHex never enters any repo — the Zip iron law was re-verified).
  **Zero real secrets at HEAD.**
- Root cause of the regression: the ledger-publish bot rewrites
  `ledger.json` every publish, so 13-d2's line-number fingerprints in
  `.gitleaksignore` shift and re-flag. Line fingerprints can never win that
  race. Fix: a **rule-level allowlist** in the new `.gitleaks.toml`
  (same-ID merge onto `generic-api-key`, `condition = "and"`, path gated to
  `ledger.json` AND hex-gated to the three envelope fields). GitHub's
  auto-config precedence (`(target path)/.gitleaks.toml`) means the org
  workflow picks it up with zero workflow edits.
- Proven: HEAD re-scan = **0 findings**; full-history re-scan = **0 findings**
  (even with `.gitleaksignore` disabled); negative tests = a fake
  `fakeApiKey` injected into `ledger.json` is STILL flagged (path-only
  suppression is impossible by construction), hex-shaped secrets in other
  fields still scan.

**Mobile revolution (owner: "תפריט שבור בסלולר"):** one shared layer
`assets/site.css` + `assets/site.js` now governs every front. Browser-verified
at 390x844 across 24 pages (agent-browser sweep, re-run and re-verified by
the finishing agent): burger 44px, drawer opens/closes
(`aria-expanded` + Escape + focus return), drawer links ≥48px with correct
depth-prefixed hrefs (about/, pitch/, pitch/en, onepager/, deck/, receipts/,
hub/, hub/api/, hub/articles/en/), zero horizontal scroll on all 24 pages,
header actions lifted to 44px on mobile only, sticky footer hugs the viewport
on short pages. Four real bugs found by the sweeps and fixed: an RTL
specificity bug that made the drawer never open on Hebrew pages, a flex
shrink-to-fit interaction that re-introduced horizontal scroll on truth.html,
64-char txids forcing 649px min-content on onepager, and the four rewritten
marketing twins (pitch/, pitch/en.html, onepager/, deck/) wiring the shared
layer with a root-level `assets/` prefix that 404s one directory deep —
fixed to `../assets/`. Desktop 1280x900 unchanged (burger hidden, metrics
identical, VLM visual check OK on mobile drawer + desktop home).

**Wallet truth:** the registration flow now ends in real states only —
signed-locally → queued (with instructions) → broadcast / **rejected**
(the live book's own `invalid[]` verdict, matched by envelope id, with the
reason and a clear action) / **stale** (broadcast but not folded within the
poll window — the fold decides, not this page) / failed (relay did not
answer, 12s timeout). No infinite "step 2 of 3", no simulated success. With
no relay URL published in the live book (`relay.url = null` today), the
local queue + manual Steem-posting-key broadcast remain the stated way, and
the truth gate (truth.html) is linked from every queued state.

**Console ↔ Domain de-dup:** Console = operations (live book, truth gate,
triggers, receipts, wallet, verify). The duplicated marketing twins now
point at their single maintained copy on the public sovereign face
(https://roshpinacare-sys.github.io/Domain/…): pitch/, onepager/, deck/
and about/ carry a canonical link plus a short ops-focused summary instead
of a second full copy, and left this repo's sitemap (61→56 URLs, matching
canonicals). **versus.html keeps its full body by necessity** — the R61
complete-map gate requires all nine system fronts >10KB and sitemapped —
so it received the canonical link only (plus a source comment recording
the constraint). roast.html was compacted back under the gate's 2500-byte
stub cap (its shared-layer wiring was dead weight there — no header, no
drawer — and it had pushed the stub to 2547B, one of the two red gates of
2026-10-01/02). The other red gate (G2) was a checker false-positive:
the link extractor's own doctrine says inline-JS template fragments are
code, not links, but its filter missed `${…}` interpolation and fetched
the deep-link SOURCE inside wallet.html's script as a live URL (404).
The filter now skips `${` fragments; real DOM links are still checked.
All five rewritten twins carry EXACTLY ONE canonical each — versus.html's
legacy self-canonical was removed in the same pass (a page with two
different canonicals is an SEO error). Every canonical target was
live-verified HTTP 200 on the Domain Pages site before delegating.
No files deleted — bots own their paths. Bare `foundry` references (the
repo was renamed saos-sovereign-foundry) were qualified in hub prose and
agent notes; the watch bot itself untouched. Domain-side follow-up (not
this repo): Domain/versus.html carries its self-canonical twice, and
Domain's pitch/onepager/deck pages carry no self-canonical — both harmless
to this delegation, one-line fixes on the Domain side.
