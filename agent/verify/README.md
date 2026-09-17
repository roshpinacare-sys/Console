# agent-verify - the network verifies the agent

The network does not take the agent's word for delivery. When the agent
claims "done", the network measures the live site on its own and publishes
the result in public.

The flow: **request · build · the network measures · public result.**

- `assertions.json` - the machine-checkable contract: 36 assertions over
  the live site (HTTP reachability, required page structures, live-data
  minima, the FRESH verdict, the zero-emoji policy, publisher liveness
  via json_age, and the R27 priority-inversion detector reading the Steem
  chain itself keyless). Bilingual, versioned with the repo, changed only
  by explicit edit.
- `run.mjs` - the verifier. Zero dependencies, Node 20+ (global fetch).
  Fetches the live site with a cache-buster, evaluates every assertion,
  and writes `results.json` next to itself. The exit code is always 0:
  results are data, not a crash. Failures are recorded honestly with a
  reason per assertion - never hidden, never retried into silence.
- `results.json` - the public verdict (`ALL_PASS` / `HAS_FAILURES` /
  `NO_ASSERTIONS`), with a timestamp, a duration, and one honest details
  line per assertion. Written by the workflow, rendered by the console.

## How to run

- Manual: GitHub, this repo, tab **Actions**, workflow **agent-verify**,
  button **Run workflow**. It also runs automatically every 2 hours at :55
  (schedule) and commits the fresh results.
- Local, from the repo root: `node agent/verify/run.mjs`. It writes
  `agent/verify/results.json`. Local runs are for debugging - do not
  commit their output; the workflow's snapshot is the published truth.

## Where results live

`agent/verify/results.json` in this repository, served publicly at
`/Console/agent/verify/results.json` and rendered in the verify-results
area of the console home page.

No secrets, no emojis, no claims without measurement.

---

# agent-verify - הרשת מאמתת את הסוכן

הרשת לא מקבלת את דברת הסוכן על מסירה. כשהסוכן טוען "סיימתי" - הרשת
מודדת את האתר החי בעצמה ומפרסמת את התוצאה בפומבי.

הזרימה: **בקשה · בנייה · הרשת מודדת · תוצאה ציבורית.**

- `assertions.json` - החוזה הנבדק-מכונה: 15 טענות על האתר החי (זמינות
  HTTP, מבני עמוד חובה, מינימום נתונים חיים, פסק הדין FRESH, מדיניות
  האפס-אימוג'י). דו-לשוני, מנוהל בגרסאות בריפו, משתנה רק בעריכה מפורשת.
- `run.mjs` - המאמת. אפס תלויות, Node 20+ (fetch גלובלי). מוריד את האתר
  החי עם שובר-מטמון, מעריך כל טענה, וכותב את `results.json` לצידו.
  קוד היציאה תמיד 0: תוצאות הן נתונים, לא קריסה. כישלונות נרשמים
  בכנות עם סיבה לכל טענה - לא מוסתרים ולא נמחקים בניסיון-חוזר.
- `results.json` - פסק הדין הציבורי (`ALL_PASS` / `HAS_FAILURES` /
  `NO_ASSERTIONS`), עם חותם-זמן, משך ריצה ושורת פירוט כנה לכל טענה.
  נכתב על ידי ה-workflow ומוצג בקונסולה.

## איך מריצים

- ידני: גיטהאב, הריפו הזה, לשונית **Actions**, ה-workflow
  **agent-verify**, כפתור **Run workflow**. בנוסף רץ אוטומטית כל
  6 שעות בדקה :55 (תזמון) ומבצע commit לתוצאות הטריות.
- מקומית, משורש הריפו: `node agent/verify/run.mjs`. הפקודה כותבת את
  `agent/verify/results.json`. ריצות מקומיות הן לניפוי שגיאות - לא
  להעלות את הפלט שלהן; צילום ה-workflow הוא האמת המפורסמת.

## איפה התוצאות

`agent/verify/results.json` בריפו הזה, מוגש בפומבי בכתובת
`/Console/agent/verify/results.json` ומוצג באזור verify-results של
עמוד הבית בקונסולה.

אפס סודות, אפס אימוג'י, שום טענה בלי מדידה.
