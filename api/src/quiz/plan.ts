import { CATEGORIES, QUIZ_SHAPE, type Category } from "./types.js";

/** 1 回の Gemini 呼び出しで作る問題の内訳。 */
export type ChunkSpec = {
  /** 選択式の category(この順に 1 問ずつ)。 */
  choice: Category[];
  /** 記述式の category。 */
  free: Category[];
};

/** 18 問を分割する数。出力が短くなるので応答が速くなる。 */
export const CHUNKS = 3;

const DEFAULT_FREE: Category[] = ["design", "quality", "overall"];

/** 選択式 15 問のカテゴリ配分。通常は各 3 問。重点カテゴリがあれば、そこを 1 問ずつ増やす。 */
export function choiceCounts(focus: Category[]): Record<Category, number> {
  const per = QUIZ_SHAPE.choice / CATEGORIES.length;
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, per])) as Record<Category, number>;
  for (const f of [...new Set(focus)].slice(0, 2)) {
    const donor = CATEGORIES.filter((c) => !focus.includes(c)).sort((a, b) => counts[b] - counts[a])[0];
    if (!donor || counts[donor] <= 1) continue;
    counts[donor]--;
    counts[f]++;
  }
  return counts;
}

export function planChunks(focus: Category[] = []): ChunkSpec[] {
  const counts = choiceCounts(focus);

  // 同じカテゴリが 1 つのチャンクに偏らないよう、カテゴリを巡回させて並べてから配る
  const ordered: Category[] = [];
  while (ordered.length < QUIZ_SHAPE.choice) {
    for (const c of CATEGORIES) {
      if (counts[c] > 0) {
        ordered.push(c);
        counts[c]--;
      }
    }
  }

  const freeCats = [...new Set([...focus, ...DEFAULT_FREE])].slice(0, QUIZ_SHAPE.free);
  const chunks: ChunkSpec[] = Array.from({ length: CHUNKS }, () => ({ choice: [], free: [] }));
  ordered.forEach((c, i) => chunks[i % CHUNKS].choice.push(c));
  freeCats.forEach((c, i) => chunks[i % CHUNKS].free.push(c));
  return chunks;
}

/** チャンクごとに「主に根拠にするファイル」を割り振り、問題の重複を減らす。 */
export function primaryFiles(paths: string[], chunkIndex: number): string[] {
  return paths.filter((_, i) => i % CHUNKS === chunkIndex);
}
