/**
 * ドメインモデル定義。
 *
 * 対象: RUNNET「ランナーズアップデート」大会結果、特に
 *   富士登山競走のように「地点（関門）× 種目」ごとに通過記録が公開されるレース。
 *
 * データの流れ:
 *   1) (地点 × 種目) ごとの結果ページ HTML を parseCheckpointHtml で
 *      CheckpointSplit[] に正規化する。
 *   2) 複数地点を Bib で突き合わせ、RunnerSplits[]（選手ごとの各地点通過記録）を作る。
 *   3) 地点ごとに「通過時間帯(既定1分刻み)の通過者数」と「そのうち完走した人数」を
 *      集計し、通過時刻ごとの完走率を算出する（RaceAnalysis）。
 */

/** 1 地点の結果テーブルにおける 1 行（1 選手の通過記録）。 */
export interface CheckpointSplit {
  /** ゼッケン / ナンバーカード番号（選手の突き合わせキー）。 */
  bib?: string;
  /** 氏名（掲載されている場合）。 */
  name?: string;
  /** ネットタイム（スタートライン通過起点）秒。空欄のことも多い。 */
  netSeconds?: number;
  /** グロスタイム（号砲起点の経過時間）秒。この分析の主役。 */
  grossSeconds?: number;
  /** 正規化できなかった元の列（ヘッダー -> 値）。 */
  raw: Record<string, string>;
}

/** 1 地点ぶんの結果テーブル。 */
export interface CheckpointTable {
  /** 地点名（例: "馬返し", "五合目", "八合目", "Finish"）。 */
  checkpoint: string;
  /** コース上の順序（小さいほどスタート寄り）。 */
  order: number;
  /** この地点がゴール（山頂）か。 */
  goal: boolean;
  /** 種目名（例: "山頂の部" / "山頂総合"）。 */
  kind?: string;
  /** 正規化済みの通過記録。 */
  splits: CheckpointSplit[];
  /** 取得元 URL / ファイル。 */
  source?: string;
  /**
   * この地点の制限時間（グロス秒）。ゴール地点に設定した場合、これを超えたグロスタイムは
   * 「完走」に数えない（`RaceManifest.checkpointCutoffs` から解決される）。
   */
  cutoffSeconds?: number;
  /** パーサからの注意。 */
  notes: string[];
}

/** マニフェスト内の 1 地点エントリ。html か url のどちらかを指定する。 */
export interface ManifestCheckpoint {
  /** 地点名。 */
  name: string;
  /** コース順（省略時は配列順）。 */
  order?: number;
  /** ゴール（山頂）地点なら true。省略時は最後の地点をゴールとみなす。 */
  goal?: boolean;
  /** 保存済み HTML ファイルパス（オフライン取得）。 */
  html?: string;
  /** CSV ファイルパス（列: bib,name,net,gross のいずれかを含む）。 */
  csv?: string;
  /** ライブ取得する URL（ネットワーク許可環境）。 */
  url?: string;
}

/**
 * RUNNET 新プラットフォーム（result.one.runnet.jp）の JSON API から
 * 地点一覧・選手記録を自動取得する場合の指定。指定時は checkpoints を省略できる。
 * 種目(categoryId)・地点(locationId)は `rua runnet-categories <raceId>` で確認する。
 */
export interface RunnetApiSource {
  /** 総合種目("general") か 個別種目("category") か。既定 "general"。 */
  categoryKind?: 'general' | 'category';
  /** 種目 ID。 */
  categoryId: string;
  /** 1 ページあたりの取得件数（既定 100）。大きすぎるとサーバ側で 500 になることがある。 */
  pageSize?: number;
  /** 速報(false)/確報(true)。既定 "auto"（速報を試し、0件なら確報にフォールバック）。 */
  isFixed?: 'auto' | boolean;
}

/** ある地点・時刻の気象観測値（気象庁 過去の気象データ検索より）。 */
export interface WeatherObservation {
  /** 観測地点名（例: "河口湖", "富士山"）。 */
  station: string;
  /** 観測時刻 "HH:MM"。 */
  time: string;
  /** 気温(℃)。 */
  tempC?: number;
  /** 湿度(%)。 */
  humidityPct?: number;
  /** 天気（例: "晴れ", "曇"）。無人観測地点では欠測のことがある。 */
  condition?: string;
  /** 風向（例: "北北西"）。無人観測地点では欠測のことがある。 */
  windDir?: string;
  /** 風速(m/s)。 */
  windSpeedMs?: number;
  /** 現地気圧(hPa)。 */
  pressureHpa?: number;
  /** 主観測時刻より前の時間帯の気温推移（例: 選手がゴールし始める時間帯）。時刻の昇順。 */
  extraTemps?: { time: string; tempC: number }[];
  /** 元データ（気象庁 過去の気象データ検索）のページ URL。 */
  sourceUrl?: string;
}

/** レースのスタート/ゴール地点の気象記録（気象庁データより手動転記）。 */
export interface RaceWeather {
  /** スタート地点（号砲時刻）の観測。 */
  start?: WeatherObservation;
  /** ゴール地点（関門閉鎖時刻等）の観測。 */
  finish?: WeatherObservation;
}

