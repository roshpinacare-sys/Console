// runtime-pacemaker.mjs — the ignition layer that does not trust the platform scheduler.
// ═══════════════════════════════════════════════════════════════════════════════
// Measured law (2026-10-12 census): GitHub's scheduler fires reliably on the
// estate's older repos (Console 2,500 schedule runs, saos-runtime, FleetHQ) and
// silently drops 100% of schedules on the newer runtime repos (Autonomy, Pulse,
// GridWatch: ZERO schedule runs ever, crons defined at HEAD, workflows active).
// Result: the runtime brain only beats when an agent session is awake — the
// exact "network shutting itself off" the owner diagnosed.
//
// Engineering answer (no platform trust, no sandbox, no agent dependency):
//   SENSE  — measure last-run age of every critical runtime lane via the API.
//   DECIDE — age > SLA (2x nominal cadence) and last run not already running
//            => the lane is late; ignite it.
//   ACT    — workflow_dispatch via CROSS_REVIVE_PAT (the estate's delegated
//            cross-repo authority, already used by opens-closer). Budget-capped
//            per cycle so a mass outage cannot self-DoS (GridWatch measured a
//            79-dispatch stampede once — that class stays extinct).
//   RECORD — one honest receipt line per cycle into pacemaker/state/beats.jsonl
//            (commit lives in git = visible proof). If this receipt stops
//            updating, the pacemaker itself is dead — that is also an alarm.
//
// Honesty laws: never fake an ignition; a lane that fails stays red on its own
// board (this lane ignites, it never silences); DRYRUN=1 measures and reports
// without dispatching (used by selftest and by humans).
// ═══════════════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';

const ORG = 'roshpinacare-sys';
const REPO = 'FleetHQ';
const BUDGET = parseInt(process.env.PACEMAKER_BUDGET || '8', 10);
const DRYRUN = process.env.DRYRUN === '1';
const API = 'https://api.github.com';

