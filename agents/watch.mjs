// AGENTS-WATCH - סוכן רישום-הסוכנים (Task 37)
//
// רץ בריפו הציבורי כל שעה: שואל את ה-API של גיטהאב את מצבם האמיתי של
// כל הסוכנים בכל 14 הריפואים (ריצות, הצלחות, משכים, פעם אחרונה),
// ממזג עם קטלוג התפקידים הקנוני (קלט->פלט) וכותב את agents/registry.json
// שתצוגת הסוכנים בקונסולה הציבורית קוראת. אפס-סנדבוקס - הענן מתעדכן
// לבד, הריפו הוא הבית.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const OWNER = "roshpinacare-sys";
const REPOS = ["Adsmarket","anchor-baseline","Console","Project-files","roshpina","saos-control-center",
  "saos-dex","saos-jummper","saos-sovereign-foundry","saos-sovereign-platform","Saosmartwallet","Sdk","steem","Zip"];
const TOKEN = process.env.AGENTS_WATCH_TOKEN;
if (!TOKEN) { console.error("AGENTS_WATCH_TOKEN missing"); process.exit(1); }

// ═══ קטלוג התפקידים הקנוני - מה כל סוכן עושה, מה נכנס ומה יוצא ═══
const CATALOG = {
  "Zip|weave-heart": { layer:"ALWAYS-UP", schedule:"hourly :00",
    role:{en:"Cloud heart of The Weave - reads the ledger every hour, judges whether the primary runner is alive, verifies only when alive, takes over the full cycle when it is not.",he:"הלב הענן של The Weave - קורא את הספר כל שעה, פוסק אם הראנר הראשי חי, מאמת בלבד כשחי ומשתלט על המחזור המלא כשלא."},
    input:{en:"fresh clone + ledger.json",he:"קלון טרי + ledger.json"},
    output:{en:"attestations, checkpoints, heartbeat commits",he:"אימותים, צ'קפוינטים, קומיטים של פעימה"}},
  "Zip|weave-anchor-lines": { layer:"WITNESS", schedule:"bi-hourly :20 + on every beat",
    role:{en:"Sequences both witness lines as one run - anchors the checkpoint root to Steem/Hive, then to Z Chain (zero-gas EVM), then exports and pushes once. Carries the merged anchor function of the two legacy lines (Task 24; their standalone workflows retired 2026-09-16).",he:"מריץ את שני קווי העדות כרצף אחד - מעגן את root הצ'קפוינט ל-Steem/Hive, אחר-כך ל-Z Chain‏ (EVM בגז-אפס), ומייצא ודוחף פעם אחת. נושא את פונקציית העיגון הממוזגת של שני הקווים ההיסטוריים (Task 24; ה-workflow העצמאי שלהם יצא לגמלאות ב-2026-09-16)."},
    input:{en:"latest checkpoint root",he:"root של הצ'קפוינט האחרון"},
    output:{en:"anchor txids recorded back into the ledger",he:"מזהי טרנזקציות העיגון חוזרים לספר"}},
  "Zip|weave-ecosystem": { layer:"ENFORCEMENT", schedule:"daily 05:30",
    role:{en:"Ecosystem unification guard - scans all repos for duplication (target dup<0.2) and enforces the one-source-of-truth doctrine automatically.",he:"שומר איחוד האקוסיסטם - סורק את כל הריפואים לגילוי כפילויות (יעד dup<0.2) ואוכף את דוקטרינת מקור-האמת האחד אוטומטית."},
    input:{en:"full org scan via contents API",he:"סריקת ארגון מלאה דרך contents API"},
    output:{en:"ecosystem report commits",he:"קומיטים של דוח אקוסיסטם"}},
  "Zip|weave-brain-restore": { layer:"RECOVERY", schedule:"one-shot (manual)",
    role:{en:"Restored the brain (3 NVIDIA NIM keys) from the fleet vault in the cloud after the sandbox DB was lost - the sovereign home, not a passing environment.",he:"השיב את המוח (3 מפתחות NVIDIA NIM) מכספת הצי בענן לאחר אובדן ה-DB של הסנדבוקס - הבית הריבוני, לא סביבה חולפת."},
    input:{en:"WEAVE_SEAL_PASSPHRASE + sealed vault",he:"WEAVE_SEAL_PASSPHRASE + הכספת החתומה"},
    output:{en:"brain keys restored to the sovereign chain",he:"מפתחות המוח הושבו לשרשרת הריבונית"}},
  "steem|cloud-heart": { layer:"ALWAYS-UP", schedule:"every 30 min",
    role:{en:"The fleet executor outside the sandbox - reads the living-attest from Steem/Hive over public RPC; fresh attest means sandbox alive (verify only), stale means takeover: key restore, full agent cycle, on-chain leadership marker, push.",he:"המבצע של הצי מחוץ לסנדבוקס - קורא את אימות-החיים מ-Steem/Hive דרך RPC ציבורי; אימות טרי = סנדבוקס חי (אימות בלבד), אימות בלהות = השתלטות: שחזור מפתח, מחזור סוכן מלא, סמן מנהיגות on-chain, דחיפה."},
    input:{en:"public Steem/Hive RPC + fresh clone",he:"RPC ציבורי של Steem/Hive + קלון טרי"},
    output:{en:"saosnet beat --live, chain attest, gitkeeper push",he:"saosnet beat --live, אימות שרשרת, דחיפת gitkeeper"}},
  "saos-dex|dex-beat": { layer:"ALWAYS-UP", schedule:"every 2h :23",
    role:{en:"The exchange's cloud heart - loads the chain snapshot, runs deterministic ticks, verifies deposit claims against the public ledger, credits them, commits and publishes state to the public console.",he:"הלב הענן של הבורסה - טוען את תמונת-המצב, מריץ טיקים דטרמיניסטיים, מאמת תביעות הפקדה מול הספר הציבורי, מזכה, מבצע commit ומפרסם את המצב לקונסולה הציבורית."},
    input:{en:"chain snapshot + signed deposit claims",he:"תמונת-מצב שרשרת + תביעות הפקדה חתומות"},
    output:{en:"credits, chain commit, public state publish",he:"זיכויים, commit לשרשרת, פרסום מצב ציבורי"}},
  "Console|money-watch": { layer:"MONEY-PATH", schedule:"every 15 min :02/:17/:32/:47",
    role:{en:"Money path sentinel - watches the two chokepoints of the real money path: detects the weekly powerdown landing within minutes and dispatches the external grid immediately (instead of waiting for the daily run), and rules SEND-NOW/WAIT on the redemption outbox versus the measured TRON broadcast cost.",he:"צופה נתיב הכסף - קולט את נחיתת ה-powerdown השבועית בתוך דקות ומזניק את הגריד החוץ מיד (במקום להמתין לריצה היומית), ופוסק SEND-NOW/WAIT על תיבת הפדיון מול עלות השידור הנמדדת ב-TRON."},
    input:{en:"Steem public RPC (account+powerdown) + world.json + trongrid + CoinGecko",he:"RPC ציבורי של Steem (חשבון+powerdown) + world.json + trongrid + CoinGecko"},
    output:{en:"dex/money.json + immediate dex-grid dispatch on landing",he:"dex/money.json + הזנקת dex-grid מיידית בנחיתה"}},
  "Console|dex-watch": { layer:"MIRROR", schedule:"every 20 min :07/:27/:47",
    role:{en:"The public deposits watcher - scans the real deposit addresses (TRON/ETH/SOL/BTC) over public RPC and updates the open deposits ledger the site displays and the DEX verifies against.",he:"צופה ההפקדות הציבורי - סורק את כתובות ההפקדה האמיתיות (TRON/ETH/SOL/BTC) ב-RPC ציבורי ומעדכן את ספר ההפקדות הפתוח שהאתר מציג והדקס מאמת מולו."},
    input:{en:"public RPC: TRON / ETH / SOL / BTC",he:"RPC ציבורי: TRON / ETH / SOL / BTC"},
    output:{en:"dex/deposits.json - the open deposits ledger",he:"dex/deposits.json - ספר ההפקדות הפתוח"}},
  "Console|console-publish": { layer:"PUBLISH", schedule:"on push to main",
    role:{en:"Publishes the public console pages - validates and ships every change to the site the world sees.",he:"מפרסם את דפי הקונסולה הציבוריים - מאמת ומשטח כל שינוי לאתר שהעולם רואה."},
    input:{en:"push to main",he:"דחיפה ל-main"},
    output:{en:"live console pages",he:"דפי קונסולה חיים"}},
  "saos-sovereign-foundry|CI": { layer:"QA", schedule:"push / PR",
    role:{en:"Foundry quality gate - lint, typecheck, production build, API contract and concurrency checks against a throwaway SQLite. Repaired at the root (Task 43): the recovery drill is self-sufficient (fresh verified backup then restore dry-run with chain-proof) and owner-held-token assertions skip honestly - api-check 182 passed / 0 failed / 7 environment-held skips, green run 35161896260.",he:"שעת איכות של ה-foundry - lint, typecheck, בילד ייצור, בדיקות חוזה API ומקביליות מול SQLite חד-פעמי. תוקן מהשורש (Task 43): תרגיל ההתאוששות עצמאי (גיבוי מאומת טרי ואז שחזור dry-run עם הוכחת-שרשרת) וקביעות הטוקנים שבידי הבעלים מדלגות בכנות - api-check 182 עבר / 0 נכשלו / 7 דילוגים סביבתיים, ריצה ירוקה 35161896260."},
    input:{en:"push to main",he:"דחיפה ל-main"},
    output:{en:"lint + typecheck + build + api + concurrency verdict",he:"פסק lint + typecheck + build + api + מקביליות"}},
  "Adsmarket|claims-guard": { layer:"INTEGRITY", schedule:"daily 06:11 UTC",
    role:{en:"Marketing truth guard - enforces the repo iron principle: landing pages complete, zero forbidden glyphs per operator policy, live links (a dead link to our own network is a failure), and counts the txid receipts backing the claims.",he:"שומר האמת של השיווק - אוכף את עקרון הברזל של הריפו: עמודי נחיתה שלמים, אפס גליפים אסורים לפי מדיניות המפעיל, קישורים חיים (קישור מת של הרשת שלנו הוא כשל), וספירת קבלות ה-txid שמגבות את הטענות."},
    input:{en:"marketing pages + documents",he:"עמודי שיווק + מסמכים"},
    output:{en:"agent/status.json truth report",he:"דוח אמת agent/status.json"}},
  "anchor-baseline|baseline-integrity": { layer:"INTEGRITY", schedule:"daily 07:13 UTC",
    role:{en:"Baseline history keeper - builds a SHA-256 manifest of all broadcasts, docs and downloads, compares to the previous manifest, reports additions and changes, and fails when history files are deleted.",he:"שומר ההיסטוריה של קו הבסיס - בונה מניפסט SHA-256 של כל השידורים, המסמכים וההורדות, משווה לקודם, מדווח תוספות ושינויים, ונכשל כשקבצי היסטוריה נמחקים."},
    input:{en:"broadcasts + docs + download",he:"שידורים + מסמכים + הורדות"},
    output:{en:"agent/status.json + manifest.sha256",he:"דוח agent/status.json + מניפסט SHA-256"}},
  "roshpina|controls-audit": { layer:"INTEGRITY", schedule:"daily 08:17 UTC",
    role:{en:"Controls auditor - verifies the controls-that-exist document is present and substantial, every control documented in its own section, the agent briefing and patch specs exist, and counts the broadcasts archive.",he:"מבקר הבקרות - מוודה שמסמך הבקרות-שקיימות נוכח ומהותי, שכל בקרה מתועדת בסעיף משלה, שתדריך הסוכן ומפרטי הפאטץ' קיימים, וסופר את ארכיון השידורים."},
    input:{en:"controls + briefing + patch specs",he:"בקרות + תדריך + מפרטי פאטץ'"},
    output:{en:"agent/status.json audit report",he:"דוח ביקורת agent/status.json"}},
  "Sdk|sdk-verify": { layer:"INTEGRITY", schedule:"daily 09:23 UTC",
    role:{en:"SDK content verifier - confirms the docs and broadcasts directories exist and are not empty, builds a SHA-256 manifest and counts the document inventory.",he:"מאמת תוכן ה-SDK - מאשר שתיקיות התיעוד והשידורים קיימות ולא ריקות, בונה מניפסט SHA-256 וסופר את מלאי המסמכים."},
    input:{en:"docs + broadcasts",he:"תיעוד + שידורים"},
    output:{en:"agent/status.json + manifest.sha256",he:"דוח agent/status.json + מניפסט SHA-256"}},
  "saos-jummper|jumpper-tests": { layer:"QA", schedule:"daily 10:29 UTC",
    role:{en:"Notary test suite - runs the full unit tests of the cross-chain proof notary (the hard gate), compiles the whole package, and attempts the live read-only witness demo with honest reporting of network failures.",he:"מבחני הנוטריון - מריץ את מלוא מבחני היחידה של נוטריון ההוכחות חוצה-השרשרות (השער הקשה), מקמפל את החבילה כולה, ומנסה את הדמו החי של עד הראייה הקריא עם דיווח כנה על כשלי רשת."},
    input:{en:"test suite + package source",he:"מבחנים + קוד החבילה"},
    output:{en:"agent/status.json with test counts",he:"דוח agent/status.json עם מספרי מבחנים"}},
  "Project-files|archive-keeper": { layer:"ARCHIVE", schedule:"weekly Mon 11:31 UTC",
    role:{en:"Archive keeper - opens every canonical zip archive end to end to prove it is not corrupt, builds a SHA-256 manifest and a size catalog. A corrupt archive is a red mark.",he:"שומר הארכיון - פותח כל ארכיון קנוני מקצה לקצה כדי להוכיח שאינו מושחת, בונה מניפסט SHA-256 וקטלוג גדלים. ארכיון מושחת הוא סימן אדום."},
    input:{en:"canonical zip archives",he:"ארכיוני zip קנוניים"},
    output:{en:"agent/status.json + archives.sha256",he:"דוח agent/status.json + מניפסט ארכיונים"}},
  "saos-control-center|control-center-build": { layer:"QA", schedule:"daily 12:37 UTC",
    role:{en:"Control center quality gate - installs dependencies from the frozen lockfile, generates the Prisma client, runs a full typecheck and a production build. Every failed step is recorded honestly.",he:"שעת איכות של מרכז הבקרה - מתקין תלויות מהנעילה הקפואה, מייצר לקוח Prisma, מריץ בדיקת טיפוסים מלאה ובילד ייצור. כל שלב שנכשל נרשם בכנות."},
    input:{en:"source + lockfile",he:"קוד + נעילה"},
    output:{en:"agent/status.json build verdict",he:"פסק בילד ב-agent/status.json"}},
  "saos-sovereign-platform|platform-selftest": { layer:"QA", schedule:"daily 13:41 UTC",
    role:{en:"Edge engine selftest - runs the deterministic selftest of the dual-layer irrigation engine (no network, no randomness) and loads the frozen rule layer. The engine must answer identical answers always - that is the parity promise.",he:"מבחן-עצמי של מנוע הקצה - מריץ את המבחן הדטרמיניסטי של מנוע ההשקיה דו-השכבתי (אפס רשת, אפס אקראיות) וטוען את שכבת הכללים הקפואה. המנוע חייב לענות תשובות זהות תמיד - זו הבטחת הפריטיות."},
    input:{en:"python/irrigation_engine.py",he:"מנוע ההשקיה בפייתון"},
    output:{en:"agent/status.json selftest verdict",he:"פסק מבחן-עצמי ב-agent/status.json"}},
  "Saosmartwallet|wallet-verify": { layer:"QA", schedule:"daily 14:43 UTC",
    role:{en:"Wallet quality gate - installs dependencies, generates the Prisma client, runs a full typecheck and a production build of the seven-network wallet, and confirms the system-status reports exist.",he:"שעת איכות של הארנק - מתקין תלויות, מייצר לקוח Prisma, מריץ בדיקת טיפוסים מלאה ובילד ייצור של ארנק שבע-הרשתות, ומאשר שדוחות מצב-המערכת קיימים."},
    input:{en:"source + lockfile",he:"קוד + נעילה"},
    output:{en:"agent/status.json verify verdict",he:"פסק אימות ב-agent/status.json"}},
};
const GENERIC = { layer:"PUBLISH", schedule:"automatic",
  role:{en:"GitHub Pages automatic deployment of the public site.",he:"פריסה אוטומטית של GitHub Pages לאתר הציבורי."},
  input:{en:"pages build",he:"בילד דפים"}, output:{en:"live GitHub Pages site",he:"אתר GitHub Pages חי"} };
