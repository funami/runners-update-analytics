/**
 * マニフェスト（地点一覧＋各地点の HTML/CSV/URL）から SplitsDataset を構築する。
 *
 * - html: 保存済み HTML を parseCheckpointHtml で解析
 * - csv:  bib/name/net/gross 列を含む CSV を解析
 * - url:  ネットワーク許可環境で fetchHtml → parseCheckpointHtml
 *
 * 各地点の CheckpointSplit を Bib で突き合わせ、選手別の RunnerSplits を作る。
 * ゴール（山頂）地点を通過した選手を「完走」とみなす。
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type {
  CheckpointSplit,
  CheckpointTable,
  ManifestCheckpoint,
  RaceManifest,
  RunnerSplits,
  SplitsDataset,
} from './types.js';
import { parseCheckpointHtml } from './scraper/raceParser.js';
import { fetchHtml, type FetchOptions } from './scraper/http.js';
import {
  RESULT_ONE_BASE,
  athletesToSplits,
  fetchLocationAthletes,
  fetchRaceMeta,
  type RunnetFetchOptions,
} from './scraper/runnetApi.js';
import { parseCsv } from './util/csv.js';
import { parseTimeToSeconds } from './util/time.js';
import { info, warn } from './util/logger.js';

export interface IngestOptions extends FetchOptions {
  /** マニフェスト内の相対パス解決の基準ディレクトリ。 */
  baseDir?: string;
  /** テスト用: 時刻注入。 */
  clock?: () => Date;
  /** テスト用: URL 取得関数の差し替え。 */
  fetchFn?: (url: string, opts?: FetchOptions) => Promise<string>;
}

function nowIso(clock?: () => Date): string {
  return (clock ? clock() : new Date()).toISOString();
}

/** CSV から CheckpointSplit[] を作る。ヘッダー行から列位置を推定。 */
export function splitsFromCsv(text: string): { splits: CheckpointSplit[]; notes: string[] } {
  const rows = parseCsv(text);
  const notes: string[] = [];
  if (rows.length === 0) return { splits: [], notes: ['CSV が空です。'] };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const find = (keys: string[]) =>
    header.findIndex((h) => keys.some((k) => h.includes(k)));
  const bibIdx = find(['bib', 'ゼッケン', 'ナンバー', 'no']);
  const nameIdx = find(['氏名', '名前', 'name']);
  const netIdx = find(['ネット', 'net']);
  const grossIdx = find(['グロス', 'gross', '記録', 'タイム', 'time']);

  if (grossIdx < 0 && netIdx < 0) notes.push('CSV にタイム列が見つかりません。');

  const splits: CheckpointSplit[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const raw: Record<string, string> = {};
    header.forEach((h, j) => (raw[rows[0][j] ?? `col${j}`] = r[j] ?? ''));
    const split: CheckpointSplit = {
      bib: bibIdx >= 0 ? r[bibIdx]?.trim() || undefined : undefined,
      name: nameIdx >= 0 ? r[nameIdx]?.trim() || undefined : undefined,
      netSeconds: netIdx >= 0 ? parseTimeToSeconds(r[netIdx]) : undefined,
      grossSeconds: grossIdx >= 0 ? parseTimeToSeconds(r[grossIdx]) : undefined,
      raw,
    };
    if (split.grossSeconds != null || split.netSeconds != null || split.bib || split.name) {
      splits.push(split);
    }
  }
  return { splits, notes };
}

async function loadCheckpointTable(
  cp: ManifestCheckpoint,
  order: number,
  goal: boolean,
  kind: string | undefined,
  opts: IngestOptions,
): Promise<CheckpointTable> {
  const baseDir = opts.baseDir ?? process.cwd();
  const notes: string[] = [];
  let splits: CheckpointSplit[] = [];
  let source: string | undefined;

  if (cp.html) {
    source = resolve(baseDir, cp.html);
    info(`checkpoint "${cp.name}": read HTML ${source}`);
    const html = await readFile(source, 'utf8');
    const parsed = parseCheckpointHtml(html);
    splits = parsed.splits;
    notes.push(...parsed.notes);
  } else if (cp.csv) {
    source = resolve(baseDir, cp.csv);
    info(`checkpoint "${cp.name}": read CSV ${source}`);
    const text = await readFile(source, 'utf8');
    const r = splitsFromCsv(text);
    splits = r.splits;
    notes.push(...r.notes);
  } else if (cp.url) {
    source = cp.url;
    info(`checkpoint "${cp.name}": fetch ${source}`);
    const fetcher = opts.fetchFn ?? fetchHtml;
    const html = await fetcher(cp.url, opts);
    const parsed = parseCheckpointHtml(html);
    splits = parsed.splits;
    notes.push(...parsed.notes);
  } else {
    notes.push(`地点 "${cp.name}" に html / csv / url のいずれも指定がありません。`);
  }

  return { checkpoint: cp.name, order, goal, kind, splits, source, notes };
}