// ── targets: the runtime brain. slaMin ≈ 2x the nominal cron cadence. ─────────
// Cadences measured from the ymls at HEAD on 2026-10-12 (see each repo).
const TARGETS = [
  // control plane + census (their own crons never fire — measured zero)
  { repo: 'GridWatch', wf: 'grid-watch.yml',        slaMin: 70,  why: 'control-plane conductor; own cron dead' },
  { repo: 'Pulse',     wf: 'heartbeat.yml',         slaMin: 70,  why: 'census organ; own cron dead' },
  // Autonomy arteries — the public runtime brain
  { repo: 'Autonomy',  wf: 'artery-watch.yml',      slaMin: 40,  why: 'cadence 15' },
  { repo: 'Autonomy',  wf: 'artery-grid.yml',       slaMin: 70,  why: 'cadence 30' },
  { repo: 'Autonomy',  wf: 'artery-catchup.yml',    slaMin: 70,  why: 'cadence 30' },
  { repo: 'Autonomy',  wf: 'artery-decision-truth.yml', slaMin: 70, why: 'cadence 30' },
  { repo: 'Autonomy',  wf: 'federation.yml',        slaMin: 70,  why: 'cadence 30' },
  { repo: 'Autonomy',  wf: 'fleet-heal.yml',        slaMin: 70,  why: 'cadence 30' },
  { repo: 'Autonomy',  wf: 'sovereign-state.yml',   slaMin: 70,  why: 'cadence ~30' },
  { repo: 'Autonomy',  wf: 'sovereign.yml',         slaMin: 70,  why: 'sovereign-tick' },
  { repo: 'Autonomy',  wf: 'artery-integrity.yml',  slaMin: 130, why: 'cadence 60' },
  { repo: 'Autonomy',  wf: 'artery-participation.yml', slaMin: 130, why: 'cadence 60' },
  { repo: 'Autonomy',  wf: 'verifier.yml',          slaMin: 130, why: 'truth & quality' },
  // contract plane (R327 — measured 2026-10-14T11:25Z: contract-check has 7 runs,
  // ZERO schedule fires ever; the 23/30 cron was born-silent on this host. The
  // workflow itself is the estate's receipt-law verifier — it went red 07:16Z
  // and was repaired same-hour by the fleet (9b766a0), but nothing watches the
  // watcher. slaMin 70 ≈ 2x the nominal 30m cadence.)
  { repo: 'Autonomy',  wf: 'contract-check.yml',    slaMin: 70,  why: 'receipt-law verifier; own cron born-silent (0 schedule fires in 7 runs); 30m cadence' },
  // engine plane (native cron proven firing — wide SLA, ignite only if truly stalled)
  { repo: 'saos-runtime', wf: 'sovereign-runtime.yml', slaMin: 150, why: 'engine pulse; native cron alive' },
  { repo: 'saos-runtime', wf: 'grid-watchdog.yml',     slaMin: 180, why: 'watchdog backstop' },
  // lighthouse plane (born AFTER the 2026-10-12 census — new-repo scheduler law
  // measured live 2026-10-14: estate-redboard ZERO schedule fires ever, pulse
  // ~12% fire rate; the board is the estate's ONE red alarm, so it rides here)
  { repo: 'sovereign-lighthouse', wf: 'estate-redboard.yml',  slaMin: 70, why: 'the ONE red board; born post-census; own cron dead' },
  { repo: 'sovereign-lighthouse', wf: 'lighthouse-pulse.yml', slaMin: 70, why: 'lighthouse pulse; schedule starved on new repo' },
  // income plane (R326 — measured 2026-10-14T06:55Z: 21/21 treasury + 2/2 army
  // runs are workflow_dispatch, ZERO schedule fires ever; today's 05:41Z and
  // 03:23Z crons starved. saos-runtime is the R280 public host — new-workflow
  // schedule registration is the measured new-repo scheduler law, again. The
  // income arteries ride the pacemaker. SLA is tight BY DESIGN (deviation from
  // the 2x law, recorded): a starved cron silently halves the 2/day income
  // cadence; an extra ignition is bounded by the ladders' own canary caps
  // (≤0.3/leg, ≤0.6 open STEEM, kill-law, maker-only book-law).
  { repo: 'saos-runtime', wf: 'treasury-ladder.yml', slaMin: 780, why: 'income artery; cron starved on new host; 12h cadence + 1h jitter guard' },
  { repo: 'saos-runtime', wf: 'army-ladder.yml',     slaMin: 780, why: 'army maker artery; cron starved on new host; 12h cadence + 1h jitter guard' },
  // FleetHQ self-watch (same-repo; the self-healers must not be the single quiet point)
  { repo: 'FleetHQ',   wf: 'opens-closer.yml',      slaMin: 40,  why: 'beacon/office reviver' },
  { repo: 'FleetHQ',   wf: 'silence-watchdog.yml',  slaMin: 40,  why: 'alarm channel' },
  { repo: 'FleetHQ',   wf: 'office-heartbeat.yml',  slaMin: 260, why: 'cadence 120' },
  // meta-voice: this pacemaker watches itself; GridWatch's ACT layer (once alive)
  // will also re-ignite it if it ever goes stale — mutual watch, no single point.
  { repo: 'FleetHQ',   wf: 'runtime-pacemaker.yml', slaMin: 40,  why: 'meta-voice' },
  { repo: 'Console',   wf: 'runtime-pacemaker.yml', slaMin: 40,  why: 'second-host meta-voice' },
];

