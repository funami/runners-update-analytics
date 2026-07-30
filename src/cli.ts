#!/usr/bin/env node
/**
 * runners-update-analytics CLI (rua)
 *
 * RUNNET「ランナーズアップデート」大会結果（地点×種目）を取り込み、
 * 選手別の通過タイム表と「通過時刻ごとの完走率」を集計・可視化する。
 */

import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { Command } from 'commander';
import type { RaceAnalysis, RaceManifest, SplitsDataset } from './types.js';
import { ingestManifest, loadManifest } from './ingest.js';
import { fetchRaceMeta } from './scraper/runnetApi.js';
import { analyze, buildWideTable, buildFinishRateTable } from './analysis.js';
import { generateDashboard } from './dashboard/generate.js';
import { generateIndexPage, type RaceIndexEntry } from './dashboard/indexPage.js';
import { buildCrossRunnerData } from './dashboard/crossSearch.js';
import { toCsv } from './util/csv.js';
import { setQuiet, info, warn } from './util/logger.js';

const program = new Command();
program
  .name('rua')
  .description('RUNNET ランナーズアップデート 大会結果の取得・集計・可視化ツール')
  .version('0.1.0')
  .option('-q, --quiet', 'ログを抑制', false);

/** 入力ファイルを読み、manifest か dataset かを判定して dataset を得る。 */
async function resolveDataset(
  input: string,
  fetchLive: boolean,
): Promise<SplitsDataset> {
  const abs = resolve(process.cwd(), input);
  const text = await readFile(abs, 'utf8');
  const json = JSON.parse(text) as Record<string, unknown>;

  if (Array.isArray(json.runners) && Array.isArray(json.checkpoints)) {
    info('入力を正規化済みデータセット(dataset)として読み込みました。');
    return json as unknown as SplitsDataset;
  }
  if (Array.isArray(json.checkpoints) || json.runnetApi) {
    info('入力をマニフェスト(manifest)として取り込みます。');
    const manifest = json as unknown as RaceManifest;
    // url / runnetApi 参照があってライブ取得しない設定ならスキップ警告は ingest 内で処理
    if (!fetchLive) {
      const hasUrlOnly = manifest.checkpoints?.some((c) => c.url && !c.html && !c.csv) ?? false;
      if (hasUrlOnly || manifest.runnetApi) {
        info(
          'url / runnetApi 指定の地点があります。ライブ取得するには --live を付けてください（html/csv は常に読み込みます）。',
        );
      }
    }
    return ingestManifest(fetchLive ? manifest : stripUrls(manifest), { baseDir: dirname(abs) });
  }
  throw new Error(
    '入力形式を判定できません。checkpoints または runnetApi を含むマニフェスト、または runners を含む dataset を指定してください。',
  );
}

/** --live 無し時、html/csv が無く url のみの地点、および runnetApi は取得しない（安全側）。 */
function stripUrls(manifest: RaceManifest): RaceManifest {
  return {
    ...manifest,
    runnetApi: undefined,
    checkpoints: manifest.checkpoints?.map((c) =>
      c.url && !c.html && !c.csv ? { ...c, url: undefined } : c,
    ),
  };
}

async function writeOut(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
  info(`書き出し: ${path}`);
}

program
  .command('ingest')
  .description('マニフェストを取り込み、正規化データセット(JSON)を出力')
  .argument('<manifest>', 'マニフェスト JSON のパス')
  .option('-o, --out <file>', '出力先 JSON', 'out/dataset.json')
  .option('--live', 'url 指定の地点をライブ取得する', false)
  .action(async (manifestPath: string, opts: { out: string; live: boolean }) => {
    setQuiet(program.opts().quiet);
    const { manifest, baseDir } = await loadManifest(manifestPath);
    const dataset = await ingestManifest(opts.live ? manifest : stripUrls(manifest), { baseDir });
    await writeOut(resolve(process.cwd(), opts.out), JSON.stringify(dataset, null, 2));
    console.error(
      `取り込み完了: ${dataset.runners.length} 名 / 地点 ${dataset.checkpoints.length} / 完走 ${
        dataset.runners.filter((r) => r.finished).length
      } 名`,
    );
  });

program
  .command('runnet-categories')
  .description(
    'RUNNET(result.one.runnet.jp) の種目・地点一覧を表示（マニフェストの runnetApi 作成用）',
  )
  .argument('<raceId>', 'RUNNET raceId（例: 386774）')
  .action(async (raceId: string) => {
    setQuiet(program.opts().quiet);
    const meta = await fetchRaceMeta(raceId);
    console.log(JSON.stringify(meta, null, 2));
  });

program
  .command('table')
  .description('選手別 通過タイム表（ワイド CSV）を出力')
  .argument('<input>', 'マニフェスト or データセット JSON')
  .option('-o, --out <file>', '出力先 CSV', 'out/passing-table.csv')
  .option('--live', 'url 指定の地点をライブ取得する', false)
  .action(async (input: string, opts: { out: string; live: boolean }) => {
    setQuiet(program.opts().quiet);
    const dataset = await resolveDataset(input, opts.live);
    const csv = toCsv(buildWideTable(dataset));
    await writeOut(resolve(process.cwd(), opts.out), csv);
    console.error(`表を出力しました: ${dataset.runners.length} 名`);
  });

