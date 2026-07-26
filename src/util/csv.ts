/** 依存の無い最小 CSV パーサ / ジェネレータ（RFC4180 準拠のダブルクオート対応）。 */

/** CSV 文字列を行×セルの二次元配列に。 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  // 最終フィールド
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function escapeCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** 行配列を CSV 文字列に（先頭に BOM 付与で Excel の日本語文字化けを防止）。 */
export function toCsv(rows: (string | number | null | undefined)[][], bom = true): string {
  const body = rows.map((r) => r.map(escapeCell).join(',')).join('\n');
  return (bom ? '﻿' : '') + body + '\n';
}