const H = (tok) => ({
  Authorization: `token ${tok}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'runtime-pacemaker',
});

function gh(tok, path, opts = {}) {
  return fetch(`${API}${path}`, { headers: H(tok), ...opts })
    .then(async (r) => {
      let body = null;
      try { body = await r.json(); } catch { /* 204 etc */ }
      return { status: r.status, body };
    })
    .catch((e) => ({ status: 0, body: null, error: String(e) }));
}

async function measure(tok, t) {
  const r = await gh(tok, `/repos/${ORG}/${t.repo}/actions/workflows/${t.wf}/runs?per_page=1`);
  if (r.status !== 200 || !r.body?.workflow_runs) {
    return { ...t, ok: false, note: `api ${r.status}` };
  }
  const last = r.body.workflow_runs[0] || null;
  if (!last) return { ...t, ok: true, ageMin: null, note: 'never-ran' };
  const ageMin = Math.round((Date.now() - new Date(last.created_at).getTime()) / 60000);
  return {
    ...t,
    ok: true,
    ageMin,
    lastEvent: last.event,
    lastConclusion: last.conclusion || last.status,
    lastRunUrl: last.html_url,
  };
}

async function main() {
  const crossTok = process.env.CROSS_REVIVE_PAT || '';
  const ghTok = process.env.GH_TOKEN || '';
  const tok = crossTok || ghTok;
  const now = new Date().toISOString();

  if (!tok) {
    // honest no-fake: measure nothing, say nothing clever, fail visibly
    console.log(JSON.stringify({ at: now, verdict: 'NO-TOKEN', note: 'no CROSS_REVIVE_PAT and no GH_TOKEN — not faked' }));
    process.exit(1);
  }

  const results = [];
  let budget = BUDGET;
  const ignited = [];
  let nativeSchedule = 0;
  let measured = 0;

  for (const t of TARGETS) {
    const m = await measure(tok, t);
    measured++;
    const row = {
      repo: m.repo, wf: m.wf, ageMin: m.ageMin ?? null,
      lastEvent: m.lastEvent || null, lastConclusion: m.lastConclusion || null,
    };
    if (!m.ok) { results.push({ ...row, action: 'measure-failed', note: m.note }); continue; }
    if (m.lastEvent === 'schedule') nativeSchedule++;
    if (m.ageMin === null) { // never ran
      if (budget > 0 && !DRYRUN) {
        const d = await gh(tok, `/repos/${ORG}/${t.repo}/actions/workflows/${t.wf}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
        budget--;
        results.push({ ...row, action: d.status === 204 ? 'ignited' : 'dispatch-failed', http: d.status, note: m.note });
        if (d.status === 204) ignited.push(`${t.repo}/${t.wf}`);
      } else {
        results.push({ ...row, action: DRYRUN ? 'would-ignite' : 'budget-exhausted', note: m.note });
      }
      continue;
    }
    const running = ['in_progress', 'queued', 'pending', 'waiting'].includes(m.lastConclusion);
    if (running) { results.push({ ...row, action: 'already-running' }); continue; }
    if (m.ageMin > t.slaMin) {
      if (budget > 0 && !DRYRUN) {
        const d = await gh(tok, `/repos/${ORG}/${t.repo}/actions/workflows/${t.wf}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
        budget--;
        results.push({ ...row, action: d.status === 204 ? 'ignited' : 'dispatch-failed', http: d.status, why: t.why });
        if (d.status === 204) ignited.push(`${t.repo}/${t.wf}`);
      } else {
        results.push({ ...row, action: DRYRUN ? 'would-ignite' : 'budget-exhausted', why: t.why });
      }
    } else {
      results.push({ ...row, action: 'on-time' });
    }
  }

  const summary = {
    at: now,
    measured,
    ignitedCount: ignited.length,
    ignited,
    nativeScheduleBeats: nativeSchedule,
    budgetLeft: budget,
    dryrun: DRYRUN,
    results,
  };

  // ── record receipt (append one compact line, keep the file bounded) ──────────
  const dir = path.join(process.cwd(), 'pacemaker', 'state');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'beats.jsonl');
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean); } catch { /* first beat */ }
  lines.push(JSON.stringify({
    at: now, measured, ignitedCount: ignited.length,
    ignited, nativeScheduleBeats: nativeSchedule, dryrun: DRYRUN,
    lanes: results.map(r => `${r.repo}/${r.wf}:${r.ageMin == null ? 'never' : r.ageMin + 'm'}:${r.action}`),
  }));
  if (lines.length > 400) lines = lines.slice(-400);
  fs.writeFileSync(file, lines.join('\n') + '\n');

  console.log(JSON.stringify({ ...summary, results: undefined }, null, 2));
  const table = results.map(r => `  ${String(r.repo + '/' + r.wf).padEnd(44)} ${String(r.ageMin == null ? 'never' : r.ageMin + 'm').padStart(7)} ${r.lastConclusion || '-'}  -> ${r.action}`);
  console.log('\nlanes:\n' + table.join('\n'));
}

main();
