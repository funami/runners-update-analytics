/** RaceAnalysis + SplitsDataset から自己完結型 HTML ダッシュボードを生成する。 */

import type { RaceAnalysis, SplitsDataset, WeatherObservation } from '../types.js';
import { buildWideTable } from '../analysis.js';
import { formatSeconds } from '../util/time.js';
import { esc, stackedBarSvg, rateLineSvg } from './svg.js';
import { weatherDetail } from './weather.js';

function pct(v: number | null): string {
  return v == null ? '-' : `${(v * 100).toFixed(1)}%`;
}

function weatherGroupHtml(label: string, w: WeatherObservation): string {
  const detail = esc(weatherDetail(w));
  const content = w.sourceUrl
    ? `<a href="${esc(w.sourceUrl)}" target="_blank" rel="noopener noreferrer">${detail}</a>`
    : detail;
  return `<span class="w-label">${label}（${esc(w.station)}）</span>${content}`;
}

function weatherHtml(weather: RaceAnalysis['weather']): string {
  if (!weather || (!weather.start && !weather.finish)) return '';
  const groups: string[] = [];
  if (weather.start) groups.push(weatherGroupHtml('スタート', weather.start));
  if (weather.finish) groups.push(weatherGroupHtml('ゴール', weather.finish));
  return `<p class="sub weather">${groups.join('<span class="w-sep">｜</span>')}</p>`;
}

function kpiCard(label: string, value: string, sub?: string): string {
  return `<div class="kpi"><div class="kpi-v">${esc(value)}</div><div class="kpi-l">${esc(
    label,
  )}</div>${sub ? `<div class="kpi-s">${esc(sub)}</div>` : ''}</div>`;
}

