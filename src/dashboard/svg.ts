/** 依存の無いインライン SVG チャート生成（ダッシュボード用）。 */

import type { CheckpointFinishAnalysis, PassBin } from '../types.js';

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** x 軸ラベルを間引いて読める本数に。 */
function tickIndices(n: number, maxTicks = 12): Set<number> {
  const set = new Set<number>();
  if (n === 0) return set;
  const step = Math.max(1, Math.ceil(n / maxTicks));
  for (let i = 0; i < n; i += step) set.add(i);
  set.add(n - 1);
  return set;
}

/** 通過者数（完走/未完走の積み上げ）棒グラフ。単一 y 軸（人数）。 */
export function stackedBarSvg(cp: CheckpointFinishAnalysis, useClock: boolean): string {
  const bins = cp.bins;
  const W = 960;
  const H = 300;
  const m = { top: 16, right: 16, bottom: 46, left: 44 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const maxPass = Math.max(1, ...bins.map((b) => b.passers));
  const n = bins.length;
  const band = n > 0 ? iw / n : iw;
  const barW = Math.max(1, Math.min(band - 2, 22));
  const ticks = tickIndices(n);

  const yScale = (v: number) => (v / maxPass) * ih;
  const yTicks = niceTicks(maxPass, 4);

  const label = (b: PassBin) => (useClock && b.clockLabel ? b.clockLabel : b.elapsedLabel);

  const parts: string[] = [];
  // グリッド + y 軸目盛
  for (const t of yTicks) {
    const y = m.top + ih - yScale(t);
    parts.push(
      `<line x1="${m.left}" y1="${y.toFixed(1)}" x2="${m.left + iw}" y2="${y.toFixed(
        1,
      )}" stroke="var(--grid)" stroke-width="1"/>`,
      `<text x="${m.left - 6}" y="${(y + 3).toFixed(
        1,
      )}" text-anchor="end" class="ax">${t}</text>`,
    );
  }
  // 棒
  bins.forEach((b, i) => {
    const x = m.left + i * band + (band - barW) / 2;
    const hFin = yScale(b.finishers);
    const hDnf = yScale(b.passers - b.finishers);
    const yFin = m.top + ih - hFin;
    const yDnf = yFin - hDnf;
    const rate = b.finishRate != null ? `${(b.finishRate * 100).toFixed(0)}%` : '-';
    const title = `${label(b)}  通過 ${b.passers}人 / 完走 ${b.finishers}人 (完走率 ${rate})`;
    // 未完走（上）
    if (hDnf > 0.3)
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${yDnf.toFixed(1)}" width="${barW.toFixed(
          1,
        )}" height="${Math.max(0, hDnf - 1).toFixed(1)}" rx="1.5" fill="var(--c-dnf)" ` +
          `class="mark" tabindex="0" data-tip="${esc(title)}" onclick="showChartTip(event,this)" ` +
          `onkeydown="if(event.key==='Enter'||event.key===' '){showChartTip(event,this)}">` +
          `<title>${esc(title)}</title></rect>`,
      );
    // 完走（下, ベースライン接地）
    if (hFin > 0.3)
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${yFin.toFixed(1)}" width="${barW.toFixed(
          1,
        )}" height="${Math.max(0, hFin).toFixed(1)}" rx="1.5" fill="var(--c-finish)" ` +
          `class="mark" tabindex="0" data-tip="${esc(title)}" onclick="showChartTip(event,this)" ` +
          `onkeydown="if(event.key==='Enter'||event.key===' '){showChartTip(event,this)}">` +
          `<title>${esc(title)}</title></rect>`,
      );
    // x 軸ラベル
    if (ticks.has(i)) {
      const cx = m.left + i * band + band / 2;
      parts.push(
        `<text x="${cx.toFixed(1)}" y="${H - m.bottom + 16}" text-anchor="middle" class="ax">${esc(
          label(b),
        )}</text>`,
      );
    }
  });
  // ベースライン
  parts.push(
    `<line x1="${m.left}" y1="${m.top + ih}" x2="${m.left + iw}" y2="${
      m.top + ih
    }" stroke="var(--axis)" stroke-width="1"/>`,
  );
  // 軸タイトル
  parts.push(
    `<text x="${m.left}" y="12" class="axtitle">人数</text>`,
    `<text x="${m.left + iw}" y="${H - 6}" text-anchor="end" class="ax">${
      useClock ? '通過時刻' : '経過時間'
    }（${escBinLabel(cp)}）</text>`,
  );

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(
    cp.checkpoint,
  )} 通過者数（完走/未完走）" preserveAspectRatio="xMinYMin meet" class="chart">${parts.join('')}</svg>`;
}

