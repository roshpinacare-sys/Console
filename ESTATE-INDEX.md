# ESTATE-INDEX — מפת-האחוזה הרשמית (16 ריפואים)

> נכתב 2026-10-06 ע"י סביבת-הקוקפיט (z-sandbox) לפי בקשת המפעיל.
> **כל שורה נמדדת** — clone/scan/API בתאריך הזה. עדכון-חוב עם כל שינוי-מבנה.
> אפס-סיבוב: המסמך הזה לא נוגע במפתחות, טוקנים או רשויות.

## שכבה 1 — מערכות-חיות (אוטומציות מתחייבות כל דקות)

| ריפו | תפקיד אמת | גודל | פעימה-חיה נמדדת | סטטוס |
|---|---|---|---|---|
| **steem** (main) | SAOS-NET COMMAND II — מיקרו-קרנל + sovereign node state | 300MB | gitkeeper auto-save ~90דק · loop 21 | חי |
| **steem** (branch `saos-cockpit`) | **SAOS SOVEREIGN COCKPIT · תא-הפיקוד** — הקונסולה החיה (deployed sandbox) | ← | gitkeeper · loop 21 | חי · הקנון לקוקפיט |
| **Console** | הבית-החי של הקונסולה · dex-watch · agents-watch · מקור ה-mirror | 11MB | weave-console cp#1447 כל-דקות | חי · מקור-אמת לאתר |
| **Domain** | ההגשה הציבורית (GitHub Pages) — mirror מ-Console | 9MB | weave-mirror · market-grid-cron · pages ✅ | חי · ירוק-יחיד ב-CI |
| **Zip** | **weave-core** — הספר, weave-seal, עוגני-אפס, כספת-seal | 117MB | weave-anchor-zero cp#1448 | חי |
| **saos-dex** | הבורסה — ספר-דטרמיניסטי + AMM + grid-חיילים | 42MB | grid-heartbeat(twin) | חי |
| **Defi** | שכבת-ניתוב כלי-DeFi לצי | 0.6MB | keeper fleet supervision | חי |

## שכבה 2 — פלטפורמות וארכיון (פעימות-keeper PASS 04:2x)

| ריפו | תפקיד אמת | גודל | סטטוס |
|---|---|---|---|
| **saos-sovereign-platform** | "הפרויקט-הנבחר" v122 — קונסולת-עגינה, צי 12, כספת AES-256-GCM | 64MB | קנון-פלטפורמה |
| **saos-control-center** | קונסולת DEX+כספת+ops (מסונתז מ-10 ארכיונים) | 6MB | קנון-משני |
| **Saosmartwallet** | ארנק ריבוני — 7 רשתות, M0–M4 מאומתים | 52MB | פלטפורמה |
| **roshpina** | קונסולת אמון-וערך (ledger BigInt µ¢) | 0.9MB | פלטפורמה |
| **saos-jummper** | notary הוכחות חוצה-שרשראות (~$0.10/עוגן) | 1MB | כלי |
| **saos-sovereign-foundry** | עגינה חוצת-רשתות + כלכלת-ראיות | 2.3MB | כלי |
| **Adsmarket** | ערכת-שיווק — כל-טענה מגובת txid | 2.1MB | תוכן |
| **Project-files** | ארכיון-כספת (zip snapshots קנוניים) | 65MB | ארכיון |
| **anchor-baseline** | בסיס-קפוא של הרשומה-הציבורית המוקדמת | 0.4MB | ארכיון |
| **Sdk** | **אין SDK בפועל** — ארכיון-שידורים (מתועד בכנות) | 0.4MB | ארכיון |

## אמת-CI (נמדד 2026-10-06)

- **Domain ירוק** (ציבורי — Actions חינם); **כל הפרטיים אדומים מאז 09-20**
- שורש: **אזילת-דקות Actions (חיוב)** — מתועד ב-gitleaks.yml: "owner-level billing fix pending"; ה-jobs נכשלים בהשקה (BlobNotFound, אפס-צעדים)
- **טריאג'-gitleaks הושלם 2026-10-06**: steem 65→0, Zip 17→0 (מקומית, v8.24.3, היסטוריה-מלאה). כל-ממצא סווג: גיבובי-sha256 (לא-הפיכים) · פיקסטורות-מדומות בארכיון-מחקר-שנמחק · טוקן-הנחיה קבוע (נשאר כמות-שהוא — חוק-אפס-סיבוב)
- ברגע-פתיחת-החיוב: המסילות מתירונות לבד — הקונפיגים כבר נקיים

## חוקי-ברזל של האחוזה

1. **אפס-סיבוב** (הוראת-מפעיל 2026-10-06): אף מפתח/טוקן/רשות-שרשרת לא מסובב בלי הוראה מפורשת
2. **אמת-מדידה**: כל-טענה מגובה ב-measurement — גם המסמך הזה
3. **ריפו=אמת, סנדבוקס=workspace** — העותק-החי כאן: steem@saos-cockpit
4. מפתח-הראש: seal כפול — `.secrets/headcorner.key` (0600) + `Zip/sovereign/headcorner-seal.enc` + סיסמה בענן/סנדבוקס/מפעיל
