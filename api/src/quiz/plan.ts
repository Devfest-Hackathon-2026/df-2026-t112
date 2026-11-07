import { profileFromEnv, type Profile } from "./profile.js";
import { CATEGORIES, type Category } from "./types.js";

/** 1 回の Gemini 呼び出しで作る問題の内訳。 */
export type ChunkSpec = {
  /** 選択式の category(この順に 1 問ずつ)。 */
  choice: Category[];
  /** 記述式の category。 */
  free: Category[];
};

const DEFAULT_FREE: Category[] = ["design", "quality", "overall"];

/** 選択式のカテゴリ配分。通常は均等(余りは先頭のカテゴリから)。重点カテゴリがあれば、そこを 1 問ずつ増やす。 */
export function choiceCounts(total: number, focus: Category[]): Record<Category, number> {
  const base = Math.floor(total / CATEGORIES.length);
  const counts = Object.fromEntries(
    CATEGORIES.map((c, i) => [c, base + (i < total % CATEGORIES.length ? 1 : 0)]),
  ) as Record<Category, number>;
  for (const f of [...new Set(focus)].slice(0, 2)) {
    const donor = CATEGORIES.filter((c) => !focus.includes(c)).sort((a, b) => counts[b] - counts[a])[0];
    if (!donor || counts[donor] <= 1) continue;
    counts[donor]--;
    counts[f]++;
  }
  return counts;
}

export function planChunks(focus: Category[] = [], profile: Profile = profileFromEnv()): ChunkSpec[] {
  const counts = choiceCounts(profile.choice, focus);

  // 同じカテゴリが 1 つのチャンクに偏らないよう、カテゴリを巡回させて並べてから配る
  const ordered: Category[] = [];
  while (ordered.length < profile.choice) {
    for (const c of CATEGORIES) {
      if (counts[c] > 0 && ordered.length < profile.choice) {
        ordered.push(c);
        counts[c]--;
      }
    }
  }

  const freeCats = [...new Set([...focus, ...DEFAULT_FREE])].slice(0, profile.free);
  const chunks: ChunkSpec[] = Array.from({ length: profile.chunks }, () => ({ choice: [], free: [] }));
  ordered.forEach((c, i) => chunks[i % profile.chunks].choice.push(c));
  freeCats.forEach((c, i) => chunks[i % profile.chunks].free.push(c));
  return chunks;
}

/** チャンクごとに「主に根拠にするファイル」を割り振り、問題の重複を減らす。 */
export function primaryFiles(paths: string[], chunkIndex: number, chunks: number): string[] {
  return chunks <= 1 ? [] : paths.filter((_, i) => i % chunks === chunkIndex);
}