/** 完走率（%）折れ線。単一 y 軸 0–100%。 */
export function rateLineSvg(cp: CheckpointFinishAnalysis, useClock: boolean): string {
  const bins = cp.bins;
  const W = 960;
  const H = 220;
  const m = { top: 16, right: 16, bottom: 46, left: 44 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const n = bins.length;
  const band = n > 0 ? iw / n : iw;
  const ticks = tickIndices(n);
  const label = (b: PassBin) => (useClock && b.clockLabel ? b.clockLabel : b.elapsedLabel);

  const x = (i: number) => m.left + i * band + band / 2;
  const y = (rate: number) => m.top + ih - rate * ih;

  const parts: string[] = [];
  // グリッド 0/25/50/75/100
  for (const t of [0, 25, 50, 75, 100]) {
    const yy = y(t / 100);
    const isMid = t === 50;
    parts.push(
      `<line x1="${m.left}" y1="${yy.toFixed(1)}" x2="${m.left + iw}" y2="${yy.toFixed(
        1,
      )}" stroke="${isMid ? 'var(--axis)' : 'var(--grid)'}" stroke-width="1" ${
        isMid ? 'stroke-dasharray="4 3"' : ''
      }/>`,
      `<text x="${m.left - 6}" y="${(yy + 3).toFixed(1)}" text-anchor="end" class="ax">${t}</text>`,
    );
  }
  // 50% ライン注記
  parts.push(`<text x="${m.left + 4}" y="${(y(0.5) - 4).toFixed(1)}" class="ax">50%</text>`);

  // 折れ線（null はギャップ）
  let d = '';
  const pts: { i: number; b: PassBin }[] = [];
  bins.forEach((b, i) => {
    if (b.finishRate == null) {
      d += ' ';
      return;
    }
    const px = x(i);
    const py = y(b.finishRate);
    d += `${d.trim().endsWith('L') || d === '' || d.trim() === '' ? 'M' : 'L'}${px.toFixed(
      1,
    )},${py.toFixed(1)} `;
    pts.push({ i, b });
  });
  // 単純化: 連続線を1本で（欠損は稀）。欠損があってもざっくり繋ぐ。
  const dClean = pts.map((p, k) => `${k === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.b.finishRate!).toFixed(1)}`).join(' ');
  parts.push(`<path d="${dClean}" fill="none" stroke="var(--c-rate)" stroke-width="2"/>`);
  // マーカー + tooltip
  for (const p of pts) {
    const px = x(p.i);
    const py = y(p.b.finishRate!);
    const title = `${label(p.b)}  完走率 ${(p.b.finishRate! * 100).toFixed(1)}% (${p.b.finishers}/${p.b.passers})`;
    parts.push(
      `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="5.5" fill="transparent" ` +
        `class="mark" tabindex="0" data-tip="${esc(title)}" onclick="showChartTip(event,this)" ` +
        `onkeydown="if(event.key==='Enter'||event.key===' '){showChartTip(event,this)}">` +
        `<title>${esc(title)}</title></circle>`,
      `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(
        1,
      )}" r="3.2" fill="var(--c-rate)" stroke="var(--surface)" stroke-width="1" pointer-events="none"/>`,
    );
    if (ticks.has(p.i)) {
      parts.push(
        `<text x="${px.toFixed(1)}" y="${H - m.bottom + 16}" text-anchor="middle" class="ax">${esc(
          label(p.b),
        )}</text>`,
      );
    }
  }
  parts.push(
    `<line x1="${m.left}" y1="${m.top + ih}" x2="${m.left + iw}" y2="${
      m.top + ih
    }" stroke="var(--axis)" stroke-width="1"/>`,
    `<text x="${m.left}" y="12" class="axtitle">完走率(%)</text>`,
  );

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(
    cp.checkpoint,
  )} 通過時刻ごとの完走率" preserveAspectRatio="xMinYMin meet" class="chart">${parts.join('')}</svg>`;
}

function escBinLabel(cp: CheckpointFinishAnalysis): string {
  const first = cp.bins[0];
  if (!first) return '';
  const w = first.endSec - first.startSec;
  return w % 60 === 0 ? `${w / 60}分刻み` : `${w}秒刻み`;
}

/** きりの良い y 目盛を返す。 */
function niceTicks(max: number, count: number): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(Math.round(v));
  return ticks;
}
