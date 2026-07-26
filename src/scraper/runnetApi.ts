/**
 * RUNNET 新プラットフォーム（result.one.runnet.jp）向けの取得。
 *
 * 大会結果ページ https://runnet.jp/record/race.do?raceId=... は
 * `<iframe src="https://result.one.runnet.jp/races/{raceId}">` を埋め込むだけの外枠で、
 * 実データはブラウザ側から同オリジンの JSON API を叩いて取得している（サーバ側では
 * ローディングスケルトンしか返らない）。専用のメタデータ API は無いため、種目・地点の
 * 一覧は `/races/{raceId}/leaderboard` の HTML に埋め込まれた
 * React Server Components ペイロード（`self.__next_f.push([1, "..."])`）から抽出する。
 *
 * 実データ取得:
 *   GET /api/races/{raceId}/general-categories/{categoryId}
 *       ?page=<0始まり>&num=<件数>&isFixed=false&location=<locationId>
 *   GET /api/races/{raceId}/categories/{categoryId}?... （個別種目、パラメータ同様）
 *
 * 確認済みの挙動（2026-07-26, raceId=386774 で検証）:
 *   - page は 0 始まり。範囲外のページを指定すると body が JSON の `null` になる。
 *   - num を大きくしすぎる（500 等）とサーバ側で 500 エラーになることがある。100 は安全。
 *   - 同一 num・同一時点であればページ間で重複・欠落なく全件を割れる
 *     （「速報は記録データの到着順に表示」＝順不同だが、num を変えなければ安定）。
 */

import * as cheerio from 'cheerio';
import { fetchHtml, type FetchOptions } from './http.js';
import type { CheckpointSplit } from '../types.js';
import { parseTimeToSeconds } from '../util/time.js';

export const RESULT_ONE_BASE = 'https://result.one.runnet.jp';

export interface RunnetLocation {
  id: number;
  name: string;
  distance?: number;
  isFinish?: boolean;
}

export interface RunnetCategoryMeta {
  id: string;
  name: string;
  numFinisher?: number;
  numGeneralFinisher?: number;
  locations: RunnetLocation[];
}

export interface RunnetRaceMeta {
  raceId: string;
  raceName?: string;
  raceDate?: string;
  /** 総合種目（例: "山頂総合"）。 */
  generalCategories: RunnetCategoryMeta[];
  /** 個別種目（例: "山頂男子" / "山頂女子"）。 */
  categories: RunnetCategoryMeta[];
}

export interface RunnetAthlete {
  runnerId?: string;
  bibNo: string;
  name?: string;
  teamName?: string;
  grossTime?: string;
  netTime?: string;
  categoryRank?: number;
  generalRank?: number;
}

export interface RunnetFetchOptions extends FetchOptions {
  fetchFn?: (url: string, opts?: FetchOptions) => Promise<string>;
  /** 1 ページあたりの取得件数（既定 100）。大きすぎるとサーバ側で 500 になることがある。 */
  pageSize?: number;
}

/** `self.__next_f.push([1, "..."])` の文字列断片を連結して 1 本のテキストにする。 */
function extractNextFPayload(html: string): string {
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let combined = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      combined += JSON.parse(m[1]) as string;
    } catch {
      // 分割・中断された断片は無視（他の断片から抽出できれば十分）
    }
  }
  return combined;
}

/** text[startIdx] が '{' である前提で、対応する '}' までの部分文字列を返す（文字列リテラル内は無視）。 */
function findBalancedObject(text: string, startIdx: number): string | undefined {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  return undefined;
}

/** leaderboard ページの HTML から、大会名・開催日・種目/地点一覧を抽出する。 */
export function parseRaceMeta(html: string, raceId: string): RunnetRaceMeta {
  const $ = cheerio.load(html);
  const raceName = $('h1').first().text().trim() || undefined;
  const dateMatch = $('body')
    .text()
    .match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  const raceDate = dateMatch
    ? `${dateMatch[1]}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[3]).padStart(2, '0')}`
    : undefined;

  const payload = extractNextFPayload(html);
  const marker = `{"raceId":"${raceId}","categories":[`;
  const objStart = payload.indexOf(marker);

  let categories: RunnetCategoryMeta[] = [];
  let generalCategories: RunnetCategoryMeta[] = [];
  if (objStart >= 0) {
    const jsonText = findBalancedObject(payload, objStart);
    if (jsonText) {
      try {
        const obj = JSON.parse(jsonText) as {
          categories?: RunnetCategoryMeta[];
          generalCategories?: RunnetCategoryMeta[];
        };
        categories = obj.categories ?? [];
        generalCategories = obj.generalCategories ?? [];
      } catch {
        // JSON として壊れていた場合は空のまま（呼び出し側でエラーにする）
      }
    }
  }

  return { raceId, raceName, raceDate, generalCategories, categories };
}

/** 大会の種目・地点メタデータを取得する。 */
export async function fetchRaceMeta(
  raceId: string,
  opts: RunnetFetchOptions = {},
): Promise<RunnetRaceMeta> {
  const fetcher = opts.fetchFn ?? fetchHtml;
  const html = await fetcher(`${RESULT_ONE_BASE}/races/${raceId}/leaderboard`, opts);
  const meta = parseRaceMeta(html, raceId);
  if (meta.generalCategories.length === 0 && meta.categories.length === 0) {
    throw new Error(
      `raceId=${raceId} の種目・地点メタデータを取得できませんでした。` +
        'RUNNET 側のページ構造が変更された可能性があります。',
    );
  }
  return meta;
}

/** 種目 × 1 地点ぶんの選手記録を、ページングしながら重複なく全件取得する。 */
export async function fetchLocationAthletes(
  raceId: string,
  category: { kind: 'general' | 'category'; id: string },
  locationId: number,
  opts: RunnetFetchOptions = {},
): Promise<RunnetAthlete[]> {
  const fetcher = opts.fetchFn ?? fetchHtml;
  const pageSize = opts.pageSize ?? 100;
  const segment = category.kind === 'general' ? 'general-categories' : 'categories';

  const byKey = new Map<string, RunnetAthlete>();
  for (let page = 0; ; page++) {
    const url =
      `${RESULT_ONE_BASE}/api/races/${raceId}/${segment}/${category.id}` +
      `?page=${page}&num=${pageSize}&isFixed=false&location=${locationId}`;
    const text = await fetcher(url, opts);
    let data: { athletes?: RunnetAthlete[] } | null;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`location=${locationId} の応答を JSON として解析できませんでした: ${url}`);
    }
    const athletes = data?.athletes ?? [];
    if (athletes.length === 0) break;
    for (const a of athletes) {
      const key = a.runnerId ?? a.bibNo;
      if (key != null) byKey.set(String(key), a);
    }
  }
  return [...byKey.values()];
}

/** RunnetAthlete[] を CheckpointSplit[] に変換する。 */
export function athletesToSplits(athletes: RunnetAthlete[]): CheckpointSplit[] {
  return athletes.map((a) => ({
    bib: a.bibNo,
    name: a.name,
    grossSeconds: parseTimeToSeconds(a.grossTime),
    netSeconds: parseTimeToSeconds(a.netTime),
    raw: {
      'Bib.': a.bibNo,
      氏名: a.name ?? '',
      チーム: a.teamName ?? '',
      グロスタイム: a.grossTime ?? '',
      ネットタイム: a.netTime ?? '',
    },
  }));
}
