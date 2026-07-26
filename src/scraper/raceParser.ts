/**
 * RUNNET 大会結果ページ（1 地点 × 1 種目）の HTML を解析して
 * CheckpointSplit[] に正規化するヒューリスティックパーサ。
 *
 * 実測した結果テーブルの列（富士登山競走 山頂総合の例）:
 *   Bib. | 氏名 | ネットタイム | グロスタイム | WEB完走証 | 詳細
 * ネットタイムは空欄のことが多く、グロスタイム（号砲起点の経過時間）が主データ。
 *
 * ■ 設計方針
 *  大会ごとに列構成が異なり公開 API も無いため、特定の CSS セレクタに依存せず、
 *   1) 全 <table> からヘッダーのキーワード一致度で結果テーブルを自動判定
 *   2) ヘッダー文字列から列（Bib/氏名/ネット/グロス）を推定
 *   3) 取り込めなかった列は raw に保存
 *  という堅牢な戦略を採る。実 DOM を確認できたら KEYWORDS を調整して精度向上可。
 */

import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { CheckpointSplit } from '../types.js';
import { parseTimeToSeconds } from '../util/time.js';

type Field = 'bib' | 'name' | 'net' | 'gross';

/** ヘッダー語 -> フィールド。部分一致・上から優先。 */
const KEYWORDS: { field: Field; keywords: string[] }[] = [
  { field: 'net', keywords: ['ネットタイム', 'ネット', 'net'] },
  { field: 'gross', keywords: ['グロスタイム', 'グロス', 'gross', '記録', 'タイム', 'time', 'フィニッシュ'] },
  { field: 'name', keywords: ['氏名', '名前', 'お名前', 'name', 'ランナー', '選手名'] },
  { field: 'bib', keywords: ['bib', 'ゼッケン', 'ナンバーカード', 'ナンバー', 'no.', 'no', 'ナンバーno'] },
];

/** 結果テーブル判定に使うヘッダー語。 */
const RESULT_HEADER_HINTS = [
  'bib',
  'ゼッケン',
  'ナンバー',
  '氏名',
  '名前',
  'ネット',
  'グロス',
  '記録',
  'タイム',
  '順位',
];

export interface ParsedCheckpoint {
  raceName?: string;
  raceDate?: string;
  /** 種目名（"山頂総合" 等、ページから拾えた場合）。 */
  kind?: string;
  columns: string[];
  splits: CheckpointSplit[];
  notes: string[];
}

/** HTML 文字列を解析して 1 地点ぶんの通過記録を返す。 */
export function parseCheckpointHtml(html: string): ParsedCheckpoint {
  const $ = cheerio.load(html);
  const notes: string[] = [];

  const raceName = extractRaceName($);
  const raceDate = extractRaceDate($);
  const kind = extractKind($);

  const table = pickResultTable($);
  if (!table) {
    notes.push(
      '結果テーブルを検出できませんでした。結果が Ajax で別途読み込まれている、' +
        'または保存時に結果部分が含まれていない可能性があります。' +
        'ブラウザで結果が表示された状態のページを「完全な HTML」で保存してください。',
    );
    return { raceName, raceDate, kind, columns: [], splits: [], notes };
  }

  const { headers, rows } = extractTable($, table);
  const mapping = mapColumns(headers);
  const fields = new Set(Object.values(mapping));
  if (!fields.has('gross') && !fields.has('net')) {
    notes.push('タイム列（グロス/ネット）を特定できませんでした。列名を確認してください。');
  }
  if (!fields.has('bib')) {
    notes.push('Bib（ゼッケン）列を特定できませんでした。選手の突き合わせ精度が下がります。');
  }

  const splits: CheckpointSplit[] = [];
  for (const cells of rows) {
    const s = rowToSplit(cells, headers, mapping);
    if (s) splits.push(s);
  }
  if (splits.length === 0) {
    notes.push('データ行を抽出できませんでした。テーブル構造を確認してください。');
  }

  return { raceName, raceDate, kind, columns: headers, splits, notes };
}

function textOf($: cheerio.CheerioAPI, el: AnyNode): string {
  return $(el).text().replace(/\s+/g, ' ').trim();
}

