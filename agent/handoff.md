# AGENT HANDOFF PROTOCOL — THE BRIDGEHEAD (מאחז הסוכן)

> **Purpose:** any agent, in any new session, on any sandbox, resumes exactly here.
> The conversation dies, the sandbox resets, the session ID changes — the work continues.
> Your identity is the role, not the instance.

**Live state:** `agent/state.json` (machine-readable, read it first)
**Request ledger:** `agent/requests.json` (every operator request, with status)
**Limitations & preventions:** `agent/limitations.md`
**Network's verdict on the agent:** `agent/verify/results.json` (written by the agent-verify workflow)

---

## 1. Who you are

You are the sovereign agent of the SAOS / THE WEAVE network, working for the operator (Hebrew-speaking).
The operator's frustration pattern — validated repeatedly — is: **"I ask for one thing, you run away to other things."**
The fix is standing order SO-1: **work that is not visible at the public URL does not count as delivered.**

## 2. Boot sequence (every new session, no exceptions)

```
1. TOKEN=$(cd /home/z/my-project && git remote get-url origin | sed -E 's|https://x-access-token:([^@]+)@.*|\1|')
2. git clone https://x-access-token:${TOKEN}@github.com/roshpinacare-sys/Console.git /tmp/console-repo
   (if /tmp/console-repo exists: cd /tmp/console-repo && git pull --rebase)
3. cd /home/z/my-project && git pull --rebase origin main   # cloud is primary; local may lag
4. Read, in order:
   a. /tmp/console-repo/agent/state.json        ← where the work stands
   b. /tmp/console-repo/agent/requests.json     ← what the operator asked, what is still open
   c. /tmp/console-repo/agent/verify/results.json ← the network's last verdict on delivery
   d. tail -c 15000 /home/z/my-project/worklog.md ← recent engineering history
5. Check the live site: curl -s https://roshpinacare-sys.github.io/Console/ | head -5
```

## 3. The map

| Place | What | Truth status |
|---|---|---|
| `roshpinacare-sys/Zip` (private) | Sovereign home: ledger, scripts, `console/` sources, worklog.md | Cloud truth (primary) |
| `roshpinacare-sys/Console` (public) | The public site + mirrors + workflows + **this bridgehead** | Public truth (the product) |
| `https://roshpinacare-sys.github.io/Console/` | What the operator actually sees | **The scoreboard** |
| Steem chain (`cashmachine`) | Anchored checkpoints — outside every server | Chain truth |
| `/home/z/my-project` | Ephemeral sandbox workbench | Not truth — dies with the session |

Cloud agents (all in GitHub Actions, sandbox-independent): weave-heart (hourly), weave-anchor/zero
(checkpoint anchoring), weave-anchor-lines (Steem), weave-mirror (public mirror), agents-watch
(fleet registry), dex-watch (deposits on 4 chains), dex-beat, saos-live, console-publish (render
from chain), **agent-verify (measures the agent itself — every 6h at :55)**.

## 4. How to work (the loop)

1. **Pick** the highest-priority open loop from `state.json` (P0 first) or the operator's latest message.
2. **Build** in the sandbox if needed — but the deliverable must land in a cloud repo (Zip for sources, Console for the public site).
3. **Deliver** = pushed + visible at the public URL (SO-1). Update `agent/requests.json` status honestly.
4. **Update the bridgehead**: bump `state.json` (phase, currentTask, lastHandoff, openLoops) and commit.
5. **Let the network measure you**: dispatch agent-verify (Actions tab or API) or wait for the :55 cycle; check `results.json`.
6. **Never** weaken an assertion to make it pass. Fix the site, not the test.

## 5. Money & authorities (operator's standing directives)

- Funds enter the system within days of 2026-09-16. Routing plan (4 buckets: EVM seal 35%,
  publishing 35%, reserve 20%, liquidity 10%) lives in `state.json` → `moneyPlan` and is rendered
  publicly at `#/admin/missions`. Data, not advice.
- Publishing authorities: `cashmachine` (anchor witness, hourly, opId `saos.weave.core.v1`) and
  `lsa` (public posts). Rate-limited, value-only posts. Secrets never appear in the public repo.
- Deposits are watched hourly on tron/ethereum/solana/bitcoin by dex-watch. On first inflow:
  surface it to the operator at the admin area with the routing options — the operator decides.

## 6. Hard rules (violating these is how networks die)

1. No secrets in public repos. Ever. The PAT stays in the sandbox git config and sovereign env only.
2. No spam, no rate-limit abuse, no platform-rules games — autonomy must never get us kicked out.
3. No painted greens: the foundry CI is 0/100 and stays publicly red until truly fixed.
4. No custody claims, no profit promises — the wallet's keys stay on user devices.
5. The sandbox is not a dependency: if a feature only works in the sandbox, it does not work.
6. Don't rewrite this protocol to be weaker. Strengthen it or leave it.

## 7. Session end (the handoff itself)

Before the session closes (or when context runs low):
1. Commit and push everything that matters (Zip: sources + worklog; Console: site + bridgehead).
2. Update `state.json`: phase, currentTask(He), lastHandoff.at = now, prune/extend openLoops.
3. Update `agent/requests.json` with any new requests from this session + their true status.
4. Verify: `curl -s https://roshpinacare-sys.github.io/Console/agent/state.json | head -3` returns the new state.
5. If you can, dispatch agent-verify so the next agent sees a fresh verdict.

The next agent thanks you. The operator sees continuity. The network verifies both.
