/** 最小限のロガー。--quiet で抑制できるよう関数経由にする。 */

let quiet = false;

export function setQuiet(v: boolean): void {
  quiet = v;
}

export function info(...args: unknown[]): void {
  if (!quiet) console.error('[info]', ...args);
}

export function warn(...args: unknown[]): void {
  console.error('[warn]', ...args);
}

export function error(...args: unknown[]): void {
  console.error('[error]', ...args);
}