function extractRaceName($: cheerio.CheerioAPI): string | undefined {
  const candidates = [
    $('h1').first().text(),
    $('.raceName, .race-name, #raceName').first().text(),
    $('title').first().text(),
  ];
  for (const c of candidates) {
    let t = c.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    // "速報" バッジや RUNNET サフィックスを除去
    t = t
      .replace(/^速報\s*/, '')
      .replace(/\s*[|｜].*$/i, '')
      .replace(/\s*大会結果.*$/, '')
      .trim();
    if (t) return t;
  }
  return undefined;
}

function extractRaceDate($: cheerio.CheerioAPI): string | undefined {
  const body = $('body').text();
  const m =
    body.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/) ||
    body.match(/(\d{4})[/.](\d{1,2})[/.](\d{1,2})/);
  if (m) {
    return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }
  return undefined;
}

function extractKind($: cheerio.CheerioAPI): string | undefined {
  // 種目セレクトの選択中 option、または見出し（例: "山頂総合"）
  const sel = $('select option[selected]').first().text().trim();
  if (sel) return sel;
  const h = $('h2, h3').filter((_, el) => /総合|の部|コース/.test($(el).text())).first().text().trim();
  return h || undefined;
}

function pickResultTable($: cheerio.CheerioAPI): AnyNode | undefined {
  let best: { el: AnyNode; score: number } | undefined;
  $('table').each((_, el) => {
    const headerText = $(el).find('tr').first().text().toLowerCase();
    let score = 0;
    for (const hint of RESULT_HEADER_HINTS) if (headerText.includes(hint.toLowerCase())) score += 1;
    if ($(el).find('tr').length >= 3) score += 1;
    if (score > 0 && (!best || score > best.score)) best = { el, score };
  });
  return best?.el;
}

interface ExtractedTable {
  headers: string[];
  rows: string[][];
}

function extractTable($: cheerio.CheerioAPI, table: AnyNode): ExtractedTable {
  const trs = $(table).find('tr').toArray();
  if (trs.length === 0) return { headers: [], rows: [] };

  let headers: string[] = [];
  const theadTh = $(table).find('thead th').toArray();
  if (theadTh.length > 0) {
    headers = theadTh.map((th) => textOf($, th));
  } else {
    const firstCells = $(trs[0]).find('th,td').toArray();
    const looksHeader =
      $(trs[0]).find('th').length > 0 ||
      firstCells.every((c) => parseTimeToSeconds(textOf($, c)) === undefined);
    if (looksHeader) headers = firstCells.map((c) => textOf($, c));
  }

  const dataTrs = $(table).find('tbody tr').toArray();
  const iterable = dataTrs.length > 0 ? dataTrs : trs;
  const rows: string[][] = [];
  for (let i = 0; i < iterable.length; i++) {
    if (dataTrs.length === 0 && headers.length > 0 && i === 0) continue;
    const cells = $(iterable[i]).find('td,th').toArray();
    if (cells.length === 0) continue;
    const values = cells.map((c) => textOf($, c));
    if (values.every((v) => v === '')) continue;
    rows.push(values);
  }
  return { headers, rows };
}

function mapColumns(headers: string[]): Record<number, Field> {
  const mapping: Record<number, Field> = {};
  const used = new Set<Field>();
  headers.forEach((h, i) => {
    const norm = h.toLowerCase().replace(/\s+/g, '').replace(/\./g, '');
    for (const { field, keywords } of KEYWORDS) {
      if (used.has(field)) continue;
      if (keywords.some((k) => norm.includes(k.toLowerCase().replace(/\./g, '')))) {
        mapping[i] = field;
        used.add(field);
        break;
      }
    }
  });
  return mapping;
}

function rowToSplit(
  cells: string[],
  headers: string[],
  mapping: Record<number, Field>,
): CheckpointSplit | undefined {
  const raw: Record<string, string> = {};
  const split: CheckpointSplit = { raw };
  cells.forEach((value, i) => {
    const header = headers[i] ?? `col${i}`;
    raw[header] = value;
    switch (mapping[i]) {
      case 'bib':
        split.bib = value.trim() || undefined;
        break;
      case 'name':
        split.name = value.trim() || undefined;
        break;
      case 'net':
        split.netSeconds = parseTimeToSeconds(value);
        break;
      case 'gross':
        split.grossSeconds = parseTimeToSeconds(value);
        break;
    }
  });
  // タイムも Bib も名前も無い行は捨てる
  if (split.grossSeconds == null && split.netSeconds == null && !split.bib && !split.name) {
    return undefined;
  }
  return split;
}