/** 地点テーブル群を Bib で突き合わせて RunnerSplits[] を作る。 */
export function mergeRunners(
  tables: CheckpointTable[],
): { runners: RunnerSplits[]; notes: string[] } {
  const notes: string[] = [];
  const ordered = [...tables].sort((a, b) => a.order - b.order);
  const goalTables = ordered.filter((t) => t.goal);

  const byBib = new Map<string, RunnerSplits>();
  let missingBib = 0;

  for (const table of ordered) {
    for (const s of table.splits) {
      const gross = s.grossSeconds ?? s.netSeconds;
      if (gross == null) continue;
      // Bib が無い場合は氏名で代替キー
      const key = s.bib ?? (s.name ? `name:${s.name}` : undefined);
      if (!key) {
        missingBib++;
        continue;
      }
      let runner = byBib.get(key);
      if (!runner) {
        runner = {
          bib: s.bib ?? key,
          name: s.name,
          grossByCheckpoint: {},
          netByCheckpoint: {},
          finished: false,
        };
        byBib.set(key, runner);
      }
      runner.name = runner.name ?? s.name;
      // 同一地点に複数行があれば速い方を採用
      const prev = runner.grossByCheckpoint[table.checkpoint];
      if (prev == null || gross < prev) runner.grossByCheckpoint[table.checkpoint] = gross;
      if (s.netSeconds != null) {
        const pn = runner.netByCheckpoint[table.checkpoint];
        if (pn == null || s.netSeconds < pn) runner.netByCheckpoint[table.checkpoint] = s.netSeconds;
      }
    }
  }

  if (missingBib > 0) {
    notes.push(`Bib も氏名も無い行が ${missingBib} 件あり、突き合わせから除外しました。`);
  }

  // 完走判定・最終到達地点
  let overCutoff = 0;
  for (const runner of byBib.values()) {
    const reached = ordered.filter((t) => runner.grossByCheckpoint[t.checkpoint] != null);
    runner.lastCheckpoint = reached.length ? reached[reached.length - 1].checkpoint : undefined;
    for (const g of goalTables) {
      const gross = runner.grossByCheckpoint[g.checkpoint];
      if (gross == null) continue;
      if (g.cutoffSeconds != null && gross > g.cutoffSeconds) {
        overCutoff++;
        continue; // 制限時間超過。ゴール地点には到達したが「完走」には数えない
      }
      runner.finished = true;
      runner.finishGrossSeconds = gross;
      break;
    }
  }
  if (overCutoff > 0) {
    notes.push(`ゴール地点の制限時間を超過したため完走に数えなかった選手が ${overCutoff} 名います。`);
  }

  const runners = [...byBib.values()].sort((a, b) => {
    // 完走者はゴールタイム順、非完走者は後ろ
    if (a.finished && b.finished) return (a.finishGrossSeconds ?? 0) - (b.finishGrossSeconds ?? 0);
    if (a.finished) return -1;
    if (b.finished) return 1;
    return 0;
  });

  return { runners, notes };
}

