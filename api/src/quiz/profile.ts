import { LIMITS, type Limits, type RepoSize } from "../github/filter.js";

/** クイズの大きさ。大きいほど Gemini の呼び出しに時間がかかる。 */
export type Profile = {
  name: "tiny" | "mini" | "standard" | "full";
  /** 選択式の問題数。5 の倍数だと各カテゴリに均等に割り振れる。 */
  choice: number;
  free: number;
  /** 何回の Gemini 呼び出しに分けて並列に作るか。 */
  chunks: number;
  /** AI に渡すコードの上限。 */
  limits: Limits;
};

const MINI_LIMITS: Limits = { maxFiles: 8, maxFileBytes: 100_000, maxCharsPerFile: 3_000, maxTotalChars: 20_000 };

export const PROFILES: Record<Profile["name"], Profile> = {
  tiny: { name: "tiny", choice: 3, free: 1, chunks: 1, limits: MINI_LIMITS },
  mini: { name: "mini", choice: 5, free: 1, chunks: 1, limits: MINI_LIMITS },
  standard: {
    name: "standard",
    choice: 10,
    free: 2,
    chunks: 2,
    limits: { maxFiles: 16, maxFileBytes: 100_000, maxCharsPerFile: 5_000, maxTotalChars: 40_000 },
  },
  full: { name: "full", choice: 15, free: 3, chunks: 3, limits: LIMITS },
};

/** これ未満の規模なら、その問題数にする。これ以上は上限の full。実際のリポジトリの大きさを見て決めた値。 */
export const TINY_MAX_BYTES = 5 * 1024;
export const MINI_MAX_BYTES = 60 * 1024;
export const STANDARD_MAX_BYTES = 400 * 1024;

/** リポジトリの規模に合った問題数を選ぶ。最大は full の 18 問。 */
export function profileForSize(size: RepoSize): Profile {
  if (size.bytes < TINY_MAX_BYTES) return PROFILES.tiny;
  if (size.bytes < MINI_MAX_BYTES) return PROFILES.mini;
  if (size.bytes < STANDARD_MAX_BYTES) return PROFILES.standard;
  return PROFILES.full;
}

/** QUIZ_PROFILE で問題数を固定する。未指定・不明な値なら undefined(規模で決める)。 */
export function fixedProfileFromEnv(value = process.env.QUIZ_PROFILE): Profile | undefined {
  const name = value?.toLowerCase();
  return name === "mini" || name === "standard" || name === "full" ? PROFILES[name] : undefined;
}

/** QUIZ_PROFILE=mini|standard|full。未指定・不明な値は standard。 */
export function profileFromEnv(value = process.env.QUIZ_PROFILE): Profile {
  const name = value?.toLowerCase();
  return name === "mini" ? PROFILES.mini : name === "full" ? PROFILES.full : PROFILES.standard;
}
