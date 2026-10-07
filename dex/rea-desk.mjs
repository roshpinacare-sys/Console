#!/usr/bin/env node
/* REA-DESK (R74) · שולחן-ההנדסה-לאחור הריבוני
 *
 * השורה התחתונה של המשתמש: "להבין איך התותחים עשו הון ולהחדיר את זה לריבונות".
 * הכלי: rea-agents (morluto/rea · MIT · "Reverse engineer anything with agents") —
 * רץ keyless על ה-runner הציבורי (Ubuntu 24.04 = המארח הנתמך הרשמי של rea).
 * השיטה: לכידה סטטית פסיבית של משטחים-פומביים בלבד — ה-HTML וה-bundles שהענקים
 * מגישים לכל דפדפן בעולם · אפס-התחזות · אפס-אימות · אפס-סודות · evidence-first.
 *
 * מה השולחן מפיק בכל ריצה (dex/rea.json):
 *   1. עדות-כלים: גרסת rea + doctor (סביבת-ה-runner הציבורי)
 *   2. לכידות: לכל יעד פומבי · status, גודל-עמוד, bundles, נקודות-API ציבוריות שדולפות מהקוד
 *   3. מגבלות: מה שהשולחן עוד לא עושה (ריצות-CDP) נרשם בגוף-הספר כמו-שהוא
 *
 * הרצה: node dex/rea-desk.mjs   (runner ציבורי · node 20 · ubuntu-latest)
 */
'use strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const OUT = new URL('./rea.json', import.meta.url).pathname;
const TARGETS = new URL('./rea-targets.json', import.meta.url).pathname;
const UA = 'saos-rea-desk/1.0 (passive public-surface evidence; repo roshpinacare-sys/Console)';
const BUNDLE_CAP = 350 * 1024; /* קריאת-חתך לכל bundle · לא מורידים את כל העולם */

function sh(args, opts = {}) {
  /* מריץ כלי מקומי · מחזיר stdout גם כשה-exit-code לא אפס (doctor "unhealthy" זו עדות לגיטימית) */
  try {
    return { code: 0, out: execFileSync(args[0], args.slice(1), { timeout: 240000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }) };
  } catch (e) {
    return { code: e.status || 1, out: (e.stdout || '') + (e.stderr || ''), err: e.message || String(e) };
  }
}

async function jget(url, ms = 20000, cap = 0) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, signal: ac.signal });
    const status = res.status;
    let text = '';
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      text = buf.subarray(0, cap || buf.length).toString('utf8');
      return { status, bytes: buf.length, text };
    }
    return { status, bytes: 0, text: '' };
  } finally {
    clearTimeout(t);
  }
}

function extractScripts(html, baseUrl) {
  const out = [];
  const re = /<script[^>]*\ssrc=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const u = new URL(m[1], baseUrl);
      if (u.origin !== new URL(baseUrl).origin) continue;
      out.push(u.toString());
    } catch (_) { /* src לא-תקני · לא עדות */ }
    if (out.length >= 8) break;
  }
  return [...new Set(out)];
}

