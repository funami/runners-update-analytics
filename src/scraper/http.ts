/**
 * 行儀の良い HTTP 取得。
 *
 * - User-Agent を明示
 * - リクエスト間に最低待機時間（既定 1.5s）を挟む（サーバ負荷への配慮）
 * - 失敗時は指数バックオフでリトライ
 *
 * 注意: 実行環境のネットワークポリシーによっては runnet.jp への接続が
 * 遮断される（HTTP 403 / CONNECT 拒否）。その場合はブラウザで保存した
 * HTML を `--html <file>` で読み込むオフラインモードを使うこと。
 */

import { info, warn } from '../util/logger.js';

export interface FetchOptions {
  /** リクエスト間の最低待機(ms)。 */
  minDelayMs?: number;
  /** リトライ回数。 */
  retries?: number;
  /** User-Agent。 */
  userAgent?: string;
  /** タイムアウト(ms)。 */
  timeoutMs?: number;
}

const DEFAULTS: Required<FetchOptions> = {
  minDelayMs: 1500,
  retries: 3,
  userAgent:
    'runners-update-analytics/0.1 (+https://github.com/; research/personal use; contact via repo)',
  timeoutMs: 20000,
};

let lastRequestAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 直前リクエストからの待機を保証する。 */
async function throttle(minDelayMs: number): Promise<void> {
  const now = Date.now();
  const wait = lastRequestAt + minDelayMs - now;
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

/** 1 URL を取得して HTML 文字列を返す。 */
export async function fetchHtml(url: string, opts: FetchOptions = {}): Promise<string> {
  const o = { ...DEFAULTS, ...opts };
  let lastErr: unknown;

  for (let attempt = 0; attempt <= o.retries; attempt++) {
    if (attempt > 0) {
      const backoff = o.minDelayMs * Math.pow(2, attempt);
      warn(`retry ${attempt}/${o.retries} after ${backoff}ms: ${url}`);
      await sleep(backoff);
    }
    await throttle(o.minDelayMs);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), o.timeoutMs);
    try {
      info(`GET ${url}`);
      const res = await fetch(url, {
        headers: {
          'User-Agent': o.userAgent,
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'ja,en;q=0.8',
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        // 403/407 は多くの場合ポリシー/ブロック起因。リトライしても無駄なことが多い。
        if (res.status === 403 || res.status === 407) {
          throw new Error(
            `HTTP ${res.status} for ${url} — アクセスが拒否されました。` +
              `ネットワークポリシーまたはサイト側のBotブロックの可能性があります。` +
              `ブラウザで保存したHTMLを --html で読み込むオフラインモードを検討してください。`,
          );
        }
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (err instanceof Error && /403|407|拒否/.test(err.message)) {
        // 権限系はリトライしても解決しないので即時 throw
        throw err;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
