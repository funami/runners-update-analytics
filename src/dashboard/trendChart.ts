/** 目次ページ用: 大会をまたいだ関門通過者数の推移グラフ。 */

import type { RaceAnalysis } from '../types.js';
import { esc, niceTicks } from './svg.js';

export interface TrendRow {
  raceNumber: number;
  dir: string;
  raceName?: string;
  /** 馬返し通過者数。 */
  umagaeshi: number | null;
  /** 五合目関門の制限時間内通過者数。 */
  gogome: number | null;
  /** 八合目関門の制限時間内通過者数。 */
  hachigome: number | null;
  /** 完走者数（ゴール制限時間内）。記録がゴールのみの大会(finishOnly)は不明のため null。 */
  finishers: number | null;
}

function findCheckpoint(analysis: RaceAnalysis, keyword: string) {
  return analysis.checkpoints.find((c) => c.checkpoint.includes(keyword));
}

/** RaceIndexEntry[] から「第N回」順の推移データ行を作る（回数を抽出できない大会は除外）。 */
export function buildTrendRows(entries: { dir: string; analysis: RaceAnalysis }[]): TrendRow[] {
  const withNumber = entries
    .map((e) => {
      const m = e.analysis.raceName?.match(/第(\d+)回/);
      return m ? { dir: e.dir, analysis: e.analysis, raceNumber: Number(m[1]) } : null;
    })
    .filter((x): x is { dir: string; analysis: RaceAnalysis; raceNumber: number } => x != null)
    .sort((a, b) => a.raceNumber - b.raceNumber);

  return withNumber.map(({ dir, analysis, raceNumber }) => {
    const finishOnly = analysis.checkpoints.length === 1;
    const uma = findCheckpoint(analysis, '馬返し');
    const gogo = findCheckpoint(analysis, '五合目');
    const hachi = findCheckpoint(analysis, '八合目');
    return {
      raceNumber,
      dir,
      raceName: analysis.raceName,
      umagaeshi: uma ? uma.totalPassers : null,
      gogome: gogo?.withinCutoff ?? null,
      hachigome: hachi?.withinCutoff ?? null,
      finishers: finishOnly ? null : analysis.finishers,
    };
  });
}

interface SeriesSpec {
  key: 'umagaeshi' | 'gogome' | 'hachigome' | 'finishers';
  label: string;
  colorVar: string;
}

export const TREND_SERIES: SeriesSpec[] = [
  { key: 'umagaeshi', label: '馬返し 通過者数', colorVar: '--tr-1' },
  { key: 'gogome', label: '五合目 関門内通過者数', colorVar: '--tr-2' },
  { key: 'hachigome', label: '八合目 関門内通過者数', colorVar: '--tr-3' },
  { key: 'finishers', label: '完走者数（制限時間内）', colorVar: '--tr-4' },
];

/** 複数系列の折れ線グラフ（年度別の人数推移）。 */
export function trendLineSvg(rows: TrendRow[]): string {
  const W = 960;
  const H = 320;
  const m = { top: 16, right: 16, bottom: 40, left: 44 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const n = rows.length;
  const band = n > 1 ? iw / (n - 1) : 0;
  const x = (i: number) => (n > 1 ? m.left + i * band : m.left + iw / 2);

  const maxVal = Math.max(
    1,
    ...rows.flatMap((r) => TREND_SERIES.map((s) => r[s.key]).filter((v): v is number => v != null)),
  );
  const yTicks = niceTicks(maxVal, 5);
  const y = (v: number) => m.top + ih - (v / maxVal) * ih;

  const parts: string[] = [];
  for (const t of yTicks) {
    const yy = y(t);
    parts.push(
      `<line x1="${m.left}" y1="${yy.toFixed(1)}" x2="${m.left + iw}" y2="${yy.toFixed(
        1,
      )}" stroke="var(--grid)" stroke-width="1"/>`,
      `<text x="${m.left - 6}" y="${(yy + 3).toFixed(1)}" text-anchor="end" class="ax">${t}</text>`,
    );
  }

  rows.forEach((r, i) => {
    parts.push(
      `<text x="${x(i).toFixed(1)}" y="${H - m.bottom + 16}" text-anchor="middle" class="ax">${r.raceNumber}</text>`,
    );
  });

  for (const s of TREND_SERIES) {
    const pts: { i: number; v: number }[] = [];
    rows.forEach((r, i) => {
      const v = r[s.key];
      if (v != null) pts.push({ i, v });
    });
    if (!pts.length) continue;
    const d = pts.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    parts.push(`<path d="${d}" fill="none" stroke="var(${s.colorVar})" stroke-width="2"/>`);
    for (const p of pts) {
      const r = rows[p.i];
      const title = `第${r.raceNumber}回 ${s.label} ${p.v}人`;
      parts.push(
        `<circle cx="${x(p.i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="6" fill="transparent" ` +
          `class="mark" tabindex="0" data-tip="${esc(title)}" onclick="showChartTip(event,this)" ` +
          `onkeydown="if(event.key==='Enter'||event.key===' '){showChartTip(event,this)}">` +
          `<title>${esc(title)}</title></circle>`,
        `<circle cx="${x(p.i).toFixed(1)}" cy="${y(p.v).toFixed(
          1,
        )}" r="3" fill="var(${s.colorVar})" stroke="var(--surface)" stroke-width="1" pointer-events="none"/>`,
      );
    }
  }

  parts.push(
    `<line x1="${m.left}" y1="${m.top + ih}" x2="${m.left + iw}" y2="${
      m.top + ih
    }" stroke="var(--axis)" stroke-width="1"/>`,
    `<text x="${m.left}" y="12" class="axtitle">人数</text>`,
    `<text x="${m.left + iw}" y="${H - 6}" text-anchor="end" class="ax">大会回次（第N回）</text>`,
  );

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="大会回次ごとの関門通過者数・完走者数の推移" preserveAspectRatio="xMinYMin meet" class="chart">${parts.join('')}</svg>`;
}
