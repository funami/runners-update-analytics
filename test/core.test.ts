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

test('mergeRunners: ゴール地点の制限時間(cutoffSeconds)超過は完走に数えない', () => {
  const tables: CheckpointTable[] = [
    {
      checkpoint: '馬返し',
      order: 1,
      goal: false,
      splits: [
        { bib: '1', grossSeconds: 60 * 60, raw: {} },
        { bib: '2', grossSeconds: 60 * 60, raw: {} },
      ],
      notes: [],
    },
    {
      checkpoint: 'Finish',
      order: 2,
      goal: true,
      cutoffSeconds: 4 * 3600 + 30 * 60, // 4:30:00 制限
      splits: [
        { bib: '1', grossSeconds: 4 * 3600 + 29 * 60, raw: {} }, // 制限内 → 完走
        { bib: '2', grossSeconds: 4 * 3600 + 30 * 60 + 1, raw: {} }, // 1秒超過 → 未完走
      ],
      notes: [],
    },
  ];

  const { runners, notes } = mergeRunners(tables);
  const r1 = runners.find((r) => r.bib === '1')!;
  const r2 = runners.find((r) => r.bib === '2')!;
  assert.equal(r1.finished, true);
  assert.equal(r1.finishGrossSeconds, 4 * 3600 + 29 * 60);
  // 制限超過でも Finish 地点自体には到達しているので lastCheckpoint は Finish のまま
  assert.equal(r2.finished, false);
  assert.equal(r2.finishGrossSeconds, undefined);
  assert.equal(r2.lastCheckpoint, 'Finish');
  assert.ok(notes.some((n) => n.includes('制限時間を超過')));
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

test('buildWideTable: 最終到達地点が遠い順、同地点内は到達が早い順に並ぶ', () => {
  const dataset: SplitsDataset = {
    fetchedAt: 'x',
    checkpoints: [
      { name: '馬返し', order: 1, goal: false },
      { name: '五合目', order: 2, goal: false },
      { name: 'Finish', order: 3, goal: true },
    ],
    tables: [],
    runners: [
      // 馬返しで止まった選手（到達順: 200 が先, 100 は後）
      {
        bib: '100',
        grossByCheckpoint: { 馬返し: 4000 },
        netByCheckpoint: {},
        finished: false,
        lastCheckpoint: '馬返し',
      },
      {
        bib: '200',
        grossByCheckpoint: { 馬返し: 3000 },
        netByCheckpoint: {},
        finished: false,
        lastCheckpoint: '馬返し',
      },
      // Finish まで到達した完走者2名（到達順: 1 が先, 2 は後）
      {
        bib: '2',
        grossByCheckpoint: { 馬返し: 3600, 五合目: 7000, Finish: 9700 },
        netByCheckpoint: {},
        finished: true,
        finishGrossSeconds: 9700,
        lastCheckpoint: 'Finish',
      },
      {
        bib: '1',
        grossByCheckpoint: { 馬返し: 3500, 五合目: 6800, Finish: 9600 },
        netByCheckpoint: {},
        finished: true,
        finishGrossSeconds: 9600,
        lastCheckpoint: 'Finish',
      },
      // 五合目止まりの選手
      {
        bib: '300',
        grossByCheckpoint: { 馬返し: 3400, 五合目: 8000 },
        netByCheckpoint: {},
        finished: false,
        lastCheckpoint: '五合目',
      },
    ],
    notes: [],
  };

  const rows = buildWideTable(dataset);
  const bibs = rows.slice(1).map((r) => r[0]);
  // Finish(1,2) → 五合目(300) → 馬返し(200,100) の順。各グループ内は到達が早い順。
  assert.deepEqual(bibs, ['1', '2', '300', '200', '100']);
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
