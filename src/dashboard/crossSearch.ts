/** 目次ページ用: 大会をまたいだ選手名検索のためのデータ集約。 */

import type { SplitsDataset } from '../types.js';

export interface CrossRaceRef {
  dir: string;
  raceName?: string;
  /** raceName から抽出した「第N回」の N（抽出できなければ undefined）。 */
  raceNumber?: number;
  /** コース順の地点名一覧（このレースの表示順）。 */
  checkpoints: string[];
}

export interface CrossRunnerRow {
  name: string;
  bib: string;
  /** races[] のインデックス。 */
  r: number;
  /** 地点名 -> グロス秒。 */
  splits: Record<string, number>;
}

export interface CrossRunnerData {
  races: CrossRaceRef[];
  runners: CrossRunnerRow[];
}

function parseRaceNumber(raceName?: string): number | undefined {
  const m = raceName?.match(/第(\d+)回/);
  return m ? Number(m[1]) : undefined;
}

/** 各レースの SplitsDataset をまとめ、選手名検索用の軽量データを構築する。 */
export function buildCrossRunnerData(
  entries: { dir: string; dataset: SplitsDataset }[],
): CrossRunnerData {
  const races: CrossRaceRef[] = entries.map((e) => ({
    dir: e.dir,
    raceName: e.dataset.raceName,
    raceNumber: parseRaceNumber(e.dataset.raceName),
    checkpoints: e.dataset.checkpoints
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((c) => c.name),
  }));

  const runners: CrossRunnerRow[] = [];
  entries.forEach((e, r) => {
    for (const runner of e.dataset.runners) {
      if (!runner.name) continue;
      runners.push({ name: runner.name, bib: runner.bib, r, splits: runner.grossByCheckpoint });
    }
  });

  return { races, runners };
}
