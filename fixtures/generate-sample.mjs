/**
 * デモ用サンプルデータ生成。
 *
 * RUNNET 富士登山競走の結果ページ構造（Bib. / 氏名 / ネットタイム / グロスタイム / …）を模した
 * 地点別 HTML を生成する。地点が進むほど関門・リタイアで人数が減り、
 * 「通過時刻が遅いほど完走率が下がる」現実的な分布になるようにしている。
 *
 * 実データではないため、氏名はダミー。CLI の動作確認・ダッシュボード確認用。
 *
 *   node fixtures/generate-sample.mjs
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, 'sample');
mkdirSync(outDir, { recursive: true });

// 再現性のためのシード付き乱数（xorshift）
let seed = 20260724;
function rnd() {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) % 100000) / 100000;
}
function gauss() {
  return (rnd() + rnd() + rnd() + rnd() - 2) / 2; // ざっくり正規
}

// 地点（コース順）と、トップ選手の基準グロス秒
const S = (h, m, s) => h * 3600 + m * 60 + s;
const checkpoints = [
  { name: '馬返し', order: 1, goal: false, top: S(0, 45, 51) },
  { name: '五合目', order: 2, goal: false, top: S(1, 23, 2) },
  { name: '八合目', order: 3, goal: false, top: S(2, 23, 11) },
  { name: 'Finish', order: 4, goal: true, top: S(2, 43, 58) },
];

const SEI = ['山口', '上田', '菊嶋', '山田', '和田', '吉村', '小島', '佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '中村', '小林'];
const MEI = ['大河', '瑠偉', '啓', '雄喜', '壮平', '健佑', '弘道', '翔', '拓海', '大輔', '直樹', '涼', '海斗', '陽介', '智也'];

const N = 160;
const runners = [];
for (let i = 0; i < N; i++) {
  const bib = i + 1;
  // 能力係数: 1.0(トップ相当)〜2.2(遅い)。指数寄りで遅い人を多めに。
  const ability = 1.0 + Math.pow(rnd(), 1.4) * 1.2;
  const name = `${SEI[Math.floor(rnd() * SEI.length)]} ${MEI[Math.floor(rnd() * MEI.length)]}`;
  runners.push({ bib, name, ability });
}

// 地点ごとに通過タイムを決め、関門/リタイアで脱落させる
// finishGross を基準に各地点は top 比で配分し、能力とノイズを反映
const perCheckpointRows = checkpoints.map(() => []);
const cutoffs = {
  // 経過秒がこれを超えると通過不可（関門）。緩めに設定。
  馬返し: S(1, 5, 0),
  五合目: S(2, 0, 0),
  八合目: S(3, 30, 0),
  Finish: S(4, 30, 0),
};

for (const r of runners) {
  let alive = true;
  for (const cp of checkpoints) {
    if (!alive) break;
    const base = cp.top * r.ability;
    const noise = 1 + gauss() * 0.05;
    let gross = Math.round(base * noise);
    // 関門
    if (gross > cutoffs[cp.name]) {
      alive = false;
      break;
    }
    // 中間リタイア（遅いほど、また地点が進むほど確率↑）
    const slowness = (r.ability - 1.0) / 1.2; // 0..1
    const dropP = cp.goal ? 0 : 0.03 + slowness * 0.22 * (cp.order / 3);
    perCheckpointRows[cp.order - 1].push({ bib: r.bib, name: r.name, gross });
    if (rnd() < dropP) {
      alive = false;
    }
  }
}

function fmt(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n) => String(n).padStart(2, '0');
  return `${h}:${p(m)}:${p(s)}`;
}

function tableHtml(cpName, rows) {
  // 到着順（グロス昇順）に並べる（速報の掲載順を模す）
  const sorted = [...rows].sort((a, b) => a.gross - b.gross);
  const trs = sorted
    .map(
      (r) => `<tr>
      <td>${r.bib}</td>
      <td><a href="/record/runner.do?bib=${r.bib}">${r.name}</a></td>
      <td></td>
      <td>${fmt(r.gross)}</td>
      <td><a href="#">WEB完走証</a></td>
      <td><a href="#">詳細</a></td>
    </tr>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<title>速報 第79回富士登山競走 | RUNNET</title></head>
<body>
<div class="breadcrumb">大会結果 &gt; 第79回富士登山競走</div>
<h1>第79回富士登山競走</h1>
<p>開催日 2026年7月24日 (金) 開催地 山梨県（富士吉田市）</p>
<div class="filter">
  <label>種目</label>
  <select><option selected>山頂総合</option></select>
  <label>地点</label>
  <span>${cpName}</span>
</div>
<h2>山頂総合 — ${cpName}</h2>
<table>
  <thead>
    <tr><th>Bib.</th><th>氏名</th><th>ネットタイム</th><th>グロスタイム</th><th>WEB完走証</th><th>詳細</th></tr>
  </thead>
  <tbody>
${trs}
  </tbody>
</table>
</body></html>`;
}

const manifestCheckpoints = [];
checkpoints.forEach((cp, i) => {
  const file = `${cp.order}_${cp.name}.html`;
  writeFileSync(join(outDir, file), tableHtml(cp.name, perCheckpointRows[i]), 'utf8');
  manifestCheckpoints.push({
    name: cp.name,
    order: cp.order,
    goal: cp.goal,
    html: `sample/${file}`,
    // 実運用では url も指定可能:
    // url: `https://runnet.jp/record/race.do?raceId=386774&point=${cp.name}`,
  });
  console.log(`${cp.name}: ${perCheckpointRows[i].length} 名`);
});

const manifest = {
  raceId: '386774',
  raceName: '第79回富士登山競走',
  raceDate: '2026-07-24',
  kind: '山頂総合',
  startTime: '07:00',
  checkpoints: manifestCheckpoints,
};
writeFileSync(join(__dirname, 'sample-race.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
console.log('manifest -> fixtures/sample-race.json');
