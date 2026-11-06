import { CATEGORY_LABELS, type Category, type GradeResult, type QuizSession } from "../types";
import { RadarChart } from "./RadarChart";
import { WeaknessPanel } from "./WeaknessPanel";

type Props = {
  session: QuizSession;
  result: GradeResult;
  onRestart: () => void;
  onRetry: (focus: Category[]) => void;
};

function level(score: number): string {
  if (score >= 80) return "よく理解できています";
  if (score >= 60) return "おおむね理解できています";
  if (score >= 40) return "理解にムラがあります";
  return "もう一度コードを読み直しましょう";
}

export function ResultView({ session, result, onRestart, onRetry }: Props) {
  const qById = new Map(session.questions.map((q, i) => [q.id, { q, no: i + 1 }]));

  return (
    <div className="result">
      <section className="card center">
        <p className="muted">
          {session.repo.owner}/{session.repo.repo}
        </p>
        <p className="overall">
          <span className="overall-score">{result.overall}</span>
          <span className="overall-unit"> / 100</span>
        </p>
        <p>{level(result.overall)}</p>
        <RadarChart scores={result.categories} />
      </section>

      <section className="card">
        <h2>総評</h2>
        <p className="summary">{result.summary}</p>
      </section>

      <WeaknessPanel categories={result.categories} onRetry={onRetry} />

      <section className="card">
        <h2>問題ごとの結果</h2>
        <ul className="review">
          {result.questions.map((r) => {
            const entry = qById.get(r.id);
            if (!entry) return null;
            return (
              <li key={r.id} className={r.correct ? "ok" : "ng"}>
                <details>
                  <summary>
                    <span className="mark">{r.correct ? "○" : r.score > 0 ? "△" : "×"}</span>
                    Q{entry.no} <span className="muted">[{CATEGORY_LABELS[r.category]}]</span> {entry.q.question}
                  </summary>
                  <dl>
                    <dt>あなたの回答</dt>
                    <dd className="pre-wrap">{r.userAnswer || "(未回答)"}</dd>
                    <dt>{r.type === "choice" ? "正解" : "満たすべき要点"}</dt>
                    <dd className="pre-wrap">{r.correctAnswer}</dd>
                    {r.feedback && (
                      <>
                        <dt>フィードバック</dt>
                        <dd>{r.feedback}</dd>
                      </>
                    )}
                    <dt>解説</dt>
                    <dd>{r.explanation}</dd>
                  </dl>
                </details>
              </li>
            );
          })}
        </ul>
      </section>

      <button className="primary" onClick={onRestart}>
        別のリポジトリで試す
      </button>
    </div>
  );
}
