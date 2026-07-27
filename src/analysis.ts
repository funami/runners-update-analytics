/**
 * SplitsDataset を分析し、
 *  - 地点ごとの「通過時間帯(既定1分刻み)の通過者数 / 完走者数 / 完走率」
 *  - 選手別の各地点通過時刻を並べた表形式（ワイド）データ
 * を生成する。
 */

import type {
  CheckpointFinishAnalysis,
  PassBin,
  RaceAnalysis,
  RunnerSplits,
  SplitsDataset,
} from './types.js';
import { formatSeconds } from './util/time.js';

/** "HH:MM(:SS)" を 00:00 からの秒に。失敗時 undefined。 */
export function parseClock(hhmm: string | undefined): number | undefined {
  if (!hhmm) return undefined;
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return undefined;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
}

/** 経過秒 + 号砲時刻 → 時計表示 "HH:MM(:SS)"。号砲未指定なら undefined。 */
export function clockLabel(
  grossSec: number,
  startSec: number | undefined,
  withSeconds = false,
): string | undefined {
  if (startSec == null) return undefined;
  const t = Math.floor(startSec + grossSec);
  const h = Math.floor(t / 3600) % 24;
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return withSeconds ? `${p(h)}:${p(m)}:${p(s)}` : `${p(h)}:${p(m)}`;
}

/** 1 地点ぶんの通過時刻×完走率を集計。 */
function analyzeCheckpoint(
  checkpoint: string,
  order: number,
  goal: boolean,
  runners: RunnerSplits[],
  binSec: number,
  startSec: number | undefined,
): CheckpointFinishAnalysis {
  // この地点を通過した選手のみ
  const passers = runners
    .map((r) => ({ gross: r.grossByCheckpoint[checkpoint], finished: r.finished }))
    .filter((x): x is { gross: number; finished: boolean } => x.gross != null);

  const totalPassers = passers.length;
  const totalFinishers = passers.filter((p) => p.finished).length;

  const bins = new Map<number, { passers: number; finishers: number }>();
  for (const p of passers) {
    const binStart = Math.floor(p.gross / binSec) * binSec;
    const b = bins.get(binStart) ?? { passers: 0, finishers: 0 };
    b.passers += 1;
    if (p.finished) b.finishers += 1;
    bins.set(binStart, b);
  }

  const binList: PassBin[] = [...bins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([startSecBin, v]) => ({
      startSec: startSecBin,
      endSec: startSecBin + binSec,
      elapsedLabel: formatSeconds(startSecBin),
      clockLabel: clockLabel(startSecBin, startSec),
      passers: v.passers,
      finishers: v.finishers,
      finishRate: v.passers > 0 ? v.finishers / v.passers : null,
    }));

  // 完走率が初めて 50% を割るビン（関門の目安）。ゴール地点自身は対象外。
  let cutoff: number | null = null;
  if (!goal) {
    for (const b of binList) {
      if (b.finishRate != null && b.finishRate < 0.5) {
        cutoff = b.startSec;
        break;
      }
    }
  }

  return {
    checkpoint,
    order,
    goal,
    totalPassers,
    totalFinishers,
    overallFinishRate: totalPassers > 0 ? totalFinishers / totalPassers : null,
    bins: binList,
    finishRate50CutoffSec: cutoff,
  };
}

/** データセット全体を分析する。 */
export function analyze(dataset: SplitsDataset, binMinutes = 1): RaceAnalysis {
  const binSec = Math.max(1, Math.round(binMinutes * 60));
  const startSec = parseClock(dataset.startTime);
  const runners = dataset.runners;

  const totalRunners = runners.length;
  const finishers = runners.filter((r) => r.finished).length;

  const checkpoints = dataset.checkpoints
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((c) => analyzeCheckpoint(c.name, c.order, c.goal, runners, binSec, startSec));

  const notes = [...dataset.notes];
  if (startSec == null) {
    notes.push(
      '号砲時刻(startTime)未指定のため、通過時刻は「経過時間(グロス)」で表示します。' +
        'マニフェストに startTime を指定すると実時刻(clock)も併記します。',
    );
  }

  return {
    raceId: dataset.raceId,
    raceName: dataset.raceName,
    raceDate: dataset.raceDate,
    kind: dataset.kind,
    startTime: dataset.startTime,
    fetchedAt: dataset.fetchedAt,
    binMinutes,
    totalRunners,
    finishers,
    finishRate: totalRunners > 0 ? finishers / totalRunners : null,
    checkpoints,
    notes,
    weather: dataset.weather,
  };
}

/**
 * 選手別の各地点通過タイムを並べたワイド表を作る（CSV/監査用）。
 * 各地点につき「グロス(経過)」列を出す（通過時刻は出さない）。
 *
 * 行の並びは「最終到達地点が遠い順（完走者→より先の地点で止まった選手→より手前で
 * 止まった選手）」、同じ最終到達地点の中では「その地点への到達(グロス)が早い順」。
 */
export function buildWideTable(dataset: SplitsDataset): (string | number)[][] {
  const cps = dataset.checkpoints.slice().sort((a, b) => a.order - b.order);
  const orderByCheckpoint = new Map(cps.map((c) => [c.name, c.order]));

  const header: string[] = ['Bib', '氏名'];
  for (const c of cps) {
    header.push(`${c.name} グロス`);
  }
  header.push('完走', 'ゴールグロス', '最終到達地点');

  const sortedRunners = dataset.runners.slice().sort((a, b) => {
    const oa = a.lastCheckpoint != null ? orderByCheckpoint.get(a.lastCheckpoint) ?? -1 : -1;
    const ob = b.lastCheckpoint != null ? orderByCheckpoint.get(b.lastCheckpoint) ?? -1 : -1;
    if (oa !== ob) return ob - oa; // 最終到達地点が遠い(order が大きい)順
    const ga = a.lastCheckpoint != null ? (a.grossByCheckpoint[a.lastCheckpoint] ?? Infinity) : Infinity;
    const gb = b.lastCheckpoint != null ? (b.grossByCheckpoint[b.lastCheckpoint] ?? Infinity) : Infinity;
    return ga - gb; // 同一地点内はその地点への到達が早い順
  });

  const rows: (string | number)[][] = [header];
  for (const r of sortedRunners) {
    const row: (string | number)[] = [r.bib, r.name ?? ''];
    for (const c of cps) {
      const g = r.grossByCheckpoint[c.name];
      row.push(g != null ? formatSeconds(g) : '');
    }
    row.push(
      r.finished ? '完走' : '未完走',
      r.finishGrossSeconds != null ? formatSeconds(r.finishGrossSeconds) : '',
      r.lastCheckpoint ?? '',
    );
    rows.push(row);
  }
  return rows;
}

/** 分析結果を「地点 × 経過時間帯」の縦持ち CSV 行に。 */
export function buildFinishRateTable(analysis: RaceAnalysis): (string | number)[][] {
  const header = ['地点', '経過時間帯', '通過者数', '完走者数', '完走率(%)'];
  const rows: (string | number)[][] = [header];
  for (const cp of analysis.checkpoints) {
    for (const b of cp.bins) {
      rows.push([
        cp.checkpoint,
        b.elapsedLabel,
        b.passers,
        b.finishers,
        b.finishRate != null ? (b.finishRate * 100).toFixed(1) : '',
      ]);
    }
  }
  return rows;
}
