/** RaceAnalysis + SplitsDataset から自己完結型 HTML ダッシュボードを生成する。 */

import type { RaceAnalysis, SplitsDataset } from '../types.js';
import { buildWideTable, parseClock } from '../analysis.js';
import { formatSeconds } from '../util/time.js';
import { esc, stackedBarSvg, rateLineSvg } from './svg.js';

function pct(v: number | null): string {
  return v == null ? '-' : `${(v * 100).toFixed(1)}%`;
}

function kpiCard(label: string, value: string, sub?: string): string {
  return `<div class="kpi"><div class="kpi-v">${esc(value)}</div><div class="kpi-l">${esc(
    label,
  )}</div>${sub ? `<div class="kpi-s">${esc(sub)}</div>` : ''}</div>`;
}

function checkpointSection(cp: RaceAnalysis['checkpoints'][number], useClock: boolean): string {
  const cutoff =
    cp.finishRate50CutoffSec != null
      ? `完走率50%割れの目安: 経過 ${formatSeconds(cp.finishRate50CutoffSec)} 以降`
      : cp.goal
        ? 'ゴール地点'
        : '完走率50%割れの時間帯は検出されませんでした';

  const rows = cp.bins
    .map(
      (b) => `<tr>
      <td class="num">${esc(useClock && b.clockLabel ? b.clockLabel : b.elapsedLabel)}</td>
      <td class="num">${b.passers}</td>
      <td class="num">${b.finishers}</td>
      <td class="num">${b.finishRate != null ? (b.finishRate * 100).toFixed(1) : '-'}</td>
    </tr>`,
    )
    .join('');

  return `<section class="cp">
    <h2>${esc(cp.checkpoint)}${cp.goal ? ' <span class="badge">ゴール</span>' : ''}</h2>
    <div class="cp-kpis">
      ${kpiCard('通過者数', String(cp.totalPassers))}
      ${kpiCard('完走者数', String(cp.totalFinishers))}
      ${kpiCard('通過者の完走率', pct(cp.overallFinishRate))}
    </div>
    <p class="cutoff">${esc(cutoff)}</p>
    <figure>
      <figcaption>通過時間帯ごとの通過者数（<span class="sw sw-fin"></span>完走 / <span class="sw sw-dnf"></span>未完走）</figcaption>
      ${stackedBarSvg(cp, useClock)}
    </figure>
    ${
      cp.goal
        ? ''
        : `<figure>
      <figcaption>通過時刻ごとの完走率</figcaption>
      ${rateLineSvg(cp, useClock)}
    </figure>`
    }
    <details>
      <summary>データ表（${cp.bins.length} 行）</summary>
      <div class="tbl-wrap">
      <table class="data">
        <thead><tr><th>${useClock ? '通過時刻帯' : '経過時間帯'}</th><th>通過者数</th><th>完走者数</th><th>完走率(%)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      </div>
    </details>
  </section>`;
}

function wideTableHtml(dataset: SplitsDataset): string {
  const rows = buildWideTable(dataset);
  if (rows.length <= 1) return '';
  const head = rows[0].map((c) => `<th>${esc(String(c))}</th>`).join('');
  const body = rows
    .slice(1)
    .map(
      (r) =>
        `<tr>${r
          .map((c, i) => `<td class="${i >= 2 ? 'num' : ''}">${esc(String(c))}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  return `<details>
    <summary>選手別 通過タイム表（${rows.length - 1} 名 / 表形式データ）</summary>
    <div class="tbl-wrap">
    <table class="data wide"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    </div>
  </details>`;
}

/** ダッシュボード HTML を生成。 */
export function generateDashboard(analysis: RaceAnalysis, dataset: SplitsDataset): string {
  const useClock = analysis.startTime != null && parseClock(analysis.startTime) != null;
  const title = [analysis.raceName, analysis.kind].filter(Boolean).join(' / ') || 'RUNNET 完走率分析';
  const meta = [
    analysis.raceDate ? `開催日 ${analysis.raceDate}` : '',
    analysis.kind ? `種目 ${analysis.kind}` : '',
    analysis.startTime ? `号砲 ${analysis.startTime}` : '',
    `通過時間帯 ${analysis.binMinutes}分刻み`,
  ]
    .filter(Boolean)
    .join(' ・ ');

  const sections = analysis.checkpoints.map((c) => checkpointSection(c, useClock)).join('\n');

  const notes = analysis.notes.length
    ? `<details class="notes"><summary>注意・データ品質 (${analysis.notes.length})</summary><ul>${analysis.notes
        .map((n) => `<li>${esc(n)}</li>`)
        .join('')}</ul></details>`
    : '';

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — 通過時刻×完走率</title>
<style>
:root{
  color-scheme: light dark;
  --page:#f9f9f7; --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --muted:#898781;
  --grid:#e1e0d9; --axis:#c3c2b7; --border:rgba(11,11,11,.10);
  --c-finish:#1baf7a; --c-dnf:#d7d5cc; --c-rate:#2a78d6; --good:#006300;
}
@media (prefers-color-scheme: dark){
  :root:where(:not([data-theme="light"])){
    --page:#0d0d0d; --surface:#1a1a19; --ink:#fff; --ink2:#c3c2b7; --muted:#898781;
    --grid:#2c2c2a; --axis:#383835; --border:rgba(255,255,255,.10);
    --c-finish:#199e70; --c-dnf:#4a4a46; --c-rate:#3987e5; --good:#0ca30c;
  }
}
:root[data-theme="dark"]{
  --page:#0d0d0d; --surface:#1a1a19; --ink:#fff; --ink2:#c3c2b7; --muted:#898781;
  --grid:#2c2c2a; --axis:#383835; --border:rgba(255,255,255,.10);
  --c-finish:#199e70; --c-dnf:#4a4a46; --c-rate:#3987e5; --good:#0ca30c;
}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);
  font-family:system-ui,-apple-system,"Segoe UI","Hiragino Kaku Gothic ProN",Meiryo,sans-serif;
  line-height:1.5;padding:24px;}
