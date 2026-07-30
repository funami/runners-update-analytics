/** 複数レースの analysis.json を集めて目次ページ(index.html)を生成する。 */

import type { RaceAnalysis } from '../types.js';
import { esc } from './svg.js';
import { weatherCompact } from './weather.js';
import type { CrossRunnerData } from './crossSearch.js';

function pct(v: number | null): string {
  return v == null ? '-' : `${(v * 100).toFixed(1)}%`;
}

function weatherLine(weather: RaceAnalysis['weather']): string {
  if (!weather || (!weather.start && !weather.finish)) return '';
  const parts: string[] = [];
  if (weather.start) parts.push(`スタート ${weatherCompact(weather.start)}`);
  if (weather.finish) parts.push(`ゴール ${weatherCompact(weather.finish)}`);
  return `<p class="card-weather">${esc(parts.join('　・　'))}</p>`;
}

/** 1 レースぶんの目次エントリ。dir は index.html からの相対パス（例: "race-386774"）。 */
export interface RaceIndexEntry {
  dir: string;
  analysis: RaceAnalysis;
}

function raceCard(entry: RaceIndexEntry): string {
  const a = entry.analysis;
  const title = [a.raceName, a.kind].filter(Boolean).join(' / ') || entry.dir;
  const meta = [a.raceDate, a.startTime ? `号砲 ${a.startTime}` : ''].filter(Boolean).join(' ・ ');
  const href = `${entry.dir}/dashboard.html`;
  const finishOnly = a.checkpoints.length === 1;
  const kpis = finishOnly
    ? `<div class="ckpi"><div class="ckpi-v">${a.finishers}</div><div class="ckpi-l">記録あり選手数</div></div>`
    : `<div class="ckpi"><div class="ckpi-v">${a.totalRunners}</div><div class="ckpi-l">エントリー</div></div>
      <div class="ckpi"><div class="ckpi-v">${a.finishers}</div><div class="ckpi-l">完走者</div></div>
      <div class="ckpi"><div class="ckpi-v">${pct(a.finishRate)}</div><div class="ckpi-l">完走率</div></div>`;
  return `<a class="card" href="${esc(href)}" data-dir="${esc(entry.dir)}">
    <div class="card-head">
      <h2>${esc(title)}${a.note ? ` <span class="note-badge">${esc(a.note)}</span>` : ''}</h2>
      <span class="arrow">→</span>
    </div>
    <p class="card-meta">${esc(meta)}</p>
    ${weatherLine(a.weather)}
    <div class="card-kpis">
      ${kpis}
    </div>
  </a>`;
}

/** レース一覧の目次 HTML を生成する（開催日の新しい順）。 */
export function generateIndexPage(
  entries: RaceIndexEntry[],
  opts?: { title?: string; crossRunnerData?: CrossRunnerData },
): string {
  const title = opts?.title ?? 'ランナーズアップデート 分析 — レース一覧';
  const sorted = entries.slice().sort((a, b) => {
    const da = a.analysis.raceDate ?? '';
    const db = b.analysis.raceDate ?? '';
    return db.localeCompare(da);
  });
  const cards = sorted.map((e) => raceCard(e)).join('\n');
  const crossData = opts?.crossRunnerData ?? { races: [], runners: [] };
  // </script> でスクリプトタグが閉じてしまわないようエスケープ
  const crossDataJson = JSON.stringify(crossData).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{
  color-scheme: light dark;
  --page:#f9f9f7; --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --muted:#898781;
  --border:rgba(11,11,11,.10); --c-finish:#1baf7a;
  --warn:#a15c00; --warn-soft:rgba(180,120,0,.14); --warn-border:rgba(180,120,0,.4);
}
@media (prefers-color-scheme: dark){
  :root:where(:not([data-theme="light"])){
    --page:#0d0d0d; --surface:#1a1a19; --ink:#fff; --ink2:#c3c2b7; --muted:#898781;
    --border:rgba(255,255,255,.10); --c-finish:#199e70;
    --warn:#e0a53a; --warn-soft:rgba(224,165,58,.14); --warn-border:rgba(224,165,58,.4);
  }
}
:root[data-theme="dark"]{
  --page:#0d0d0d; --surface:#1a1a19; --ink:#fff; --ink2:#c3c2b7; --muted:#898781;
  --border:rgba(255,255,255,.10); --c-finish:#199e70;
  --warn:#e0a53a; --warn-soft:rgba(224,165,58,.14); --warn-border:rgba(224,165,58,.4);
}
:root[data-theme="light"]{
  --warn:#a15c00; --warn-soft:rgba(180,120,0,.14); --warn-border:rgba(180,120,0,.4);
}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--ink);
  font-family:system-ui,-apple-system,"Segoe UI","Hiragino Kaku Gothic ProN",Meiryo,sans-serif;
  line-height:1.5;padding:24px;}
