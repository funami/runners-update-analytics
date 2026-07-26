import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTimeToSeconds, formatSeconds } from '../src/util/time.js';
import { parseCheckpointHtml } from '../src/scraper/raceParser.js';
import { mergeRunners } from '../src/ingest.js';
import { analyze, parseClock, clockLabel, buildWideTable } from '../src/analysis.js';
import { parseCsv, toCsv } from '../src/util/csv.js';
import type { CheckpointTable, SplitsDataset } from '../src/types.js';

test('parseTimeToSeconds: 各種表記', () => {
  assert.equal(parseTimeToSeconds('2:43:58'), 2 * 3600 + 43 * 60 + 58);
  assert.equal(parseTimeToSeconds('45:51'), 45 * 60 + 51);
  assert.equal(parseTimeToSeconds('1時間23分45秒'), 3600 + 23 * 60 + 45);
  assert.equal(parseTimeToSeconds('０:４５:５１'), 45 * 60 + 51);
  assert.equal(parseTimeToSeconds('DNF'), undefined);
  assert.equal(parseTimeToSeconds(''), undefined);
});

test('formatSeconds', () => {
  assert.equal(formatSeconds(2 * 3600 + 43 * 60 + 58), '2:43:58');
  assert.equal(formatSeconds(45 * 60 + 51), '45:51');
});

test('parseCheckpointHtml: RUNNET 風テーブルを解析', () => {
  const html = `<html><head><title>速報 第79回富士登山競走 | RUNNET</title></head><body>
    <h1>第79回富士登山競走</h1><p>開催日 2026年7月24日 (金)</p>
    <table><thead>
      <tr><th>Bib.</th><th>氏名</th><th>ネットタイム</th><th>グロスタイム</th><th>WEB完走証</th><th>詳細</th></tr>
    </thead><tbody>
      <tr><td>2</td><td>山口 大河</td><td></td><td>0:45:51</td><td>証</td><td>詳細</td></tr>
      <tr><td>10</td><td>山田 雄喜</td><td></td><td>0:45:51</td><td>証</td><td>詳細</td></tr>
    </tbody></table></body></html>`;
  const r = parseCheckpointHtml(html);
  assert.equal(r.raceName, '第79回富士登山競走');
  assert.equal(r.raceDate, '2026-07-24');
  assert.equal(r.splits.length, 2);
  assert.equal(r.splits[0].bib, '2');
  assert.equal(r.splits[0].name, '山口 大河');
  assert.equal(r.splits[0].grossSeconds, 45 * 60 + 51);
});

test('mergeRunners + analyze: 通過→完走率', () => {
  const mk = (
    checkpoint: string,
    order: number,
    goal: boolean,
    rows: [string, number][],
  ): CheckpointTable => ({
    checkpoint,
    order,
    goal,
    splits: rows.map(([bib, gross]) => ({ bib, grossSeconds: gross, raw: {} })),
    notes: [],
  });

  // 3人が馬返し通過。うち完走(Finish到達)は2人。
  const tables: CheckpointTable[] = [
    mk('馬返し', 1, false, [
      ['1', 60 * 60], // 60分通過 → 完走
      ['2', 60 * 60], // 60分通過 → 完走
      ['3', 62 * 60], // 62分通過 → 未完走
    ]),
    mk('Finish', 2, true, [
      ['1', 160 * 60],
      ['2', 165 * 60],
    ]),
  ];

  const { runners } = mergeRunners(tables);
  assert.equal(runners.length, 3);
  assert.equal(runners.filter((r) => r.finished).length, 2);

  const dataset: SplitsDataset = {
    fetchedAt: '2026-01-01T00:00:00.000Z',
    startTime: '07:00',
    checkpoints: [
      { name: '馬返し', order: 1, goal: false },
      { name: 'Finish', order: 2, goal: true },
    ],
    tables,
    runners,
    notes: [],
  };

  const a = analyze(dataset, 1);
  assert.equal(a.totalRunners, 3);
  assert.equal(a.finishers, 2);
  const umagaeshi = a.checkpoints.find((c) => c.checkpoint === '馬返し')!;
  // 60分ビン: 2人通過, 2人完走 → 100%
  const bin60 = umagaeshi.bins.find((b) => b.startSec === 3600)!;
  assert.equal(bin60.passers, 2);
  assert.equal(bin60.finishers, 2);
  assert.equal(bin60.finishRate, 1);
  // 62分ビン: 1人通過, 0人完走 → 0%
  const bin62 = umagaeshi.bins.find((b) => b.startSec === 62 * 60)!;
  assert.equal(bin62.passers, 1);
  assert.equal(bin62.finishers, 0);
  assert.equal(bin62.finishRate, 0);
  // 通過時刻ラベル(号砲07:00 + 60分 = 08:00)
  assert.equal(bin60.clockLabel, '08:00');
});

test('parseClock / clockLabel', () => {
  assert.equal(parseClock('07:00'), 7 * 3600);
  assert.equal(clockLabel(60 * 60, 7 * 3600), '08:00');
  assert.equal(clockLabel(60 * 60, undefined), undefined);
});

test('buildWideTable: 選手ごとに各地点列', () => {
  const dataset: SplitsDataset = {
    fetchedAt: 'x',
    startTime: '07:00',
    checkpoints: [
      { name: '馬返し', order: 1, goal: false },
      { name: 'Finish', order: 2, goal: true },
    ],
    tables: [],
    runners: [
      {
        bib: '1',
        name: 'A',
        grossByCheckpoint: { 馬返し: 3600, Finish: 9600 },
        netByCheckpoint: {},
        finished: true,
        finishGrossSeconds: 9600,
        lastCheckpoint: 'Finish',
      },
    ],
    notes: [],
  };
  const rows = buildWideTable(dataset);
  assert.equal(rows[0][0], 'Bib');
  assert.ok((rows[0] as string[]).includes('馬返し 通過時刻'));
  assert.equal(rows[1][0], '1');
  assert.equal(rows[1][2], '1:00:00'); // 馬返しグロス
});

test('CSV roundtrip', () => {
  const rows = [
    ['a', 'b,c'],
    ['1', '2\n3'],
  ];
  const csv = toCsv(rows, false);
  const back = parseCsv(csv);
  assert.deepEqual(back, rows);
});