const EP_RE = /https?:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?::\d{2,5})?(?:\/[A-Za-z0-9\-._~!$&'()*+,;=:@%]*)?/g;
function extractEndpoints(bundleText) {
  const keep = new Set();
  let m;
  EP_RE.lastIndex = 0;
  while ((m = EP_RE.exec(bundleText))) {
    const raw = m[0];
    if (/\.(js|css|png|svg|jpe?g|woff2?|gif|ico|map)(\?|$)/i.test(raw)) continue;
    if (!/(api|gateway|graphql|\/v[1-9]|rpc|query|subgraph)/i.test(raw)) continue;
    try {
      const u = new URL(raw);
      keep.add(u.origin + u.pathname);
    } catch (_) { /* לא-תקני */ }
    if (keep.size >= 10) break;
  }
  return [...keep];
}

async function probeTarget(t) {
  const rec = { id: t.id, url: t.url, label: t.label || t.id };
  try {
    const t0 = Date.now();
    const page = await jget(t.url, 20000);
    rec.status = page.status;
    rec.ms = Date.now() - t0;
    rec.pageBytes = page.bytes;
    const title = /<title[^>]*>([^<]{0,180})<\/title>/i.exec(page.text);
    rec.pageTitle = title ? title[1].trim() : null;
    rec.scripts = [];
    if (page.ok !== false && page.status === 200) {
      const urls = extractScripts(page.text, t.url);
      for (const u of urls.slice(0, 4)) {
        try {
          const b = await jget(u, 20000, BUNDLE_CAP);
          if (b.status !== 200) { rec.scripts.push({ url: u, status: b.status }); continue; }
          rec.scripts.push({
            url: u,
            bytes: b.bytes,
            sha256: createHash('sha256').update(b.text).digest('hex').slice(0, 16),
            endpoints: extractEndpoints(b.text)
          });
        } catch (e) {
          rec.scripts.push({ url: u, error: String(e && e.message ? e.message : e).slice(0, 120) });
        }
      }
    }
  } catch (e) {
    rec.error = String(e && e.message ? e.message : e).slice(0, 200);
  }
  return rec;
}

async function main() {
  const runAt = new Date().toISOString();
  const limitations = [];

  /* 1 · עדות-כלים: rea-agents על המארח הזה */
  const ver = sh(['npx', '-y', 'rea-agents', '--version']);
  const reaVersion = (ver.out || '').trim().split('\n').filter(Boolean).pop() || null;
  const doc = sh(['npx', '-y', 'rea-agents', 'doctor', '--format', 'json']);
  let doctor = null;
  try {
    const s = doc.out.indexOf('{');
    doctor = s >= 0 ? JSON.parse(doc.out.slice(s)) : { raw: (doc.out || '').slice(0, 400) };
  } catch (_) {
    doctor = { raw: (doc.out || '').slice(0, 400) };
  }
  if (!doctor.healthy) {
    limitations.push('rea doctor reports unhealthy on this host: native/browser lanes require the supported-runner lane (Ubuntu 24.04 on the public runner) · recorded as-is, evidence-first');
  }

  /* 2 · לכידות פסיביות של המשטחים-הפומביים */
  let targets = [];
  try {
    const cfg = JSON.parse(readFileSync(TARGETS, 'utf8'));
    targets = cfg.targets || [];
  } catch (e) {
    limitations.push('targets config unreadable: ' + String(e && e.message ? e.message : e));
  }
  const probes = [];
  for (const t of targets) {
    probes.push(await probeTarget(t));
  }

  /* 3 · מגבלות-גרסה (כנות-מלאה בגוף-הספר) */
  limitations.push('v1 desk lane = static passive capture only · CDP browser captures (rea analyze-web-bundle / capture-web-screenshot) are the scheduled R-lane on the public runner with Chrome');
  limitations.push('bundle reads are capped at ' + BUNDLE_CAP + ' bytes · endpoints are public-URL heuristics from the bundles, never private data');

  const book = {
    ok: true,
    book: 'saos-rea/1.0',
    publishedAt: new Date().toISOString(),
    beat: {
      engine: 'saos-rea/1.0 rea-desk · R74 sovereign reverse-engineering desk',
      runAt,
      cadenceMin: 10080,
      tool: { package: 'rea-agents', version: reaVersion, upstream: 'https://github.com/morluto/rea', license: 'MIT', pinnedSha: '96a46ada0a36f0349f2b0fc20b4c932401b4ad84' },
      method: 'passive public-surface capture · zero auth · zero secrets · evidence-first · fail-closed'
    },
    rea: { version: reaVersion, doctor },
    targets: probes,
    limitations
  };
  writeFileSync(OUT, JSON.stringify(book, null, 2) + '\n');
  const okN = probes.filter((p) => p.status === 200).length;
  const epN = probes.reduce((s, p) => s + (p.scripts || []).reduce((s2, sc) => s2 + ((sc.endpoints || []).length), 0), 0);
  console.log('rea-desk: rea ' + (reaVersion || 'n/a') + ' · ' + okN + '/' + probes.length + ' targets captured · ' + epN + ' public endpoints · doctor healthy=' + (doctor && doctor.healthy ? 'true' : 'false'));
}

main().catch((e) => {
  try {
    writeFileSync(OUT, JSON.stringify({
      ok: false,
      book: 'saos-rea/1.0',
      publishedAt: new Date().toISOString(),
      beat: { engine: 'saos-rea/1.0 rea-desk · R74', runAt: new Date().toISOString(), method: 'fail-closed publish' },
      targets: [],
      limitations: ['fatal: ' + String(e && e.message ? e.message : e)]
    }, null, 2) + '\n');
  } catch (_) { /* nothing else to do */ }
  console.error('rea-desk fatal (book published with failure evidence):', e && e.message ? e.message : e);
  process.exit(0);
});
