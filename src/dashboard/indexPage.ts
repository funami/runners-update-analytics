/** 複数レースの analysis.json を集めて目次ページ(index.html)を生成する。 */

import type { RaceAnalysis } from '../types.js';
import { esc } from './svg.js';
import { weatherCompact } from './weather.js';

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
  return `<a class="card" href="${esc(href)}">
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
export function generateIndexPage(entries: RaceIndexEntry[], opts?: { title?: string }): string {
  const title = opts?.title ?? 'ランナーズアップデート 分析 — レース一覧';
  const sorted = entries.slice().sort((a, b) => {
    const da = a.analysis.raceDate ?? '';
    const db = b.analysis.raceDate ?? '';
    return db.localeCompare(da);
  });
  const cards = sorted.map((e) => raceCard(e)).join('\n');

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
footer{color:var(--muted);font-size:.75rem;margin-top:28px;border-top:1px solid var(--border);padding-top:12px}
</style>
</head>
<body>
<div class="wrap">
<header>
  <div>
    <h1>${esc(title)}</h1>
    <p class="sub">レースを選ぶと、選手検索・完走率グラフのダッシュボードを開きます</p>
  </div>
  <button class="theme-btn" onclick="(function(){var r=document.documentElement;var d=r.getAttribute('data-theme')==='dark';r.setAttribute('data-theme',d?'light':'dark')})()">◐ テーマ切替</button>
</header>

<div class="list">
${cards}
</div>

<footer>runners-update-analytics による自動生成。</footer>
</div>
</body>
</html>`;
}
