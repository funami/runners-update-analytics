# runners-update-analytics

RUNNET「ランナーズアップデート」大会結果（地点 × 種目ごとのグロスタイム）を取り込み、

- 選手ごとに **各地点の通過時刻＋山頂ゴール時刻** を並べた **表形式データ**
- 地点ごとの **通過時間帯（既定 1 分刻み）の通過者数と、そのうち完走（山頂到達）した人数** の対比
- **通過時刻ごとの完走率**（＝その時刻に地点を通過した選手が最終的に完走する割合）

を集計し、自己完結型の **HTML ダッシュボード**と CSV を生成する TypeScript / Node.js ツールです。

富士登山競走（`馬返し → 五合目 → 八合目 → Finish(山頂)`）のような、地点（関門）ごとに
通過記録が公開されるレースの「関門・完走率」分析を主目的にしています。

## 何ができるか

1 種目ぶんの各地点結果（RUNNET の `race.do?raceId=...` の地点切替で表示される表）を
`Bib.`（ゼッケン）で突き合わせ、次を出力します。

| 出力 | 内容 |
|---|---|
| `dashboard.html` | 地点ごとの「通過者数（完走/未完走の積み上げ棒）」＋「通過時刻ごとの完走率（折れ線）」＋データ表。単一 HTML で完結、オフライン閲覧可。 |
| `passing-table.csv` | 選手別ワイド表。各地点の `グロス`・`通過時刻`、`完走`可否、`ゴールグロス`、`最終到達地点`。 |
| `finish-rate.csv` | `地点 × 通過時間帯` の縦持ち。`通過者数`・`完走者数`・`完走率(%)`。 |
| `dataset.json` | 正規化済みの中間データ（監査・再分析用）。 |
| `analysis.json` | 集計結果。50% 完走率を割り始める時間帯（実質的な関門の目安）も算出。 |

## セットアップ

```bash
npm install
```

## クイックスタート（同梱サンプルで確認）

```bash
# サンプル（第79回富士登山競走を模したダミーデータ）を分析
npm run demo
# → out/dashboard.html をブラウザで開く
```

サンプルデータは `node fixtures/generate-sample.mjs` で再生成できます（実データではありません）。

## 実データの取り込み

RUNNET には公開 API が無いため、**各地点ページの HTML を束ねて取り込む**方式です。
1 種目ぶんについて、地点ごとに 1 ファイル（または URL）を **マニフェスト JSON** で指定します。

### 1. 各地点ページを保存する

RUNNET の大会結果ページ（例 `https://runnet.jp/record/race.do?raceId=386774`）を開き、
種目を選び、地点（`馬返し`／`五合目`／`八合目`／`Finish`）を切り替えて **結果が表示された状態**で、
各地点のページを「**完全な HTML**（ウェブページ、完全）」でローカル保存します。
（結果テーブルが Ajax で描画される場合、テーブルが表示されてから保存してください。）

### 2. マニフェストを書く

`fixtures/sample-race.json` を雛形にしてください。

```jsonc
{
  "raceId": "386774",
  "raceName": "第79回富士登山競走",
  "raceDate": "2026-07-24",
  "kind": "山頂総合",
  "startTime": "07:00",              // 号砲時刻。指定すると通過「時刻」を併記
  "checkpoints": [
    { "name": "馬返し", "order": 1, "html": "data/1_umagaeshi.html" },
    { "name": "五合目", "order": 2, "html": "data/2_5gome.html" },
    { "name": "八合目", "order": 3, "html": "data/3_8gome.html" },
    { "name": "Finish", "order": 4, "goal": true, "html": "data/4_finish.html" }
  ]
}
```

- `goal: true` の地点を「完走（山頂到達）」とみなします。省略時は**最後の地点**をゴール扱い。
- `html` の代わりに `csv`（列に `bib` / `name` / `gross` / `net` を含む）でも取り込めます。
- パスはマニフェストファイルからの相対パスで解決されます。

### 3. 分析する

```bash
# 取り込み → 集計 → ダッシュボード/CSV を out/ に一括生成
npm run rua -- analyze path/to/manifest.json -o out --bin-minutes 1

# 表形式データ（ワイド CSV）だけ欲しいとき
npm run rua -- table path/to/manifest.json -o out/passing-table.csv

# 正規化データセットだけ出したいとき
npm run rua -- ingest path/to/manifest.json -o out/dataset.json
```

ビルドして `rua` コマンドとして使うこともできます。

```bash
npm run build
node dist/cli.js analyze path/to/manifest.json -o out
```

## ライブ取得（ネットワークが許可された環境のみ）

マニフェストの各地点に `url` を指定し、`--live` を付けると RUNNET から直接取得します
（行儀の良い取得：User-Agent 明示・リクエスト間 1.5 秒以上の待機・指数バックオフ再試行）。

```jsonc
{ "name": "五合目", "order": 2, "url": "https://runnet.jp/record/race.do?raceId=386774&..." }
```

```bash
npm run rua -- analyze manifest.json --live -o out
```

> **注意（このリポジトリの作成環境について）**
> 本ツールを開発した実行環境では、ネットワークポリシーにより `runnet.jp` への
> アクセスが遮断（HTTP 403）されていたため、**実際の DOM を確認できていません**。
> HTML パーサ（`src/scraper/raceParser.ts`）は RUNNET の一般的な結果テーブル構造
> （`Bib. / 氏名 / ネットタイム / グロスタイム`）に対するヒューリスティックで実装しており、
> 特定の CSS セレクタに依存しない設計です。実ページで列の取り込みがずれる場合は、
> `raceParser.ts` の `KEYWORDS` を実列名に合わせて調整してください
> （保存 HTML を `test/` に置いて検証するのが確実です）。

## 「通過時刻ごとの完走率」の読み方

各地点について、その地点を**ある 1 分の時間帯に通過した選手**を母数に、
そのうち**最終的に山頂ゴールへ到達した選手の割合**を完走率としています。

- 早い時間帯に通過した選手ほど完走率が高く、遅くなるほど下がる、という関係が見えます。
- 完走率が 50% を割り始める時間帯を「関門の目安」として算出・表示します
  （公式の関門時刻とは別物の、実績ベースの目安です）。
- `--bin-minutes` を大きくすると 1 ビンあたりの人数が増え、完走率カーブが滑らかになります。

## 開発

```bash
npm run typecheck   # 型チェック
npm test            # ユニットテスト（node:test）
```

主なモジュール:

| ファイル | 役割 |
|---|---|
| `src/scraper/raceParser.ts` | 1 地点 HTML → `CheckpointSplit[]`（列自動マッピング） |
| `src/scraper/http.ts` | 行儀の良い HTTP 取得（UA・レート制限・再試行） |
| `src/ingest.ts` | マニフェスト → 地点別テーブル → Bib 突き合わせ → `SplitsDataset` |
| `src/analysis.ts` | 通過時間帯ビン集計・完走率・ワイド表生成 |
| `src/dashboard/` | 自己完結 HTML ＋ インライン SVG チャート生成 |
| `src/cli.ts` | `ingest` / `table` / `analyze` コマンド |

## データ利用上の注意

- 出典は RUNNET の大会結果です。速報値は暫定で、確報時に変動する場合があります。
- 取得・利用にあたっては RUNNET の利用規約を確認し、サーバに負荷をかけない範囲で
  （本ツールは既定でリクエスト間隔を空けます）利用してください。氏名等の個人情報の
  取り扱いにも留意してください。

## ライセンス

MIT
