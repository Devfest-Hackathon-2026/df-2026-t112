import { CATEGORIES, type Category } from "../quiz/types.js";
import type { GradeResult } from "./grade.js";

export type Weakness = {
  sessions: number;
  averages: Record<Category, number | null>;
  /** 苦手なカテゴリ。得点が低い順に最大 2 つ。 */
  weakest: Category[];
};

export const WEAK_THRESHOLD = 70;
const MAX_WEAKEST = 2;

/** 複数回の結果から、カテゴリ別の平均と苦手カテゴリを求める。 */
export function analyzeWeakness(results: Pick<GradeResult, "categories">[]): Weakness {
  const averages = {} as Record<Category, number | null>;
  for (const c of CATEGORIES) {
    const values = results.map((r) => r.categories[c]).filter((v): v is number => v !== null);
    averages[c] = values.length === 0 ? null : Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  }
  const weakest = CATEGORIES.filter((c): c is Category => averages[c] !== null && averages[c]! < WEAK_THRESHOLD)
    .sort((a, b) => averages[a]! - averages[b]!)
    .slice(0, MAX_WEAKEST);
  return { sessions: results.length, averages, weakest };
}
