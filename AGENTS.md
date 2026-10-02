# AGENTS.md — Console (ops console: books, triggers, public replay)

> Task 19: full LHE harness protocol adopted from walkinglabs/learn-harness-engineering
> (five subsystems at this repo root). Console is the fleet's ops console: live
> status, triggers, receipts mirrors, the public ledger replay book. Keyless by
> construction — every bot here reads public state only. Zero secrets ever.

## Startup Workflow (before writing code)
1. **Before writing code**: run `./init.sh` — JS syntax gate + JSON book
   validity; fix a red baseline before adding new scope.
2. Read `README.md` and `BLOC.md` — what the console is, its page map, and
   the mirror law (Console mirrors data-JSON from the fleet; never fabricates).
3. Read `feature_list.json` — pick **one feature at a time**.
4. Check `progress.md` (Current State · Current Objective · Recommended Next
   Step) and `session-handoff.md` (Blockers · Files · Next Session).
5. `git log --oneline -5` — bots land commits every few minutes
   (money-watch, dex-watch, weave-console, saos-live) → always
   `git pull --rebase` before any push.

## Working rules (the law)
- **Keyless**: no secret ever lands here; bots read public chain/API state
  only. A page that needs a key to render is wrong by design.
- **No fabricated numbers**: every figure on a page traces to a book, a
  receipt, or a chain read-back; null beats a story.
- **Mirrors are dumb**: mirror workflows copy data-JSON from Console-side
  sources on a whitelist; they never transform numbers.
- **Mobile-first pages**: shared `assets/site.css` + `assets/site.js` layer;
  no page drops the layer (r147-b regression class — permanently guarded).
- **Rebase-first, never force**: parallel bot runtimes are real.

## Verification Commands
- `./init.sh` — the standard entrypoint (syntax + JSON validity)
- `node --check assets/site.js` — shared layer gate (per-change)
- JSON books validated in init: `ledger.json`, `status.json`
- Static/build/lint gates run in org CI (org-selftests + gitleaks 16/16)

## Scope rules
- **One feature at a time** — exactly one unfinished feature from
  `feature_list.json` to done-with-evidence.
- **Stay in scope** — Domain owns the public sovereign face; Console owns
  ops. Don't grow a page beyond its lane; the mirror whitelist is the contract.

## Definition of Done
A change is done only when ALL of the following are true: behavior
implemented, verification actually ran (evidence in `feature_list.json` or
`progress.md`), no fabricated data introduced, commit pushed rebase-first,
and the repo stays restartable from this file + `./init.sh`.

## End of Session (before ending)
1. Update `progress.md` and `feature_list.json` (status + evidence).
2. Record unresolved risks in `session-handoff.md`.
3. Commit with a fact-bearing message; `git pull --rebase` then push.
4. Leave the tree clean for the next session to run `./init.sh`.