/** RUNNET 新 API (result.one.runnet.jp) から地点一覧・選手記録を自動取得する。 */
async function ingestFromRunnetApi(
  manifest: RaceManifest,
  opts: IngestOptions,
): Promise<SplitsDataset> {
  const api = manifest.runnetApi;
  if (!api) throw new Error('runnetApi が指定されていません。');
  if (!manifest.raceId) throw new Error('runnetApi 指定には raceId が必須です。');

  const kind = api.categoryKind ?? 'general';
  const runnetOpts: RunnetFetchOptions = { ...opts, pageSize: api.pageSize };

  const meta = await fetchRaceMeta(manifest.raceId, runnetOpts);
  const list = kind === 'general' ? meta.generalCategories : meta.categories;
  const category = list.find((c) => c.id === api.categoryId);
  if (!category) {
    const available = list.map((c) => `${c.id}:${c.name}`).join(', ') || '(なし)';
    throw new Error(
      `raceId=${manifest.raceId} に categoryId=${api.categoryId} (${kind}) が見つかりません。` +
        `利用可能な種目: ${available}`,
    );
  }

  const tables: CheckpointTable[] = [];
  const locations = category.locations;
  for (let i = 0; i < locations.length; i++) {
    const loc = locations[i];
    const order = i + 1;
    const goal = loc.isFinish === true || i === locations.length - 1;
    info(`checkpoint "${loc.name}": RUNNET API から取得 (location=${loc.id})`);
    const athletes = await fetchLocationAthletes(
      manifest.raceId,
      { kind, id: api.categoryId },
      loc.id,
      runnetOpts,
    );
    tables.push({
      checkpoint: loc.name,
      order,
      goal,
      kind: category.name,
      splits: athletesToSplits(athletes),
      source: `${RESULT_ONE_BASE}/api/races/${manifest.raceId}/${
        kind === 'general' ? 'general-categories' : 'categories'
      }/${api.categoryId}?location=${loc.id}`,
      cutoffSeconds: parseTimeToSeconds(manifest.checkpointCutoffs?.[loc.name]),
      notes: [],
    });
  }

  const { runners, notes } = mergeRunners(tables);
  const checkpoints = tables.map((t) => ({ name: t.checkpoint, order: t.order, goal: t.goal }));

  return {
    raceId: manifest.raceId,
    raceName: manifest.raceName ?? meta.raceName,
    raceDate: manifest.raceDate ?? meta.raceDate,
    kind: manifest.kind ?? category.name,
    startTime: manifest.startTime,
    fetchedAt: nowIso(opts.clock),
    checkpoints,
    tables,
    runners,
    notes,
  };
}

/** マニフェストを取り込み、SplitsDataset を構築する。 */
export async function ingestManifest(
  manifest: RaceManifest,
  opts: IngestOptions = {},
): Promise<SplitsDataset> {
  if (manifest.runnetApi) {
    return ingestFromRunnetApi(manifest, opts);
  }
  if (!manifest.checkpoints || manifest.checkpoints.length === 0) {
    throw new Error(
      'マニフェストに checkpoints がありません。html/csv/url を指定するか、' +
        'runnetApi を指定して --live 付きで実行してください。',
    );
  }
  const n = manifest.checkpoints.length;
  const anyGoalFlag = manifest.checkpoints.some((c) => c.goal);

  const tables: CheckpointTable[] = [];
  const notes: string[] = [];
  for (let i = 0; i < n; i++) {
    const cp = manifest.checkpoints[i];
    const order = cp.order ?? i + 1;
    // goal 明示が無ければ「最後の地点」をゴールとみなす
    const goal = anyGoalFlag ? !!cp.goal : i === n - 1;
    const table = await loadCheckpointTable(cp, order, goal, manifest.kind, opts);
    table.cutoffSeconds = parseTimeToSeconds(manifest.checkpointCutoffs?.[cp.name]);
    for (const note of table.notes) {
      const tagged = `[${cp.name}] ${note}`;
      if (!notes.includes(tagged)) notes.push(tagged);
    }
    tables.push(table);
  }

  const { runners, notes: mergeNotes } = mergeRunners(tables);
  notes.push(...mergeNotes);

  const goalCount = tables.filter((t) => t.goal).length;
  if (goalCount === 0) notes.push('ゴール地点が特定できませんでした。完走率を算出できません。');
  if (goalCount > 1) warn('ゴール地点が複数指定されています。いずれかを通過すれば完走扱いにします。');

  const checkpoints = tables
    .map((t) => ({ name: t.checkpoint, order: t.order, goal: t.goal }))
    .sort((a, b) => a.order - b.order);

  return {
    raceId: manifest.raceId,
    raceName: manifest.raceName ?? tables.find((t) => t.splits.length)?.checkpoint,
    raceDate: manifest.raceDate,
    kind: manifest.kind,
    startTime: manifest.startTime,
    fetchedAt: nowIso(opts.clock),
    checkpoints,
    tables,
    runners,
    notes,
  };
}

/** マニフェスト JSON ファイルを読み込む（相対パス解決の baseDir も返す）。 */
export async function loadManifest(path: string): Promise<{ manifest: RaceManifest; baseDir: string }> {
  const abs = resolve(process.cwd(), path);
  const text = await readFile(abs, 'utf8');
  const manifest = JSON.parse(text) as RaceManifest;
  return { manifest, baseDir: dirname(abs) };
}
