import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRaceMeta,
  fetchLocationAthletes,
  athletesToSplits,
  type RunnetAthlete,
} from '../src/scraper/runnetApi.js';

/** result.one.runnet.jp/races/{raceId}/leaderboard の実ページを模した最小 HTML。 */
function sampleLeaderboardHtml(raceId: string): string {
  const inner = JSON.stringify({
    raceId,
    categories: [{ id: '1', name: '山頂男子', numFinisher: 704, locations: [] }],
    generalCategories: [
      {
        id: '1',
        name: '山頂総合',
        numFinisher: 734,
        locations: [
          { id: 2, name: '馬返し', distance: 11.4 },
          { id: 3, name: '五合目', distance: 15 },
          { id: 5, name: '八合目', distance: 19.8 },
          { id: 6, name: 'Finish', distance: 21, isFinish: true },
        ],
      },
    ],
    categoryId: '$undefined',
  });
  // 実ページ同様、"content":[...,{...}] の一部として埋め込む。JSON.stringify で二重に
  // エスケープしてから <script> の JS 文字列リテラルに詰める。
  const rscRow = `a:[\"$\",\"$L23\",null,{\"raceId\":\"${raceId}\",\"content\":${inner}}]\n`;
  const pushed = JSON.stringify(rscRow);
  return `<!doctype html><html><body>
    <h1>第79回富士登山競走</h1>
    <p>開催日 2026年7月24日 (金)</p>
    <script>self.__next_f.push([1,${pushed}])</script>
  </body></html>`;
}

test('parseRaceMeta: leaderboard HTML から種目・地点・大会名・開催日を抽出', () => {
  const html = sampleLeaderboardHtml('386774');
  const meta = parseRaceMeta(html, '386774');
  assert.equal(meta.raceName, '第79回富士登山競走');
  assert.equal(meta.raceDate, '2026-07-24');
  assert.equal(meta.generalCategories.length, 1);
  assert.equal(meta.generalCategories[0].name, '山頂総合');
  assert.deepEqual(
    meta.generalCategories[0].locations.map((l) => l.name),
    ['馬返し', '五合目', '八合目', 'Finish'],
  );
  assert.equal(meta.generalCategories[0].locations[3].isFinish, true);
  assert.equal(meta.categories[0].name, '山頂男子');
});

test('parseRaceMeta: raceId が一致しない/データが無ければ空配列', () => {
  const html = sampleLeaderboardHtml('999999');
  const meta = parseRaceMeta(html, '386774');
  assert.deepEqual(meta.generalCategories, []);
  assert.deepEqual(meta.categories, []);
});

test('fetchLocationAthletes: 0始まりページングで重複・欠落なく全件取得', async () => {
  const page0: RunnetAthlete[] = Array.from({ length: 3 }, (_, i) => ({
    runnerId: String(i + 1),
    bibNo: String(i + 1),
    name: `選手${i + 1}`,
    grossTime: '1:00:00',
  }));
  const page1: RunnetAthlete[] = [{ runnerId: '4', bibNo: '4', name: '選手4', grossTime: '1:05:00' }];

  const calls: string[] = [];
  const fetchFn = async (url: string) => {
    calls.push(url);
    if (url.includes('page=0')) return JSON.stringify({ athletes: page0 });
    if (url.includes('page=1')) return JSON.stringify({ athletes: page1 });
    return 'null'; // ページ範囲外は body が JSON の null
  };

  const athletes = await fetchLocationAthletes(
    '386774',
    { kind: 'general', id: '1' },
    6,
    { fetchFn, pageSize: 3 },
  );

  assert.equal(athletes.length, 4);
  assert.deepEqual(
    athletes.map((a) => a.bibNo),
    ['1', '2', '3', '4'],
  );
  assert.equal(calls.length, 3); // page=0,1,2(null で終了)
  assert.ok(calls[0].includes('/api/races/386774/general-categories/1'));
  assert.ok(calls[0].includes('location=6'));
});

test('fetchLocationAthletes: 速報(isFixed=false)が空なら確報(isFixed=true)にフォールバック', async () => {
  const confirmed: RunnetAthlete[] = [{ runnerId: '9', bibNo: '9', name: '選手9', grossTime: '2:00:00' }];

  const calls: string[] = [];
  const fetchFn = async (url: string) => {
    calls.push(url);
    if (url.includes('isFixed=false')) return 'null'; // 速報は既に確報に差し替え済み
    if (url.includes('isFixed=true') && url.includes('page=0')) {
      return JSON.stringify({ athletes: confirmed });
    }
    return 'null';
  };

  const athletes = await fetchLocationAthletes(
    '372194',
    { kind: 'general', id: '1' },
    6,
    { fetchFn, pageSize: 100 },
  );

  assert.equal(athletes.length, 1);
  assert.equal(athletes[0].bibNo, '9');
  // isFixed=false を先に試し、空だったので isFixed=true にフォールバックしている
  assert.ok(calls.some((c) => c.includes('isFixed=false') && c.includes('page=0')));
  assert.ok(calls.some((c) => c.includes('isFixed=true') && c.includes('page=0')));
});

test('athletesToSplits: bib/氏名/グロス秒への変換', () => {
  const splits = athletesToSplits([
    { bibNo: '22', name: '小島 弘道', teamName: 'チーム100マイル', grossTime: '3:05:28' },
  ]);
  assert.equal(splits.length, 1);
  assert.equal(splits[0].bib, '22');
  assert.equal(splits[0].name, '小島 弘道');
  assert.equal(splits[0].grossSeconds, 3 * 3600 + 5 * 60 + 28);
  assert.equal(splits[0].netSeconds, undefined);
});
