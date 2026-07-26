/** タイム文字列・数値変換のユーティリティ。 */

/**
 * "H:MM:SS" / "MM:SS" / "H時間MM分SS秒" / "1'23\"45" 等のタイム表記を秒に変換する。
 * 変換できない場合は undefined。
 */
export function parseTimeToSeconds(input: string | undefined | null): number | undefined {
  if (input == null) return undefined;
  let s = String(input).trim();
  if (!s) return undefined;

  // よくある「記録なし」系を除外
  if (/^(-+|—+|＿+|記録なし|失格|棄権|DNF|DNS|DQ|N\/?A)$/i.test(s)) return undefined;

  // 全角数字・コロンを半角へ
  s = s.replace(/[０-９]/g, (d) => String('０１２３４５６７８９'.indexOf(d)));
  s = s.replace(/[：]/g, ':').replace(/[．]/g, '.');

  // 日本語表記 "1時間23分45秒" / "23分45秒" / "45秒"
  const jp = s.match(/(?:(\d+)\s*時間)?\s*(?:(\d+)\s*分)?\s*(?:(\d+(?:\.\d+)?)\s*秒)?/);
  if (jp && (jp[1] || jp[2] || jp[3]) && /時間|分|秒/.test(s)) {
    const h = Number(jp[1] ?? 0);
    const m = Number(jp[2] ?? 0);
    const sec = Number(jp[3] ?? 0);
    return h * 3600 + m * 60 + sec;
  }

  // "1'23\"45"（分'秒"1/100）形式
  const tick = s.match(/^(\d+)'\s*(\d+)(?:"\s*(\d+))?$/);
  if (tick) {
    const m = Number(tick[1]);
    const sec = Number(tick[2]);
    const frac = tick[3] ? Number(`0.${tick[3]}`) : 0;
    return m * 60 + sec + frac;
  }

  // "H:MM:SS(.xx)" / "MM:SS(.xx)"
  const colon = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:\.(\d{1,3}))?$/);
  if (colon) {
    const a = Number(colon[1]);
    const b = Number(colon[2]);
    const c = colon[3] != null ? Number(colon[3]) : undefined;
    const frac = colon[4] != null ? Number(`0.${colon[4]}`) : 0;
    if (c != null) {
      // H:MM:SS
      return a * 3600 + b * 60 + c + frac;
    }
    // MM:SS
    return a * 60 + b + frac;
  }

  return undefined;
}

/** 秒を "H:MM:SS" に整形（1 時間未満は "MM:SS"）。 */
export function formatSeconds(total: number | undefined): string {
  if (total == null || !isFinite(total)) return '-';
  const t = Math.round(total);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** ペース秒/km を "M'SS\"/km" に整形。 */
export function formatPace(secPerKm: number | undefined): string {
  if (secPerKm == null || !isFinite(secPerKm)) return '-';
  const t = Math.round(secPerKm);
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}'${String(s).padStart(2, '0')}"/km`;
}

/** 数値の全角→半角、カンマ除去を行い Number 化。失敗時 undefined。 */
export function parseNumber(input: string | undefined | null): number | undefined {
  if (input == null) return undefined;
  let s = String(input).trim();
  if (!s) return undefined;
  s = s.replace(/[０-９]/g, (d) => String('０１２３４５６７８９'.indexOf(d)));
  s = s.replace(/[,，、]/g, '');
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return undefined;
  const n = Number(m[0]);
  return isFinite(n) ? n : undefined;
}
