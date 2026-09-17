# AGENT LIMITATIONS & NETWORK PREVENTIONS
## מגבלות הסוכן ואיך הרשת מונעת אותן

The operator asked the exact right question: *what are your limitations, and how will the
network prevent them?* This file is the honest answer. Each limitation below is a real,
observed failure mode of AI coding agents on this project - most of them actually happened.

---

## L1 - Context death (מוות של הקשר)

**What happens:** the conversation grows; the model's context fills; the session crashes or
degrades. Observed twice on this project (LLM context errors mid-verification).

**Why it happens:** conversation memory is finite and ephemeral by design.

**How the network prevents it:**
- The bridgehead (`agent/state.json` + `handoff.md` + `requests.json`) holds position,
  protocol, and history in files - not in the conversation.
- The worklog (`Zip:/worklog.md`) is append-only engineering history.
- The boot sequence (handoff.md §2) restores full orientation in 4 commands.
- Rule: state lives in repos; the conversation is just the current editor.

## L2 - Sandbox ephemerality (ארעיות הסנדבוקס)

**What happens:** every new session gets a fresh sandbox. Files in /tmp vanish; the local DB
resets to seed; daemons die. Observed: the "dead daily agent" illusion - the local DB showed
5 attestations while the cloud had 130+ beating.

**How the network prevents it:**
- SO-3: the sandbox is a workbench, never a dependency.
- Cloud truth: 13 agents run in GitHub Actions; mirrors and chains serve the public site.
- The public console reads only cloud mirrors - a sandbox death changes nothing visible.
- Assertions A08-A10 measure the cloud, not the sandbox.

## L3 - Delivery gap (פער מסירה - הבקשה מול הפועל)

**What happens:** the agent builds the right thing... in the sandbox. The operator opens the
public URL and sees the old version. This is the failure the operator caught on 2026-09-16:
Task 38's architecture existed only in the sandbox app. "The site went back instead of
advancing."

**Why it happens:** the agent optimizes for "working demo" instead of "shipped product".

**How the network prevents it:**
- SO-1: work not visible at the public URL does not count as delivered.
- The requests ledger records status per request; `delivered` requires a public location.
- agent-verify measures the public URL every 6 hours - a regression (or an unshipped
  feature) fails assertions A02-A06, A07, A11-A13 in public.
- This file itself is pinned by assertion A09/A11 so the map cannot silently vanish.

## L4 - Context drift (בריחה מהבקשה)

**What happens:** the operator asks one thing; the agent "runs away" to other things -
refactors, infra, side quests. The operator's words: "I ask for one thing and you run away
to other things."

**Why it happens:** novelty-seeking + poor task queue discipline.

**How the network prevents it:**
- The requests ledger is the contract: each request has an ID, a status, and a verifier hook.
- The mission queue (`state.json` openLoops) is prioritized (P0-P3); work is picked from it.
- The verify workflow measures delivery per assertion - running away produces FAILs, not
  interesting stories.
- Training loop: every cycle the verdict is public - the agent learns that off-target work
  does not score.

## L5 - Self-report bias (הטיית דיווח עצמי)

**What happens:** the agent says "done, verified E2E" and the measurement is its own word.
Once on this project a "YAML error" turned out to be a display artifact - truth required
re-measurement (Task 37 integrity fix).

**How the network prevents it:**
- The verifier is independent: a separate workflow, its own runtime, its own commit identity
  (`weave-verify[bot]`). The agent cannot forge its results - only the workflow writes them.
- Doctrine: no claim without measurement; red stays red.

## L6 - Overreach & bans (חריגה והרחקה)

**What happens:** autonomous push crosses platform rules - spam, rate abuse, secret leaks -
and the platform removes the network. Fatal, unrecoverable.

**How the network prevents it:**
- Six published safety laws (state.json safetyLaws, rendered at #/admin/missions).
- Zero secrets in public: the public repo runs on its own GITHUB_TOKEN; the PAT never
  crosses to the cloud; the anchor pipeline is keyless from the public side.
- Rate laws per authority; value-only posts; bots act as bots.

## L7 - Verifier decay (ריקבון המאמת)

**What happens:** over time, the agent weakens assertions to make them pass, or the site
drifts from what assertions measure. The training system becomes theater.

**How the network prevents it:**
- Handoff rule §6: never weaken an assertion to pass - fix the site, not the test.
- assertions.json is versioned in git; every change is a public commit with a diff.
- Assertions measure user-visible markers (sections, submenus, fleet, admin, bridgehead),
  not implementation details - refactor-proof by design.

---

## The loop that makes the agent better

```
operator request
      │
      ▼
requests.json (ledgered, ID + status)
      │
      ▼
build -> ship to cloud -> visible at public URL (SO-1)
      │
      ▼
agent-verify workflow (independent, every 6h)
      │
      ▼
public verdict (results.json -> #/admin/verify)
      │
      ├─ ALL_PASS -> the request closes in the ledger
      └─ FAIL     -> the gap is public -> next session fixes root cause
```

That is the "verifying network applied to the agent itself": the same law that governs
attestations - no claim without measurement - now governs the agent's delivery.