function checkpointSection(cp: RaceAnalysis['checkpoints'][number], finishOnly: boolean): string {
  const cutoff = finishOnly
    ? 'ゴール記録のみが公開されている大会のため、未完走者数・完走率は不明です。'
    : cp.finishRate50CutoffSec != null
      ? `完走率50%割れの目安: 経過 ${formatSeconds(cp.finishRate50CutoffSec)} 以降`
      : cp.goal
        ? 'ゴール地点'
        : '完走率50%割れの時間帯は検出されませんでした';

  const rows = cp.bins
    .map((b) =>
      finishOnly
        ? `<tr><td class="num">${esc(b.elapsedLabel)}</td><td class="num">${b.passers}</td></tr>`
        : `<tr>
      <td class="num">${esc(b.elapsedLabel)}</td>
      <td class="num">${b.passers}</td>
      <td class="num">${b.finishers}</td>
      <td class="num">${b.finishRate != null ? (b.finishRate * 100).toFixed(1) : '-'}</td>
    </tr>`,
    )
    .join('');

  const cutoffKpi =
    cp.withinCutoff != null
      ? kpiCard('関門通過者数', String(cp.withinCutoff), `制限時間 ${formatSeconds(cp.cutoffSeconds)} 以内`)
      : '';

  const kpis = finishOnly
    ? `${kpiCard('記録あり選手数', String(cp.totalPassers))}${cutoffKpi}`
    : `${kpiCard('通過者数', String(cp.totalPassers))}
      ${kpiCard('完走者数', String(cp.totalFinishers))}
      ${kpiCard('未完走者数', String(cp.totalPassers - cp.totalFinishers))}
      ${kpiCard('通過者の完走率', pct(cp.overallFinishRate))}
      ${cutoffKpi}`;

  return `<section class="cp">
    <h2>${esc(cp.checkpoint)}${cp.goal ? ' <span class="badge">ゴール</span>' : ''}</h2>
    <div class="cp-kpis">
      ${kpis}
    </div>
    <p class="cutoff">${esc(cutoff)}</p>
    <figure>
      <figcaption>${
        finishOnly
          ? '経過時間帯ごとのゴール到達者数'
          : '経過時間帯ごとの通過者数（<span class="sw sw-fin"></span>完走 / <span class="sw sw-dnf"></span>未完走）'
      }</figcaption>
      ${stackedBarSvg(cp)}
    </figure>
    ${
      cp.goal
        ? ''
        : `<figure>
      <figcaption>経過時間ごとの完走率</figcaption>
      ${rateLineSvg(cp)}
    </figure>`
    }
    <details>
      <summary>データ表（${cp.bins.length} 行）</summary>
      <div class="tbl-wrap">
      <table class="data">
        <thead><tr>${
          finishOnly
            ? '<th>経過時間帯</th><th>到達者数</th>'
            : '<th>経過時間帯</th><th>通過者数</th><th>完走者数</th><th>完走率(%)</th>'
        }</tr></thead>
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
        `<tr data-bib="${esc(String(r[0]))}" tabindex="0">${r
          .map((c, i) => `<td class="${i >= 2 ? 'num' : ''}">${esc(String(c))}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  return `<details>
    <summary>選手別 通過タイム表（${rows.length - 1} 名 / 表形式データ・行クリックでグラフ上の位置を表示）</summary>
    <div class="tbl-wrap">
    <table class="data wide"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
    </div>
  </details>`;
}

/** 選手検索・ハイライト用にクライアントへ渡すデータ（各選手の地点別グロス秒）。 */
function buildClientRunners(
  dataset: SplitsDataset,
): { bib: string; name: string; finished: boolean; lastCheckpoint: string | null; splits: Record<string, number> }[] {
  return dataset.runners.map((r) => ({
    bib: r.bib,
    name: r.name ?? '',
    finished: r.finished,
    lastCheckpoint: r.lastCheckpoint ?? null,
    splits: r.grossByCheckpoint,
  }));
}

/** ダッシュボード HTML を生成。 */
export function generateDashboard(analysis: RaceAnalysis, dataset: SplitsDataset): string {
  const title = [analysis.raceName, analysis.kind].filter(Boolean).join(' / ') || 'ランナーズアップデート 分析';
  const meta = [
    analysis.raceDate ? `開催日 ${analysis.raceDate}` : '',
    analysis.kind ? `種目 ${analysis.kind}` : '',
    analysis.startTime ? `号砲 ${analysis.startTime}` : '',
    `通過時間帯 ${analysis.binMinutes}分刻み`,
  ]
    .filter(Boolean)
    .join(' ・ ');

  // ゴール記録のみ公開されている大会（中間関門・未完走者数が不明）は
  // エントリー数/完走率の表示を抑制する。
  const finishOnly = analysis.checkpoints.length === 1;

  const sections = analysis.checkpoints.map((c) => checkpointSection(c, finishOnly)).join('\n');

  const notes = analysis.notes.length
    ? `<details class="notes"><summary>注意・データ品質 (${analysis.notes.length})</summary><ul>${analysis.notes
        .map((n) => `<li>${esc(n)}</li>`)
        .join('')}</ul></details>`
    : '';

  const binSec = Math.max(1, Math.round(analysis.binMinutes * 60));
  const clientData = { binSec, runners: buildClientRunners(dataset) };
  // </script> でスクリプトタグが閉じてしまわないようエスケープ
  const clientDataJson = JSON.stringify(clientData).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — 経過時間×完走率</title>
<style>
:root{
  color-scheme: light dark;
  --page:#f9f9f7; --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --muted:#898781;
  --grid:#e1e0d9; --axis:#c3c2b7; --border:rgba(11,11,11,.10);
  --c-finish:#1baf7a; --c-dnf:#d7d5cc; --c-rate:#2a78d6; --good:#006300;
  --hl:#ff6a00; --hl-soft:rgba(255,106,0,.28);
  --warn:#a15c00; --warn-soft:rgba(180,120,0,.14); --warn-border:rgba(180,120,0,.4);
}
@media (prefers-color-scheme: dark){
  :root:where(:not([data-theme="light"])){
    --page:#0d0d0d; --surface:#1a1a19; --ink:#fff; --ink2:#c3c2b7; --muted:#898781;
    --grid:#2c2c2a; --axis:#383835; --border:rgba(255,255,255,.10);
    --c-finish:#199e70; --c-dnf:#4a4a46; --c-rate:#3987e5; --good:#0ca30c;
    --warn:#e0a53a; --warn-soft:rgba(224,165,58,.14); --warn-border:rgba(224,165,58,.4);
  }
}
:root[data-theme="dark"]{
  --page:#0d0d0d; --surface:#1a1a19; --ink:#fff; --ink2:#c3c2b7; --muted:#898781;
  --grid:#2c2c2a; --axis:#383835; --border:rgba(255,255,255,.10);
  --c-finish:#199e70; --c-dnf:#4a4a46; --c-rate:#3987e5; --good:#0ca30c;
  --warn:#e0a53a; --warn-soft:rgba(224,165,58,.14); --warn-border:rgba(224,165,58,.4);
}
:root[data-theme="light"]{
  --warn:#a15c00; --warn-soft:rgba(180,120,0,.14); --warn-border:rgba(180,120,0,.4);
}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);
  font-family:system-ui,-apple-system,"Segoe UI","Hiragino Kaku Gothic ProN",Meiryo,sans-serif;
  line-height:1.5;padding:24px 24px 140px;}
.wrap{max-width:1040px;margin:0 auto}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap}
h1{font-size:1.5rem;margin:0 0 4px}
.note-badge{display:inline-block;font-size:.68rem;font-weight:600;vertical-align:middle;
  background:var(--warn-soft);color:var(--warn);border:1px solid var(--warn-border);
  border-radius:6px;padding:2px 8px;white-space:normal}
.sub{color:var(--ink2);font-size:.9rem;margin:0}
.weather{font-size:.8rem;margin-top:6px}
.w-label{color:var(--muted);margin-right:4px}
.w-sep{margin:0 12px;color:var(--border)}
.weather a{color:inherit;text-decoration:underline;text-decoration-color:var(--border);text-underline-offset:2px}
.weather a:hover{text-decoration-color:var(--c-rate)}
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
.mark{cursor:pointer}
.mark:hover,.mark:focus{opacity:.75}
.mark:focus{outline:none}
.chart-tip{position:fixed;z-index:100;max-width:min(90vw,320px);
  background:var(--ink);color:var(--page);font-size:.8rem;line-height:1.4;
  border-radius:8px;padding:6px 10px;box-shadow:0 2px 10px rgba(0,0,0,.25);
  pointer-events:none;white-space:nowrap}
.hl-col{fill:var(--hl-soft);opacity:0;pointer-events:none;transition:opacity .12s ease}
.hl-col.hl-active{opacity:1}
.hl-ring{fill:none;stroke:var(--hl);stroke-width:2.5;opacity:0;pointer-events:none;transition:opacity .12s ease}
.hl-ring.hl-active{opacity:1}
table.data.wide tr[data-bib]{cursor:pointer}
table.data.wide tr[data-bib]:hover td,table.data.wide tr[data-bib]:focus td{background:var(--border)}
table.data.wide tr[data-bib].row-selected td{background:var(--hl-soft)}
.runner-float{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:300;
  width:min(94vw,640px);background:var(--surface);border:1px solid var(--border);
  border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.22);padding:10px 14px;font-size:.85rem}
.rf-row{display:flex;gap:8px;align-items:center;position:relative}
.rf-row input{flex:1;padding:8px 10px;border-radius:8px;border:1px solid var(--border);
  background:var(--page);color:var(--ink);font-size:.85rem;min-width:0}
.rf-clear{border:1px solid var(--border);background:var(--page);color:var(--ink2);
  border-radius:8px;padding:7px 12px;cursor:pointer;font-size:.8rem;white-space:nowrap}
.rf-suggest{position:absolute;left:0;right:0;bottom:calc(100% + 8px);background:var(--surface);
  border:1px solid var(--border);border-radius:10px;max-height:min(50vh,320px);overflow:auto;
  box-shadow:0 6px 20px rgba(0,0,0,.2)}
.rf-suggest .item{padding:7px 12px;cursor:pointer;display:flex;justify-content:space-between;
  gap:10px;border-bottom:1px solid var(--border);font-size:.82rem}
.rf-suggest .item:last-child{border-bottom:none}
.rf-suggest .item:hover,.rf-suggest .item.active{background:var(--border)}
.rf-result{margin-top:10px;border-top:1px solid var(--border);padding-top:10px}
.rf-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.rf-head b{font-size:1rem}
.rf-bib{color:var(--ink2);font-size:.78rem}
.rf-status{font-size:.72rem;border-radius:6px;padding:1px 7px}
.rf-status.fin{background:var(--c-finish);color:#fff}
.rf-status.dnf{background:var(--c-dnf);color:var(--ink)}
.rf-close{margin-left:auto;border:none;background:none;color:var(--ink2);font-size:1.1rem;
  cursor:pointer;line-height:1;padding:2px 4px}
.rf-splits{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.rf-chip{background:var(--page);border:1px solid var(--border);border-radius:7px;
  padding:3px 8px;font-size:.76rem;white-space:nowrap}
</style>
</head>
<body>
<script id="rua-runner-data" type="application/json">${clientDataJson}</script>
<div id="chart-tip" class="chart-tip" role="status" hidden></div>
<div class="wrap">
<header>
  <div>
    <h1>${esc(title)}${analysis.note ? ` <span class="note-badge">${esc(analysis.note)}</span>` : ''}</h1>
    <p class="sub">${esc(meta)}</p>
    <p class="sub">経過時間ごとの完走率 — 各地点をその経過時間帯に通過した選手のうち、山頂ゴールに到達した割合</p>
    ${weatherHtml(analysis.weather)}
  </div>
  <button class="theme-btn" onclick="(function(){var r=document.documentElement;var d=r.getAttribute('data-theme')==='dark';r.setAttribute('data-theme',d?'light':'dark')})()">◐ テーマ切替</button>
</header>

<div class="kpis">
  ${finishOnly ? '' : kpiCard('エントリー(通過選手)', String(analysis.totalRunners))}
  ${kpiCard(finishOnly ? '記録あり選手数' : '完走者', String(analysis.finishers))}
  ${finishOnly ? '' : kpiCard('全体完走率', pct(analysis.finishRate))}
  ${kpiCard('地点数', String(analysis.checkpoints.length))}
</div>
${finishOnly ? '<p class="sub">この大会はゴール記録のみが公開されており、エントリー数・完走率は不明です。</p>' : ''}

${sections}

${wideTableHtml(dataset)}

${notes}

<footer>
  生成: ${esc(analysis.fetchedAt)} ・ このツール runners-update-analytics による自動生成。<br>
  データ出典: RUNNET ランナーズアップデート（${esc(
    analysis.raceId ? `raceId=${analysis.raceId}` : '大会結果',
  )}）。速報値は暫定であり、確報で変動する場合があります。${
    analysis.weather ? '<br>気象データ出典: 気象庁 過去の気象データ検索（河口湖・富士山）。' : ''
  }
</footer>
</div>

<div id="runner-float" class="runner-float">
  <div class="rf-row">
    <input id="rf-input" type="text" placeholder="選手名 または Bib で検索" autocomplete="off">
    <button id="rf-clear" class="rf-clear" type="button" hidden>クリア</button>
    <div id="rf-suggest" class="rf-suggest" hidden></div>
  </div>
  <div id="rf-result" class="rf-result" hidden></div>
</div>

<script>
function showChartTip(evt, el) {
  var tip = document.getElementById('chart-tip');
  var text = el.getAttribute('data-tip');
  if (!tip || !text) return;
  evt.stopPropagation();
  tip.textContent = text;
  tip.hidden = false;
  var pad = 12;
  var x = (evt.clientX != null ? evt.clientX : el.getBoundingClientRect().left);
  var y = (evt.clientY != null ? evt.clientY : el.getBoundingClientRect().top);
  var tw = tip.offsetWidth, th = tip.offsetHeight;
  var left = Math.min(Math.max(pad, x + pad), window.innerWidth - tw - pad);
  var top = Math.max(pad, y - th - pad);
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}
document.addEventListener('click', function () {
  var tip = document.getElementById('chart-tip');
  if (tip) tip.hidden = true;
});
document.addEventListener('keydown', function (evt) {
  if (evt.key === 'Escape') {
    var tip = document.getElementById('chart-tip');
    if (tip) tip.hidden = true;
  }
});

(function () {
  var dataEl = document.getElementById('rua-runner-data');
  var DATA = dataEl ? JSON.parse(dataEl.textContent) : { binSec: 60, runners: [] };
  var BIN_SEC = DATA.binSec || 60;
  var RUNNERS = DATA.runners || [];
  var byBib = {};
  RUNNERS.forEach(function (r) { byBib[String(r.bib)] = r; });

  // 地点 x ビン -> ハイライト対象 SVG 要素の索引
  var hlIndex = {};
  document.querySelectorAll('[data-cp][data-bin]').forEach(function (el) {
    var key = el.getAttribute('data-cp') + '|' + el.getAttribute('data-bin');
    (hlIndex[key] = hlIndex[key] || []).push(el);
  });

  function fmtSec(total) {
    if (total == null || !isFinite(total)) return '-';
    var t = Math.round(total);
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    var p = function (n) { return String(n).padStart(2, '0'); };
    return h > 0 ? (h + ':' + p(m) + ':' + p(s)) : (m + ':' + p(s));
  }

  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function clearHighlights() {
    document.querySelectorAll('.hl-active').forEach(function (el) { el.classList.remove('hl-active'); });
  }

  function clearRowSelection() {
    document.querySelectorAll('tr.row-selected').forEach(function (tr) { tr.classList.remove('row-selected'); });
  }

  function highlightRunner(runner) {
    clearHighlights();
    Object.keys(runner.splits || {}).forEach(function (cp) {
      var gross = runner.splits[cp];
      if (gross == null) return;
      var binStart = Math.floor(gross / BIN_SEC) * BIN_SEC;
      var key = cp + '|' + binStart;
      (hlIndex[key] || []).forEach(function (el) { el.classList.add('hl-active'); });
    });
  }

  function renderResult(runner) {
    var box = document.getElementById('rf-result');
    if (!runner) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    var chips = Object.keys(runner.splits || {}).map(function (cp) {
      return '<span class="rf-chip">' + escHtml(cp) + ' ' + fmtSec(runner.splits[cp]) + '</span>';
    }).join('');
    box.innerHTML =
      '<div class="rf-head"><b>' + escHtml(runner.name || '(氏名不明)') + '</b>' +
      '<span class="rf-bib">Bib ' + escHtml(runner.bib) + '</span>' +
      '<span class="rf-status ' + (runner.finished ? 'fin' : 'dnf') + '">' + (runner.finished ? '完走' : '未完走') + '</span>' +
      '<button id="rf-close" class="rf-close" type="button" aria-label="閉じる">×</button></div>' +
      '<div class="rf-splits">' + chips + '</div>';
    box.hidden = false;
    var closeBtn = document.getElementById('rf-close');
    if (closeBtn) closeBtn.addEventListener('click', function () { selectRunner(null); });
  }

  function selectRunner(runner) {
    clearRowSelection();
    if (runner) {
      highlightRunner(runner);
      var bibStr = String(runner.bib);
      var rows = document.querySelectorAll('tr[data-bib]');
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].getAttribute('data-bib') === bibStr) {
          rows[i].classList.add('row-selected');
          break;
        }
      }
    } else {
      clearHighlights();
    }
    renderResult(runner);
  }

  function selectRunnerByBib(bib) {
    var r = byBib[String(bib)];
    if (r) selectRunner(r);
  }

  var input = document.getElementById('rf-input');
  var suggestBox = document.getElementById('rf-suggest');
  var clearBtn = document.getElementById('rf-clear');

  function search(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    var exact = [], starts = [], contains = [];
    RUNNERS.forEach(function (r) {
      var bib = String(r.bib).toLowerCase();
      var name = String(r.name || '').toLowerCase();
      if (bib === q) { exact.push(r); return; }
      if (bib.indexOf(q) === 0 || name.indexOf(q) === 0) { starts.push(r); return; }
      if (bib.indexOf(q) !== -1 || name.indexOf(q) !== -1) { contains.push(r); }
    });
    return exact.concat(starts, contains).slice(0, 30);
  }

  function renderSuggestions(list) {
    if (!list.length) {
      suggestBox.hidden = true;
      suggestBox.innerHTML = '';
      return;
    }
    suggestBox.innerHTML = list.map(function (r) {
      return '<div class="item" data-bib="' + escHtml(r.bib) + '">' +
        '<span>' + escHtml(r.name || '(氏名不明)') + '</span>' +
        '<span class="rf-bib">Bib ' + escHtml(r.bib) + (r.finished ? ' ・完走' : '') + '</span></div>';
    }).join('');
    suggestBox.hidden = false;
  }

  if (input) {
    input.addEventListener('input', function () {
      clearBtn.hidden = !input.value;
      renderSuggestions(search(input.value));
    });
    input.addEventListener('keydown', function (evt) {
      if (evt.key === 'Enter') {
        var list = search(input.value);
        if (list.length >= 1) selectRunnerByBib(list[0].bib);
        suggestBox.hidden = true;
      } else if (evt.key === 'Escape') {
        suggestBox.hidden = true;
      }
    });
  }
  if (suggestBox) {
    suggestBox.addEventListener('click', function (evt) {
      var item = evt.target.closest('.item');
      if (!item) return;
      selectRunnerByBib(item.getAttribute('data-bib'));
      suggestBox.hidden = true;
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      input.value = '';
      clearBtn.hidden = true;
      suggestBox.hidden = true;
      selectRunner(null);
      input.focus();
    });
  }
  document.addEventListener('click', function (evt) {
    if (suggestBox && !suggestBox.hidden && !evt.target.closest('#runner-float')) suggestBox.hidden = true;
  });

  // 選手別 通過タイム表: 行クリック/Enter でその選手をグラフ上にハイライト
  document.addEventListener('click', function (evt) {
    var tr = evt.target.closest('tr[data-bib]');
    if (tr) selectRunnerByBib(tr.getAttribute('data-bib'));
  });
  document.addEventListener('keydown', function (evt) {
    if (evt.key !== 'Enter') return;
    var tr = evt.target.closest && evt.target.closest('tr[data-bib]');
    if (tr) selectRunnerByBib(tr.getAttribute('data-bib'));
  });
})();
</script>
</body>
</html>`;
}