.wrap{max-width:760px;margin:0 auto}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:8px}
h1{font-size:1.5rem;margin:0 0 4px}
.sub{color:var(--ink2);font-size:.9rem;margin:0}
.theme-btn{border:1px solid var(--border);background:var(--surface);color:var(--ink2);
  border-radius:8px;padding:6px 10px;font-size:.85rem;cursor:pointer}
.list{display:flex;flex-direction:column;gap:12px;margin:20px 0}
.card{display:block;background:var(--surface);border:1px solid var(--border);border-radius:14px;
  padding:16px 20px;text-decoration:none;color:inherit;transition:border-color .12s ease,transform .12s ease}
.card:hover{border-color:var(--c-finish);transform:translateY(-1px)}
.card-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.card-head h2{margin:0;font-size:1.1rem}
.arrow{color:var(--muted);font-size:1.1rem}
.card-meta{color:var(--ink2);font-size:.85rem;margin:2px 0 8px}
.card-weather{color:var(--muted);font-size:.78rem;margin:0 0 12px}
.card-kpis{display:flex;gap:20px}
.ckpi-v{font-size:1.2rem;font-weight:700}
.ckpi-l{font-size:.75rem;color:var(--ink2)}
.card[hidden]{display:none}
.search-box{position:relative;margin:18px 0 6px}
.search-row{display:flex;gap:8px;align-items:center}
.search-row input{flex:1;padding:9px 12px;border-radius:8px;border:1px solid var(--border);
  background:var(--surface);color:var(--ink);font-size:.9rem;min-width:0}
.search-clear{border:1px solid var(--border);background:var(--surface);color:var(--ink2);
  border-radius:8px;padding:8px 12px;cursor:pointer;font-size:.8rem;white-space:nowrap}
.search-hint{font-size:.72rem;color:var(--muted);margin:6px 0 0}
.search-suggest{position:absolute;left:0;right:0;top:calc(100% + 6px);background:var(--surface);
  border:1px solid var(--border);border-radius:10px;max-height:min(50vh,320px);overflow:auto;
  box-shadow:0 6px 20px rgba(0,0,0,.2);z-index:20}
.search-suggest .item{padding:8px 12px;cursor:pointer;display:flex;justify-content:space-between;
  align-items:baseline;gap:10px;border-bottom:1px solid var(--border);font-size:.85rem}
.search-suggest .item:last-child{border-bottom:none}
.search-suggest .item:hover{background:var(--border)}
.search-suggest .item-races{color:var(--ink2);font-size:.76rem;white-space:nowrap}
.filter-banner{display:none;align-items:center;gap:10px;background:var(--surface);
  border:1px solid var(--border);border-radius:10px;padding:8px 14px;margin:10px 0;font-size:.85rem}
.filter-banner.active{display:flex}
.filter-banner button{margin-left:auto;border:1px solid var(--border);background:var(--page);
  color:var(--ink2);border-radius:7px;padding:4px 10px;cursor:pointer;font-size:.78rem}
.runner-summary{margin-top:10px;border-top:1px solid var(--border);padding-top:10px}
.runner-summary .rs-bib{color:var(--ink2);font-size:.76rem;margin-bottom:4px}
.rs-chips{display:flex;gap:6px;flex-wrap:wrap}
.rs-chip{background:var(--page);border:1px solid var(--border);border-radius:7px;
  padding:3px 8px;font-size:.76rem;white-space:nowrap}
footer{color:var(--muted);font-size:.75rem;margin-top:28px;border-top:1px solid var(--border);padding-top:12px}
</style>
</head>
<body>
<script id="rua-cross-data" type="application/json">${crossDataJson}</script>
<div class="wrap">
<header>
  <div>
    <h1>${esc(title)}</h1>
    <p class="sub">レースを選ぶと、選手検索・完走率グラフのダッシュボードを開きます</p>
  </div>
  <button class="theme-btn" onclick="(function(){var r=document.documentElement;var d=r.getAttribute('data-theme')==='dark';r.setAttribute('data-theme',d?'light':'dark')})()">◐ テーマ切替</button>
</header>

<div class="search-box">
  <div class="search-row">
    <input id="idx-search" type="text" placeholder="選手名で検索（大会をまたいで検索）" autocomplete="off">
    <button id="idx-clear" class="search-clear" type="button" hidden>クリア</button>
  </div>
  <div id="idx-suggest" class="search-suggest" hidden></div>
  <p class="search-hint">氏名のみでの突き合わせのため、同姓同名の別人が含まれる場合があります。</p>
</div>

<div id="idx-filter-banner" class="filter-banner">
  <span id="idx-filter-text"></span>
  <button id="idx-filter-clear" type="button">一覧に戻す</button>
