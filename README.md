# runners-update-analytics

RUNNET「ランナーズアップデート」大会結果（地点 × 種目ごとのグロスタイム）を取り込み、

- 選手ごとに **各地点のグロスタイム＋山頂ゴールタイム** を並べた **表形式データ**
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
| `dashboard.html` | 地点ごとの「通過者数（完走/未完走の積み上げ棒）」＋「通過時刻ごとの完走率（折れ線）」＋データ表。単一 HTML で完結、オフライン閲覧可。グラフはクリック/タップで経過時間・通過時刻等をチップ表示。 |
| `passing-table.csv` | 選手別ワイド表。各地点の `グロス`、`完走`可否、`ゴールグロス`、`最終到達地点`。並びは最終到達地点が遠い順、同地点内はその地点への到達が早い順。 |
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

## 実データの取り込み（RUNNET 新プラットフォーム / 推奨）

RUNNET の大会結果ページ（例 `https://runnet.jp/record/race.do?raceId=386774`）は現在、
中身が空の外枠ページで、実データは `https://result.one.runnet.jp/races/{raceId}` という
別ドメインの iframe から配信されています。この result.one.runnet.jp は内部的に
**JSON API**（`/api/races/{raceId}/general-categories/{categoryId}?...`）から選手記録を
取得しており、本ツールはこの API を直接叩いて取り込みます。HTML のテーブルをパースする
必要はありません。

### 1. raceId・種目(category) ID を調べる

```bash
npm run rua -- runnet-categories 386774
```

大会名・開催日と、総合種目(`generalCategories`)／個別種目(`categories`)の一覧、
各種目に含まれる地点(`locations`とその`id`)が JSON で出力されます。

### 2. マニフェストを書く

`fixtures/race-386774-summit.json` を雛形にしてください。地点一覧は自動取得するため
`checkpoints` は不要です。

```jsonc
{
  "raceId": "386774",
  "kind": "山頂総合",
  "startTime": "07:00",              // 号砲時刻。指定すると通過「時刻」を併記
  // categoryId は手順1の generalCategories[].id（個別種目なら categories[].id + kind:"category"）
  "runnetApi": { "categoryKind": "general", "categoryId": "1" },
  // ゴール地点の制限時間。超過は「完走」に数えない（例: 富士登山競走 山頂コースは 4:30:00）
  "checkpointCutoffs": { "Finish": "4:30:00" }
}
```

`checkpointCutoffs` は省略可。指定しなければ、ゴール地点に記録があれば無条件に完走扱いになる
（＝ RUNNET API がその地点に記録として返す全員。公式の関門・制限時間とは別の話なので、
レースごとの実際の制限時間はマニフェストに明示すること）。

### 3. 分析する（`--live` 必須）

```bash
npm run rua -- analyze fixtures/race-386774-summit.json --live -o out --bin-minutes 1

# 表形式データ（ワイド CSV）だけ欲しいとき
npm run rua -- table fixtures/race-386774-summit.json --live -o out/passing-table.csv
```

取得は地点ごとに 0 始まりのページング（既定 100 件/ページ）で行儀よく取得します
（User-Agent 明示・リクエスト間 1.5 秒以上の待機・指数バックオフ再試行、`src/scraper/http.ts`）。

> **プロキシ環境について**: Node 標準の `fetch` は `HTTP_PROXY`/`HTTPS_PROXY` 環境変数を
> 自動では見ないため、プロキシ経由でしか外部に出られない環境では `runnet.jp` が
> 「ブロックされている」ように見えることがあります（本ツール初期版はこれを誤って
> ネットワークポリシーによる遮断と判断していました）。本ツールは `undici` の
> `EnvHttpProxyAgent` を使い、これらの環境変数が設定されていれば自動的に
> プロキシ経由で接続します（`src/scraper/http.ts`）。

## 実データの取り込み（保存 HTML / オフライン・フォールバック）

新 API が使えない大会・環境向けに、**各地点ページの HTML を束ねて取り込む**方式も残しています。
1 種目ぶんについて、地点ごとに 1 ファイル（または URL）を **マニフェスト JSON** で指定します。

### 1. 各地点ページを保存する

地点（`馬返し`／`五合目`／`八合目`／`Finish`）を切り替えて **結果が表示された状態**で、
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
- 各地点に `url` を指定し `--live` を付けると、そのページの HTML を直接取得してパースします
  （`src/scraper/raceParser.ts` が結果テーブルをヒューリスティックに検出）。ただし
  現行の result.one.runnet.jp は結果をクライアント側 JS で描画するため、この方式では
  **結果テーブルを検出できません**。上の「新プラットフォーム」方式を使ってください。

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
| `src/scraper/runnetApi.ts` | result.one.runnet.jp の JSON API から種目・地点・選手記録を取得（推奨経路） |
| `src/scraper/raceParser.ts` | 保存 HTML 1 地点分 → `CheckpointSplit[]`（列自動マッピング、フォールバック経路） |
| `src/scraper/http.ts` | 行儀の良い HTTP 取得（UA・プロキシ対応・レート制限・再試行） |
| `src/ingest.ts` | マニフェスト（runnetApi or checkpoints）→ 地点別テーブル → Bib 突き合わせ → `SplitsDataset` |
| `src/analysis.ts` | 通過時間帯ビン集計・完走率・ワイド表生成 |
| `src/dashboard/` | 自己完結 HTML ＋ インライン SVG チャート生成 |
| `src/cli.ts` | `runnet-categories` / `ingest` / `table` / `analyze` コマンド |

## データ利用上の注意

- 出典は RUNNET の大会結果です。速報値は暫定で、確報時に変動する場合があります。
- 取得・利用にあたっては RUNNET の利用規約を確認し、サーバに負荷をかけない範囲で
  （本ツールは既定でリクエスト間隔を空けます）利用してください。氏名等の個人情報の
  取り扱いにも留意してください。

## ライセンス

MIT