program
  .command('analyze')
  .description('取り込み→集計→ダッシュボード/CSV を一括生成')
  .argument('<input>', 'マニフェスト or データセット JSON')
  .option('-o, --out <dir>', '出力ディレクトリ', 'out')
  .option('-b, --bin-minutes <n>', '通過時間帯の刻み(分)', '1')
  .option('--live', 'url 指定の地点をライブ取得する', false)
  .action(async (input: string, opts: { out: string; binMinutes: string; live: boolean }) => {
    setQuiet(program.opts().quiet);
    const dataset = await resolveDataset(input, opts.live);
    const binMinutes = Number(opts.binMinutes) || 1;
    const analysis = analyze(dataset, binMinutes);
    const outDir = resolve(process.cwd(), opts.out);

    await writeOut(resolve(outDir, 'dataset.json'), JSON.stringify(dataset, null, 2));
    await writeOut(resolve(outDir, 'analysis.json'), JSON.stringify(analysis, null, 2));
    await writeOut(resolve(outDir, 'passing-table.csv'), toCsv(buildWideTable(dataset)));
    await writeOut(resolve(outDir, 'finish-rate.csv'), toCsv(buildFinishRateTable(analysis)));
    await writeOut(resolve(outDir, 'dashboard.html'), generateDashboard(analysis, dataset));

    console.error('');
    console.error(`■ ${[analysis.raceName, analysis.kind].filter(Boolean).join(' / ') || '(大会名不明)'}`);
    console.error(
      `  通過選手 ${analysis.totalRunners} 名 / 完走 ${analysis.finishers} 名 / 全体完走率 ${
        analysis.finishRate != null ? (analysis.finishRate * 100).toFixed(1) + '%' : '-'
      }`,
    );
    for (const cp of analysis.checkpoints) {
      const co = cp.finishRate50CutoffSec;
      console.error(
        `  ・${cp.checkpoint.padEnd(6)} 通過${String(cp.totalPassers).padStart(4)} / 完走${String(
          cp.totalFinishers,
        ).padStart(4)} / 完走率 ${
          cp.overallFinishRate != null ? (cp.overallFinishRate * 100).toFixed(1) + '%' : '-'
        }${co != null ? `  (50%割れ目安: 経過${Math.floor(co / 60)}分〜)` : ''}`,
      );
    }
    console.error(`\n  → ダッシュボード: ${resolve(outDir, 'dashboard.html')}`);
  });

program
  .command('index')
  .description(
    '出力ディレクトリ直下の各レースフォルダ(analysis.json を含む)を集めて目次ページ(index.html)を生成',
  )
  .argument('[dir]', '走査するディレクトリ', 'out')
  .option('-o, --out <file>', '出力先 HTML（省略時は <dir>/index.html）')
  .option('-t, --title <title>', '目次ページのタイトル')
  .action(async (dir: string, opts: { out?: string; title?: string }) => {
    setQuiet(program.opts().quiet);
    const baseDir = resolve(process.cwd(), dir);
    const children = await readdir(baseDir, { withFileTypes: true });

    const entries: RaceIndexEntry[] = [];
    const crossEntries: { dir: string; dataset: SplitsDataset }[] = [];
    for (const child of children) {
      if (!child.isDirectory()) continue;
      // このツールが生成したレースフォルダ(race-<raceId>)のみを対象にする。
      // 他ツール/他パイプラインの出力フォルダが同じ out/ 配下にあっても混在させない。
      if (!/^race-\d+$/.test(child.name)) continue;
      const analysisPath = join(baseDir, child.name, 'analysis.json');
      try {
        const text = await readFile(analysisPath, 'utf8');
        const analysis = JSON.parse(text) as RaceAnalysis;
        entries.push({ dir: child.name, analysis });
      } catch {
        warn(`スキップ: ${child.name}（analysis.json が見つかりません）`);
        continue;
      }
      try {
        const datasetPath = join(baseDir, child.name, 'dataset.json');
        const text = await readFile(datasetPath, 'utf8');
        crossEntries.push({ dir: child.name, dataset: JSON.parse(text) as SplitsDataset });
      } catch {
        warn(`${child.name}: dataset.json が見つからず、選手横断検索の対象から除外します。`);
      }
    }

    if (entries.length === 0) {
      throw new Error(`${baseDir} 配下に analysis.json を含むレースフォルダが見つかりません。`);
    }

    const crossRunnerData = buildCrossRunnerData(crossEntries);
    const html = generateIndexPage(entries, { title: opts.title, crossRunnerData });
    const outPath = opts.out ? resolve(process.cwd(), opts.out) : resolve(baseDir, 'index.html');
    await writeOut(outPath, html);
    console.error(`目次ページを生成しました: ${entries.length} レース`);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error('[error]', err instanceof Error ? err.message : err);
  process.exit(1);
});
