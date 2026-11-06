import type { GradeResult } from "../grading/grade.js";
import { CATEGORIES, type Category } from "../quiz/types.js";

/** 全利用者の匿名集計。アカウント無しで「みんなの苦手傾向」を出すために使う。 */
export type GlobalStats = {
  count: number;
  averages: Record<Category, number | null>;
};

export interface StatsStore {
  record(result: GradeResult): Promise<void>;
  get(): Promise<GlobalStats>;
}

type Totals = { count: number; sum: Record<Category, number>; n: Record<Category, number> };

const zeroByCategory = () => Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;

export function toAverages(t: Totals): GlobalStats {
  const averages = {} as Record<Category, number | null>;
  for (const c of CATEGORIES) averages[c] = t.n[c] > 0 ? Math.round(t.sum[c] / t.n[c]) : null;
  return { count: t.count, averages };
}

export class MemoryStatsStore implements StatsStore {
  private totals: Totals = { count: 0, sum: zeroByCategory(), n: zeroByCategory() };

  async record(result: GradeResult): Promise<void> {
    this.totals.count++;
    for (const c of CATEGORIES) {
      const v = result.categories[c];
      if (v === null) continue;
      this.totals.sum[c] += v;
      this.totals.n[c]++;
    }
  }

  async get(): Promise<GlobalStats> {
    return toAverages(this.totals);
  }
}