</div>

<div class="list">
${cards}
</div>

<footer>runners-update-analytics による自動生成。</footer>
</div>
<script>
(function () {
  var dataEl = document.getElementById('rua-cross-data');
  var DATA = dataEl ? JSON.parse(dataEl.textContent) : { races: [], runners: [] };
  var RACES = DATA.races || [];
  var RUNNERS = DATA.runners || [];

  var byName = {};
  RUNNERS.forEach(function (row) {
    (byName[row.name] = byName[row.name] || []).push(row);
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

  function raceLabel(r) {
    var race = RACES[r];
    if (!race) return '?';
    return race.raceNumber != null ? String(race.raceNumber) : (race.raceName || race.dir);
  }

  var input = document.getElementById('idx-search');
  var suggestBox = document.getElementById('idx-suggest');
  var clearBtn = document.getElementById('idx-clear');
  var banner = document.getElementById('idx-filter-banner');
  var bannerText = document.getElementById('idx-filter-text');
  var bannerClear = document.getElementById('idx-filter-clear');
  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));

  function search(q) {
    q = q.trim();
    if (!q) return [];
    var names = Object.keys(byName).filter(function (n) { return n.indexOf(q) !== -1; });
    names.sort(function (a, b) {
      var ea = a === q ? 0 : 1, eb = b === q ? 0 : 1;
      if (ea !== eb) return ea - eb;
      return a.localeCompare(b, 'ja');
    });
    return names.slice(0, 30);
  }

  function renderSuggestions(names) {
    if (!names.length) {
      suggestBox.hidden = true;
      suggestBox.innerHTML = '';
      return;
    }
    suggestBox.innerHTML = names.map(function (name) {
      var rows = byName[name];
      var nums = rows.map(function (row) { return raceLabel(row.r); });
      nums.sort(function (a, b) { return (Number(a) || 0) - (Number(b) || 0); });
      return '<div class="item" data-name="' + escHtml(name) + '"><span>' + escHtml(name) + '</span>' +
        '<span class="item-races">第' + nums.map(escHtml).join(',') + '回</span></div>';
    }).join('');
    suggestBox.hidden = false;
  }

  function clearSummaries() {
    document.querySelectorAll('.card .runner-summary').forEach(function (el) { el.remove(); });
  }

  function selectRunnerName(name) {
    var rows = byName[name];
    if (!rows || !rows.length) return;
    var byDir = {};
    rows.forEach(function (row) { byDir[RACES[row.r].dir] = row; });
    clearSummaries();
    var shown = 0;
    cards.forEach(function (card) {
      var dir = card.getAttribute('data-dir');
      var row = byDir[dir];
      if (!row) {
        card.hidden = true;
        return;
      }
      card.hidden = false;
      shown++;
      var race = RACES[row.r];
      var chips = (race.checkpoints || []).map(function (cp) {
        var g = row.splits[cp];
        return g != null ? '<span class="rs-chip">' + escHtml(cp) + ' ' + fmtSec(g) + '</span>' : '';
      }).filter(Boolean).join('');
      var div = document.createElement('div');
      div.className = 'runner-summary';
      div.innerHTML = '<div class="rs-bib">Bib ' + escHtml(row.bib) + '</div><div class="rs-chips">' + chips + '</div>';
      card.appendChild(div);
    });
    bannerText.textContent = '「' + name + '」が出場した ' + shown + ' 大会のみ表示中';
    banner.classList.add('active');
  }

  function clearFilter() {
    clearSummaries();
    cards.forEach(function (card) { card.hidden = false; });
    banner.classList.remove('active');
  }

  if (input) {
    input.addEventListener('input', function () {
      clearBtn.hidden = !input.value;
      renderSuggestions(search(input.value));
    });
    input.addEventListener('keydown', function (evt) {
      if (evt.key === 'Escape') suggestBox.hidden = true;
    });
  }
  if (suggestBox) {
    suggestBox.addEventListener('click', function (evt) {
      var item = evt.target.closest('.item');
      if (!item) return;
      var name = item.getAttribute('data-name');
      input.value = name;
      suggestBox.hidden = true;
      selectRunnerName(name);
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      input.value = '';
      clearBtn.hidden = true;
      suggestBox.hidden = true;
      clearFilter();
      input.focus();
    });
  }
  if (bannerClear) {
    bannerClear.addEventListener('click', function () {
      input.value = '';
      clearBtn.hidden = true;
      clearFilter();
    });
  }
  document.addEventListener('click', function (evt) {
    if (suggestBox && !suggestBox.hidden && !evt.target.closest('.search-box')) suggestBox.hidden = true;
  });
})();
</script>
</body>
</html>`;
}
