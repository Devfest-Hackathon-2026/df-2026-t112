import { useEffect, useState } from "react";
import { getStats, getWeakness } from "../api";
import { useAuth } from "../auth";
import { CATEGORIES, CATEGORY_LABELS, weakestOf, type Category, type GlobalStats, type Weakness } from "../types";

type Props = {
  categories: Record<Category, number | null>;
  onRetry: (focus: Category[]) => void;
};

const show = (v: number | null | undefined) => (v === null || v === undefined ? "-" : String(v));

export function WeaknessPanel({ categories, onRetry }: Props) {
  const { user } = useAuth();
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [history, setHistory] = useState<Weakness | null>(null);
  const weakest = weakestOf(categories);

  // 比較用の補助情報なので、取得に失敗しても結果表示は妨げない
  useEffect(() => {
    getStats().then(setStats).catch(() => setStats(null));
  }, []);
  useEffect(() => {
    if (!user) return setHistory(null);
    getWeakness().then(setHistory).catch(() => setHistory(null));
  }, [user]);

  return (
    <section className="card">
      <h2>苦手分析</h2>
      {weakest.length > 0 ? (
        <p>
          今回は <strong>{weakest.map((c) => CATEGORY_LABELS[c]).join("、")}</strong> が弱めでした。
        </p>
      ) : (
        <p>今回は苦手と言えるカテゴリはありませんでした。</p>
      )}

      <table className="compare">
        <thead>
          <tr>
            <th>カテゴリ</th>
            <th>今回</th>
            {history && history.sessions > 1 && <th>自分の平均({history.sessions}回)</th>}
            {stats && stats.count > 0 && <th>みんなの平均({stats.count}件)</th>}
          </tr>
        </thead>
        <tbody>
          {CATEGORIES.map((c) => (
            <tr key={c} className={weakest.includes(c) ? "weak" : undefined}>
              <td>{CATEGORY_LABELS[c]}</td>
              <td>{show(categories[c])}</td>
              {history && history.sessions > 1 && <td>{show(history.averages[c])}</td>}
              {stats && stats.count > 0 && <td>{show(stats.averages[c])}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {weakest.length > 0 && (
        <button onClick={() => onRetry(weakest)}>苦手を重点的に、同じリポジトリで再挑戦</button>
      )}
    </section>
  );
}
