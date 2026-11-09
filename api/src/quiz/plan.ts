import { profileFromEnv, type Profile } from "./profile.js";
import { CATEGORIES, type Category } from "./types.js";

/** 1 回の Gemini 呼び出しで作る問題の内訳。 */
export type ChunkSpec = {
  /** 選択式の category(この順に 1 問ずつ)。 */
  choice: Category[];
  /** 記述式の category。 */
  free: Category[];
};

/** 選択式のカテゴリ配分。均等にして、余りは先頭のカテゴリから割り当てる。 */
export function choiceCounts(total: number): Record<Category, number> {
  const base = Math.floor(total / CATEGORIES.length);
  return Object.fromEntries(
    CATEGORIES.map((c, i) => [c, base + (i < total % CATEGORIES.length ? 1 : 0)]),
  ) as Record<Category, number>;
}

/** freeOffset は記述式を割り当て始めるカテゴリの位置。テストで固定するときだけ指定する。 */
export function planChunks(
  profile: Profile = profileFromEnv(),
  freeOffset: number = Math.floor(Math.random() * CATEGORIES.length),
): ChunkSpec[] {
  const counts = choiceCounts(profile.choice);

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

  // 記述式は点が下がりやすいので、特定のカテゴリに偏らないよう巡回して割り当てる
  const freeCats = Array.from({ length: profile.free }, (_, i) => CATEGORIES[(freeOffset + i) % CATEGORIES.length]);
  const chunks: ChunkSpec[] = Array.from({ length: profile.chunks }, () => ({ choice: [], free: [] }));
  ordered.forEach((c, i) => chunks[i % profile.chunks].choice.push(c));
  freeCats.forEach((c, i) => chunks[i % profile.chunks].free.push(c));
  return chunks;
}

/** チャンクごとに「主に根拠にするファイル」を割り振り、問題の重複を減らす。 */
export function primaryFiles(paths: string[], chunkIndex: number, chunks: number): string[] {
  return chunks <= 1 ? [] : paths.filter((_, i) => i % chunks === chunkIndex);
}