.wrap{max-width:1040px;margin:0 auto}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
h1{font-size:1.5rem;margin:0 0 4px}
.sub{color:var(--ink2);font-size:.9rem;margin:0}
.theme-btn{border:1px solid var(--border);background:var(--surface);color:var(--ink2);
  border-radius:8px;padding:6px 10px;font-size:.85rem;cursor:pointer}
.kpis{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}
.kpi{background:var(--surface);border:1px solid var(--border);border-radius:12px;
  padding:14px 18px;min-width:120px}
.kpi-v{font-size:1.6rem;font-weight:700}
.kpi-l{font-size:.8rem;color:var(--ink2)}
.kpi-s{font-size:.72rem;color:var(--muted)}
.cp{background:var(--surface);border:1px solid var(--border);border-radius:14px;
  padding:18px 20px;margin:18px 0}
.cp h2{margin:0 0 12px;font-size:1.2rem}
.badge{font-size:.7rem;background:var(--c-finish);color:#fff;border-radius:6px;padding:2px 7px;vertical-align:middle}
.cp-kpis{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.cp-kpis .kpi{min-width:100px;padding:10px 14px}
.cp-kpis .kpi-v{font-size:1.25rem}
.cutoff{color:var(--ink2);font-size:.85rem;margin:.2rem 0 1rem}
figure{margin:14px 0}
figcaption{font-size:.85rem;color:var(--ink2);margin-bottom:4px}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 3px 0 8px;vertical-align:baseline}
.sw-fin{background:var(--c-finish)} .sw-dnf{background:var(--c-dnf)}
.chart{width:100%;height:auto;display:block}
.chart .ax{fill:var(--muted);font-size:11px}
.chart .axtitle{fill:var(--ink2);font-size:11px}
.chart text{font-family:system-ui,sans-serif}
.tbl-wrap{overflow-x:auto}
table.data{border-collapse:collapse;font-size:.82rem;width:100%;margin-top:8px}
table.data th,table.data td{border-bottom:1px solid var(--border);padding:4px 8px;text-align:left;white-space:nowrap}
table.data th{color:var(--ink2);font-weight:600}
td.num,.num{text-align:right;font-variant-numeric:tabular-nums}
details{margin:10px 0}
summary{cursor:pointer;color:var(--ink2);font-size:.9rem}
.notes ul{margin:8px 0;padding-left:20px;color:var(--ink2);font-size:.85rem}
footer{color:var(--muted);font-size:.75rem;margin-top:28px;border-top:1px solid var(--border);padding-top:12px}
rect,circle{transition:opacity .1s}
rect:hover,circle:hover{opacity:.75}
</style>
</head>
<body>
<div class="wrap">
<header>
  <div>
    <h1>${esc(title)}</h1>
    <p class="sub">${esc(meta)}</p>
    <p class="sub">通過時刻ごとの完走率 — 各地点をその時刻に通過した選手のうち、山頂ゴールに到達した割合</p>
  </div>
  <button class="theme-btn" onclick="(function(){var r=document.documentElement;var d=r.getAttribute('data-theme')==='dark';r.setAttribute('data-theme',d?'light':'dark')})()">◐ テーマ切替</button>
</header>

<div class="kpis">
  ${kpiCard('エントリー(通過選手)', String(analysis.totalRunners))}
  ${kpiCard('完走者', String(analysis.finishers))}
  ${kpiCard('全体完走率', pct(analysis.finishRate))}
  ${kpiCard('地点数', String(analysis.checkpoints.length))}
</div>

${sections}

${wideTableHtml(dataset)}

${notes}

<footer>
  生成: ${esc(analysis.fetchedAt)} ・ このツール runners-update-analytics による自動生成。<br>
  データ出典: RUNNET ランナーズアップデート（${esc(
    analysis.raceId ? `raceId=${analysis.raceId}` : '大会結果',
  )}）。速報値は暫定であり、確報で変動する場合があります。
</footer>
</div>
</body>
</html>`;
}