const REPO_VIS = { Console:"public" };  // measured 2026-09-16: every repo except Console is private

async function api(url) {
  const r = await fetch(url, { headers: { Authorization: `token ${TOKEN}`, "User-Agent": "agents-watch", Accept: "application/vnd.github+json" } });
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

function stateOf(name, lastConcl, lastAt) {
  if (name === "pages build and deployment") return "auto";
  const ageH = lastAt ? (Date.now() - Date.parse(lastAt)) / 36e5 : Infinity;
  if (lastConcl === "success" && ageH < 48) return "live";
  if (lastConcl === "failure") return "degraded";
  return "dormant";
}

const agents = [];
for (const repo of REPOS) {
  let wfs;
  try { wfs = (await api(`https://api.github.com/repos/${OWNER}/${repo}/actions/workflows?per_page=100`)).workflows || []; }
  catch (e) { console.error(`workflows ${repo}: ${e.message}`); continue; }
  for (const w of wfs) {
    if (w.state !== "active") continue;
    let runs = [];
    try { runs = (await api(`https://api.github.com/repos/${OWNER}/${repo}/actions/workflows/${w.id}/runs?per_page=100`)).workflow_runs || []; }
    catch (e) { console.error(`runs ${repo}/${w.name}: ${e.message}`); continue; }
    if (!runs.length) continue;
    const succ = runs.filter((r) => r.conclusion === "success").length;
    const fail = runs.filter((r) => r.conclusion === "failure").length;
    const durs = runs.slice(0, 40).map((r) => {
      const s = Date.parse(r.run_started_at || r.created_at), e = Date.parse(r.updated_at);
      return Number.isFinite(s) && Number.isFinite(e) ? (e - s) / 1000 : null;
    }).filter((x) => x !== null && x >= 0);
    // self-measurement honesty: the run currently in progress has no
    // conclusion yet - measure the last COMPLETED run instead (agents-watch
    // itself was showing "dormant" while actively running).
    const last = runs.find((r) => r.conclusion) || runs[0];
    const cat = CATALOG[`${repo}|${w.name}`] || GENERIC;
    agents.push({
      id: `${repo.toLowerCase()}-${w.name.toLowerCase().replace(/ /g, "-")}`,
      name: w.name, repo, visibility: REPO_VIS[repo] || "public",
      schedule: cat.schedule, layer: cat.layer, role: cat.role, input: cat.input, output: cat.output,
      state: stateOf(w.name, last.conclusion, last.run_started_at),
      stats: { runs_sampled: runs.length, success: succ, failure: fail, other: runs.length - succ - fail,
        successRate: Math.round((1000 * succ) / runs.length) / 10, avgDurS: durs.length ? Math.round((10 * durs.reduce((a, b) => a + b, 0)) / durs.length) / 10 : null },
      lastRun: { at: last.run_started_at, conclusion: last.conclusion },
    });
  }
}
const order = { live: 0, degraded: 1, dormant: 2, auto: 3 };
agents.sort((a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9) || a.repo.localeCompare(b.repo) || a.name.localeCompare(b.name));

const withAgent = new Set(agents.map((a) => a.repo));
const reg = {
  ok: true,
  generatedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  source: "github-actions-api",
  reposTotal: REPOS.length,
  reposWithAgents: REPOS.filter((r) => withAgent.has(r)),
  reposIdle: REPOS.filter((r) => !withAgent.has(r)),
  agents,
};

const path = new URL(import.meta.url.replace("watch.mjs", "registry.json")).pathname;
const out = process.env.REGISTRY_PATH || "agents/registry.json";
const prev = existsSync(out) ? JSON.parse(readFileSync(out, "utf8")) : null;
writeFileSync(out, JSON.stringify(reg, null, 1) + "\n");
const changed = !prev || JSON.stringify(prev.agents) !== JSON.stringify(reg.agents);
console.log(`agents: ${agents.length} | repos with agents: ${withAgent.size}/14 | changed: ${changed}`);
process.env.REGISTRY_CHANGED = changed ? "1" : "0";

// ═══ GH-SNAPSHOT (Task 49) - רשת-ביטחון למכסת-הדפדפן ═══
// הבעיה הנמדדת: ה-API הציבורי של גיטהאב מוגבל ל-60 בקשות/שעה לכל IP
// אלמוני - כלומר כמעט כל מבקר בקונסולה רואה "ה-API הוגבל" בתצוגות
// האקוסיסטם והשרת במקום נתונים. הפתרון: אותו רץ ענן עם הטוקן כותב
// גם תמונת-מצב (ריפואים + ריצות אחרונות) שהדפדפן קורא כשה-API נכשל -
// בכנות מתויגת כתמונת-מצב עם גילה, לא כנתונים חיים.
try {
  // אוסף ריפואים: ניסיון אחד ל-org, ואם הטוקן צר-היקף - נפילה כנה
  // למפה פר-ריפו (אותה רשימת 14 שכבר מזינה את הרישום).
  let orgRepos = null;
  try {
    orgRepos = await api(`https://api.github.com/orgs/${OWNER}/repos?per_page=100`);
  } catch { orgRepos = null; }
  if (!orgRepos) {
    orgRepos = [];
    for (const r of REPOS) {
      try { orgRepos.push(await api(`https://api.github.com/repos/${OWNER}/${r}`)); }
      catch (e) { console.error(`repo ${r}: ${e.message}`); }
    }
  }
  const consoleRuns = await api(`https://api.github.com/repos/${OWNER}/Console/actions/runs?per_page=8`);
  const snap = {
    ok: true,
    format: "gh-snapshot-v1",
    generatedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    source: "github-actions-api (token, hourly agents-watch run)",
    purpose: "browser fallback when api.github.com is rate-limited for anonymous visitors",
    repos: orgRepos.map((r) => ({
      name: r.name, pushed_at: r.pushed_at, updated_at: r.updated_at,
      html_url: r.html_url, visibility: r.visibility, archived: r.archived,
    })),
    runs: (consoleRuns.workflow_runs || []).map((r) => ({
      name: r.name, status: r.status, conclusion: r.conclusion,
      created_at: r.created_at, updated_at: r.updated_at, html_url: r.html_url,
    })),
  };
  writeFileSync("agents/gh-snapshot.json", JSON.stringify(snap, null, 1) + "\n");
  console.log(`gh-snapshot: ${snap.repos.length} repos, ${snap.runs.length} runs`);
} catch (e) { console.error(`gh-snapshot (honest skip): ${e.message}`); }
