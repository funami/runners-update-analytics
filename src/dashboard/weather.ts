/** スタート/ゴール地点の気象観測値を表示用に整形する。 */

import type { WeatherObservation } from '../types.js';

function fmtTemp(tempC: number): string {
  return tempC.toFixed(1);
}

function tempSeries(w: WeatherObservation): string[] {
  const temps = (w.extraTemps ?? []).map((t) => `${t.time} ${fmtTemp(t.tempC)}℃`);
  if (w.tempC != null) temps.push(`${w.time} ${fmtTemp(w.tempC)}℃`);
  return temps;
}

/** 観測値をすべて並べた詳細表示（ダッシュボードヘッダー用）。気温は時刻昇順で並べる。 */
export function weatherDetail(w: WeatherObservation): string {
  const parts: string[] = [];
  const temps = tempSeries(w);
  if (temps.length) parts.push(temps.join(' → '));
  if (w.humidityPct != null) parts.push(`湿度${w.humidityPct}%`);
  if (w.condition) parts.push(w.condition);
  const wind = [w.windDir, w.windSpeedMs != null ? `${w.windSpeedMs}m/s` : ''].filter(Boolean).join(' ');
  if (wind) parts.push(wind);
  if (w.pressureHpa != null) parts.push(`${w.pressureHpa}hPa`);
  return parts.join(' ・ ');
}

/** 気温・天気だけの簡易表示（目次カード用）。 */
export function weatherCompact(w: WeatherObservation): string {
  const parts: string[] = [];
  const values = (w.extraTemps ?? []).map((t) => fmtTemp(t.tempC));
  if (w.tempC != null) values.push(`${fmtTemp(w.tempC)}℃`);
  if (values.length) parts.push(values.join('→'));
  if (w.condition) parts.push(w.condition);
  return parts.join(' ');
}