/** レース 1 種目ぶんの取得定義。 */
export interface RaceManifest {
  /** RUNNET raceId。 */
  raceId?: string;
  /** 大会名。 */
  raceName?: string;
  /**
   * 大会名に添える短い注記（例: "荒天のため五合目関門で打ち切り"）。
   * ダッシュボード/目次ページの両方でバッジ表示される。
   */
  note?: string;
  /** 開催日 (YYYY-MM-DD)。 */
  raceDate?: string;
  /** 種目名（例: "山頂の部"）。 */
  kind?: string;
  /** 号砲（スタート）時刻 "HH:MM" or "HH:MM:SS"。通過時刻(clock)算出に使用。 */
  startTime?: string;
  /** 地点一覧（コース順）。runnetApi 指定時は省略可（自動取得）。 */
  checkpoints?: ManifestCheckpoint[];
  /** 指定時は checkpoints の代わりに RUNNET 新 API から自動取得する（要 --live）。 */
  runnetApi?: RunnetApiSource;
  /**
   * 地点名 -> 制限時間（"H:MM:SS" 等、`parseTimeToSeconds` で解釈）。
   * ゴール地点に指定すると、それを超えるグロスタイムは「完走」に数えない
   * （例: 富士登山競走 山頂コースの制限時間 4:30:00）。
   * ゴール以外の地点（中間関門）に指定しても現状は集計に影響しない。
   */
  checkpointCutoffs?: Record<string, string>;
  /**
   * runnetApi 取得時、API 上の地点名 -> 表示名の上書き。
   * 例: 悪天候等でコースが短縮され、API 上は "Finish" でも実態は
   * 「五合目打ち切り」だった大会で `{ "Finish": "五合目" }` のように使う。
   * `checkpointCutoffs` は上書き後の名前で指定すること。
   */
  locationNames?: Record<string, string>;
  /**
   * runnetApi 取得時、地点の並び順を明示的に上書きする（表示名・上書き後の名前で指定）。
   * API が返す地点配列の順序がコース順と一致しない大会向け。最後の要素をゴールとみなす
   * （API の `isFinish` や配列末尾判定より優先される）。
   */
  locationOrder?: string[];
  /** スタート/ゴール地点の気象記録（任意）。 */
  weather?: RaceWeather;
}

/** 選手ごとの各地点通過記録（Bib で突き合わせ済み）。 */
export interface RunnerSplits {
  bib: string;
  name?: string;
  /** 地点名 -> グロス秒（経過時間）。通過した地点のみ。 */
  grossByCheckpoint: Record<string, number>;
  /** 地点名 -> ネット秒（あれば）。 */
  netByCheckpoint: Record<string, number>;
  /** ゴール（山頂）に到達したか。 */
  finished: boolean;
  /** ゴールのグロス秒（完走者のみ）。 */
  finishGrossSeconds?: number;
  /** 最終到達地点名。 */
  lastCheckpoint?: string;
}

/** 正規化済みデータセット（ingest の成果物）。 */
export interface SplitsDataset {
  raceId?: string;
  raceName?: string;
  /** 大会名に添える短い注記（例: "荒天のため五合目関門で打ち切り"）。 */
  note?: string;
  raceDate?: string;
  kind?: string;
  startTime?: string;
  fetchedAt: string;
  /** コース順の地点定義。 */
  checkpoints: { name: string; order: number; goal: boolean }[];
  /** 地点ごとの生テーブル（監査用）。 */
  tables: CheckpointTable[];
  /** Bib で突き合わせた選手別記録。 */
  runners: RunnerSplits[];
  notes: string[];
  /** スタート/ゴール地点の気象記録（任意）。 */
  weather?: RaceWeather;
}

/** 通過時間帯(1分刻み等) 1 ビンの集計。 */
export interface PassBin {
  /** ビン下限のグロス秒（含む）。 */
  startSec: number;
  /** ビン上限のグロス秒（含まない）。 */
  endSec: number;
  /** 経過時間表示ラベル（例 "1:23"）。 */
  elapsedLabel: string;
  /** 通過時刻(clock)ラベル（startTime 指定時のみ、例 "08:23"）。 */
  clockLabel?: string;
  /** この時間帯にこの地点を通過した人数。 */
  passers: number;
  /** そのうち最終的に完走（山頂到達）した人数。 */
  finishers: number;
  /** 完走率 (finishers / passers)。passers=0 の場合 null。 */
  finishRate: number | null;
}

/** 1 地点ぶんの「通過時刻 × 完走率」分析。 */
export interface CheckpointFinishAnalysis {
  checkpoint: string;
  order: number;
  goal: boolean;
  /** この地点の通過者総数。 */
  totalPassers: number;
  /** うち完走者数。 */
  totalFinishers: number;
  /** 通過者全体の完走率。 */
  overallFinishRate: number | null;
  /** 1分刻み等のビン列（時間昇順）。 */
  bins: PassBin[];
  /**
   * 完走率が 50% を下回り始める最初のビン（実質的な関門の目安）。
   * 見つからなければ null。
   */
  finishRate50CutoffSec: number | null;
}

/** レース全体の分析結果（ダッシュボード入力）。 */
export interface RaceAnalysis {
  raceId?: string;
  raceName?: string;
  /** 大会名に添える短い注記（例: "荒天のため五合目関門で打ち切り"）。 */
  note?: string;
  raceDate?: string;
  kind?: string;
  startTime?: string;
  fetchedAt: string;
  binMinutes: number;
  /** 総エントリー（いずれかの地点を通過した選手数）。 */
  totalRunners: number;
  /** 完走者数。 */
  finishers: number;
  /** 全体完走率。 */
  finishRate: number | null;
  /** 地点ごとの分析（コース順、ゴールは末尾）。 */
  checkpoints: CheckpointFinishAnalysis[];
  notes: string[];
  /** スタート/ゴール地点の気象記録（任意）。 */
  weather?: RaceWeather;
}
