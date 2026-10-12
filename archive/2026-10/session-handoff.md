# Session Handoff — Console

## Blockers
- None owned by this repo. Owner-only key items live in the steem estate, not
  here (Console is keyless by design).

## Files
- `AGENTS.md` — landing protocol (read first, run init.sh second)
- `feature_list.json` / `progress.md` / this file — state layer
- `status.json`, `ledger.json` — public replay books
- `triggers/` — what was measured and what fired
- `assets/site.js`, `assets/site.css` — shared mobile layer (never dropped)
- `.github/workflows/` — bot cadence (money/dex/weave/saos-live/agents-watch)

## Next Session
1. `git pull --rebase origin main` (bots land every few minutes).
2. `./init.sh` — red baseline? Repair before new scope.
3. Check the mirror whitelist still matches Domain's page data needs.
4. One feature from `feature_list.json` to done-with-evidence.
5. Update state files; push rebase-first; stay keyless.
