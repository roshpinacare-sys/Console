# BLOC — one bloc, two repos (r144-h)

**The law:** this is ONE bloc living in two public repos. Every capability lands in **exactly one** repo. Truth is computed once; the other face mirrors it. No manual copies, no twin recomputation.

## Roles

**Console = operator truth center.** Everything the machine must *measure and prove*: operator keys (`key-verify`), proof & ledger pipeline, sovereign anchor, the witness beacon (`console-publish`), the truth gate that grades the live site, the fleet census (`agents-watch` → `agents/registry.json` + `dex/world.json`), the money sentinel (`money-watch`), the treasury-door scan (`dex-watch`), the live SAOS fold (`saos-live.json`). 10 workflows.

**Domain = public face.** Everything the world must *read and find*: SEO surfaces, the hub content library, market/, research/, moment/, econ-desk, daily digests, and its own public-face self-verification (`agent-verify` measures the Domain site itself). Site-identity copy (canonical/og, nav) stays Domain's own. 29 workflows after the r144-h twin dedup (this repo keeps all 10 — it is the computation side).

## The 8 twin workflows — ownership (measured 2026-10-01, last-run evidence from the Actions API)

| workflow | owner | the other repo's disposition | measurement |
|---|---|---|---|
| console-publish | **Console** | Domain: **removed → mirrored** (weave-mirror :57 carried `status.json` already; now under one law) | both ran OK ≤1h before dedup |
| truth-gate | **Console** | Domain: **removed → mirrored** (`truth/latest.json`, `truth/history.json`, `truth/slo.json`) | both OK 21:23Z / 21:21Z |
| agents-watch | **Console** (writes `dex/world.json` + registry consumed by Console site AND the platform app) | Domain: **removed → mirrored** (`agents/registry.json`, `agents/gh-snapshot.json`) | both OK 20:50Z / 20:46Z |
| money-watch | **Console** (home platform reads `Console/dex/money.json`; its run also dispatches the Domain `dex-grid` backstop cross-repo) | Domain: **removed → mirrored** (`dex/money.json`) | both OK 21:17Z / 21:31Z |
| dex-watch | **Console** (home platform reads `Console/dex/watch.json` first) | Domain: **removed → mirrored** (`dex/deposits.json`, `dex/watch.json`) | both OK 21:37Z / 21:40Z |
| key-verify | **Console** (operator-key vault gate; dispatch-only) | Domain: **removed** — never succeeded there (0/8 runs), and a wrapper would check the *wrong repo's* vault | Console lastOK 2026-09-18, Domain never |
| gitleaks | **both, kept** — a per-repo push guard, not a duplicated computation; removing it would leave Domain pushes unscanned | kept | both OK on latest pushes |
| agent-verify | **both, kept** — each verifies a *different* live site (Console grades Console, Domain grades Domain) | kept | both OK 20:59Z / 21:04Z |

Deviation note (honest): the provisional r144-h assignment suggested agents-watch / money-watch / dex-watch belong to Domain. Verification of outputs/targets overruled it: all three are truth *computations* whose outputs both faces and the home platform consume; keeping them in Console makes the mirror one-directional (Console → Domain) with no stale operator views. Recorded here as the measured law.

## Mirrors (Domain ← Console, keyless public reads)

- **already existed:** `dex-mirror` (:52 — dex/grid, world, state, credits, portfolio) · `weave-mirror` (:57 — mirror.json, saos-live.json, status.json)
- **new in r144-h:** `mirror-from-console` (:15 + dispatch — agents/registry.json, agents/gh-snapshot.json, dex/money.json, dex/deposits.json, dex/watch.json, truth/latest.json, truth/history.json, truth/slo.json + HTML top-5: index.html, truth.html, gate.html, money.html, 404.html). HTML rule: a surface is copied (URL-swapped) **only while** Domain's copy is byte-exactly the swapped Console canonical; any real local content (e.g. Domain's fifth SLO in truth.html, market nav in index.html) ⇒ **DRIFT-RECORDED**, mirror stands down. Every run publishes `mirror-report.json`.
- `wallet.html` is out of scope (parallel workstream r144-g owns it in both repos).

## Triple saos-state (open, operator gate)

`Console/saos-live.json` (cloud fold) · `sovereign/saos-live-state.json` (local) · `sovereign/saosnet-snapshot.json` (v0 archive) disagree on which treasury address is *the* authority (saos1CKtm… live fold vs saos14wWGY… genesis). Two different treasuries = potentially two different authorities — **UNRESOLVED by design**, operator-gated. Facts: `sovereign/bloc/saos-state-map.json` in the platform repo.

## Rule for every future capability

**New capability lands in exactly one repo.** Truth computation / keys / proof / ledger / anchor → Console. Audience-facing content / SEO / research / market → Domain. A Domain page that needs a truth number mirrors the file; it never recomputes it. If you find yourself editing the same capability in both repos, stop — one owner, one mirror line.

## r68 — נוע-הרשת על השרשרת (2026-10-06)

**היכולת החדשה נחתה ב-Console בלבד** (חוק r144-h): שלושה מנועי-שרשרת
חסרי-מפתח על רצים ציבוריים — מדידת פרוטוקול ה-weave ישירות מהשרשרת,
לא מהספרים הנגזרים:

| מנוע | ספר (סופר יחיד) | קדנס | מה הוא מוכיח |
|---|---|---|---|
| `weave-census` (`agents/weave-census.mjs`) | `weave/census.json` | כל שעתיים :08 | מפקד-עומק של קו העוגן: עוגנים ייחודיים, דילוגי-קצב, טיפול-עדויות (TILED/HOLED), עדי-חתימה, קדנס. פסק-דין חיות: LIVE/IRREGULAR/STALLED/SPARSE |
| `chain-vitals` (`agents/chain-vitals.mjs`) | `weave/vitals.json` | כל שעתיים :50 | דופק כל קווי הרשת במקביל: Steem/Hive/Blurt, Relay ריבוני (ETH/OP/BASE), פקדות (TRON/BTC/SOL). שורה אדומה נשארת בספר |
| `line-agreement` (`agents/line-agreement.mjs`) | `weave/agreement.json` | כל שעתיים :14 (אחרי המפקד) | השער הכבד: headHash של mirror.json חייב עדות עוגן על השרשרת + מונוטוניות cp/att בסובלנות-פיגור +20. DIVERGE נקומע ואז מאדים את הריצה (דוקטרינת truth-gate) |

**Domain:** משקף את שלושת הספרים (whitelist `mirror-from-console`) ומציג
אותם ב-`net.html`. לעולם לא מחשב אותם. ההצגה חסרת-המפתחות כמו כל הבית.

**המדידות המייסדות (2026-10-06, לפני-הקומיט):** השרשרת על cp#1491 כשהספר
על 1487 (השרשרת מקדימה — סובלנות-הפיגור היא החוק); קצב-עיגון חציוני
~29–40 דק' מול קצב-checkpoints מהר יותר (דילוגי-הקצב הם פרוטוקול, לא
שבר — השיפוט הוא על חיות-הקו ועל עדות-ה-headHash, לא על רצף-צמוד);
8/9 קווי-רשת חיים מקומית (Blurt נפל מהסנדבוקס — יימדד שוב מהרצים).
