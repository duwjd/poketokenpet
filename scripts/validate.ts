/**
 * Step 1 deliverable: prove the parser is right before any UI exists.
 *
 * Run: npm run validate
 *
 * Checks three things the plan flagged as the real risks:
 *   1. dedupe        — naive summing overcounts ~2.2x
 *   2. timezone      — bucketing by UTC instead of local is a ~31% error
 *   3. ground truth  — PokeTokenBar logs today's total every 60s; compare
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { listTranscripts, parseLine, rollup, sumTotals, type UsageRecord } from '../server/usage.ts';
import { projectsDir } from '../server/paths.ts';

const fmt = (n: number) => n.toLocaleString('en-US');
const compact = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : fmt(n);

async function main() {
  const root = projectsDir();
  if (!fs.existsSync(root)) {
    console.error(`No transcripts at ${root} — nothing to validate.`);
    process.exit(1);
  }

  const t0 = Date.now();
  const files = await listTranscripts(root);

  const deduped = new Map<string, UsageRecord>();
  let naiveTotal = 0;
  let assistantLines = 0;
  let totalLines = 0;

  for (const file of files) {
    const stream = fs.createReadStream(file, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    try {
      for await (const line of rl) {
        totalLines++;
        const rec = parseLine(line);
        if (!rec) continue;
        assistantLines++;
        naiveTotal += sumTotals(rec.totals, 'activity'); // what you get WITHOUT dedupe
        deduped.set(rec.messageId, rec); // last-wins
      }
    } finally {
      rl.close();
      stream.destroy();
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  const r = rollup(deduped.values(), 'activity');
  const billable = rollup(deduped.values(), 'billable');

  console.log(`\n스캔: ${files.length}파일 / ${fmt(totalLines)}줄 / ${elapsed}초\n`);

  // 1. dedupe
  const ratio = naiveTotal / r.totalTokens;
  console.log('── 1. 중복 제거 ────────────────────────────────');
  console.log(`  assistant 라인   : ${fmt(assistantLines)}`);
  console.log(`  고유 message.id  : ${fmt(r.messageCount)}`);
  console.log(`  naive 합산       : ${fmt(naiveTotal)}`);
  console.log(`  dedupe 후        : ${fmt(r.totalTokens)}`);
  console.log(`  과대집계 배수    : ${ratio.toFixed(2)}x   ${ratio > 1.8 ? '✓ 예상(≈2.2x) 범위' : '⚠ 예상보다 낮음'}`);

  // 2. timezone
  const utcDay = new Date().toISOString().slice(0, 10);
  let utcToday = 0;
  for (const rec of deduped.values()) {
    if (rec.timestamp.slice(0, 10) === utcDay) utcToday += sumTotals(rec.totals, 'activity');
  }
  const drift = r.today > 0 ? (Math.abs(r.today - utcToday) / r.today) * 100 : 0;
  console.log('\n── 2. 날짜 버킷팅 ──────────────────────────────');
  console.log(`  타임존           : ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);
  console.log(`  오늘 (로컬)      : ${fmt(r.today)}  (${fmt(r.todayMessages)} messages)`);
  console.log(`  오늘 (UTC)       : ${fmt(utcToday)}`);
  console.log(`  차이             : ${drift.toFixed(1)}%   ← UTC로 세면 이만큼 틀린다`);

  // 3. ground truth
  console.log('\n── 3. 원조 앱과 대조 ───────────────────────────');
  const ref = await readReferenceTotal();
  if (ref == null) {
    console.log('  PokeTokenBar 로그 없음 — 건너뜀');
  } else {
    const diff = Math.abs(r.today - ref.tokens);
    const pct = ref.tokens > 0 ? (diff / ref.tokens) * 100 : 0;
    console.log(`  원조 (${ref.date})  : ${fmt(ref.tokens)}`);
    console.log(`  내 파서 (오늘)   : ${fmt(r.today)}`);
    console.log(
      `  차이             : ${fmt(diff)} (${pct.toFixed(1)}%)   ` +
        (pct < 5 ? '✓ 일치' : '⚠ 확인 필요 — 로그 시점 차이일 수 있음'),
    );
  }

  // breakdowns
  console.log('\n── entrypoint별 (원조 앱이 못 하는 것) ─────────');
  for (const [k, v] of Object.entries(r.byEntrypoint).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(16)} ${compact(v).padStart(8)}`);
  }

  console.log('\n── 최근 8일 ────────────────────────────────────');
  for (const [d, v] of Object.entries(r.byDay).sort().slice(-8)) {
    console.log(`  ${d}  ${fmt(v).padStart(14)}`);
  }

  console.log('\n── 집계 모드 비교 ──────────────────────────────');
  console.log(`  활동량 (캐시 포함): ${fmt(r.totalTokens)}`);
  console.log(`  과금 근사         : ${fmt(billable.totalTokens)}`);
  console.log(
    `  캐시 읽기 비중    : ${(((r.totalTokens - billable.totalTokens) / r.totalTokens) * 100).toFixed(1)}%\n`,
  );
}

/** Latest `refresh done [claude_code:YYYY-MM-DD=N]` from PokeTokenBar's log. */
async function readReferenceTotal(): Promise<{ date: string; tokens: number } | null> {
  const log = path.join(os.homedir(), 'Library', 'Logs', 'PokeTokenBar.log');
  try {
    const text = await fsp.readFile(log, 'utf8');
    const matches = [...text.matchAll(/refresh done \[claude_code:(\d{4}-\d{2}-\d{2})=(\d+)\]/g)];
    const last = matches.at(-1);
    if (!last) return null;
    return { date: last[1], tokens: Number(last[2]) };
  } catch {
    return null;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
