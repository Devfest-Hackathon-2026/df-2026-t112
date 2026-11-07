import { LIMITS, type Limits } from "../github/filter.js";

/** クイズの大きさ。大きいほど Gemini の呼び出しに時間がかかる。 */
export type Profile = {
  name: "mini" | "full";
  /** 選択式の問題数。5 の倍数だと各カテゴリに均等に割り振れる。 */
  choice: number;
  free: number;
  /** 何回の Gemini 呼び出しに分けて並列に作るか。 */
  chunks: number;
  /** AI に渡すコードの上限。 */
  limits: Limits;
};

export const PROFILES: Record<Profile["name"], Profile> = {
  mini: {
    name: "mini",
    choice: 5,
    free: 1,
    chunks: 1,
    limits: { maxFiles: 8, maxFileBytes: 100_000, maxCharsPerFile: 3_000, maxTotalChars: 20_000 },
  },
  full: { name: "full", choice: 15, free: 3, chunks: 3, limits: LIMITS },
};

/** QUIZ_PROFILE=full で通常サイズ(18 問)。未指定・不明な値は mini。 */
export function profileFromEnv(value = process.env.QUIZ_PROFILE): Profile {
  return value?.toLowerCase() === "full" ? PROFILES.full : PROFILES.mini;
}
