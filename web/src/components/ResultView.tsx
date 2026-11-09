import type { GradeResult, QuizSession } from "../types";

type Props = {
  session: QuizSession;
  result: GradeResult;
  onRestart: () => void;
  onRetry: () => void;
  error?: string | null;
};

function level(score: number): string {
  if (score >= 80) return "よく理解できています";
  if (score >= 60) return "おおむね理解できています";
  if (score >= 40) return "理解にムラがあります";
  return "もう一度コードを読み直しましょう";
}

/** 総評は「【見出し】」の行で区切られている。見出しだけを強調する。 */
function Summary({ text }: { text: string }) {
  return (
    <div className="summary">
      {text.split("\n").map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return null;
        return /^【.+】$/.test(trimmed) ? <h3 key={i}>{trimmed}</h3> : <p key={i}>{line}</p>;
      })}
    </div>
  );
}

export function ResultView({ session, result, onRestart, onRetry, error }: Props) {
  const qById = new Map(session.questions.map((q, i) => [q.id, { q, no: i + 1 }]));
  const correct = result.questions.filter((r) => r.correct).length;
  const missed = result.questions.length - correct;

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
        {result.explanation != null && (
          <p className="explanation">
            説明力 <strong>{result.explanation}</strong>
            <span className="muted"> / 100(記述式の得点)</span>
          </p>
        )}
      </section>

      <section className="card">
        <h2>総評</h2>
        <Summary text={result.summary} />
      </section>

      <div className="result-retry">
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" onClick={onRetry}>
          {missed > 0 ? "間違えた問題の類似問題に挑戦する" : "まだ解いていない問題に挑戦する"}
        </button>
        <p className="muted">
          {missed > 0
            ? "間違えた内容をもとに、3〜6 問の短いクイズを作ります。"
            : "全問正解です。同じリポジトリから、別の問題で 6 問のクイズを作ります。"}
        </p>
      </div>

      <section className="card">
        <h2>
          問題ごとの結果 <span className="muted">{correct} / {result.questions.length} 問正解</span>
        </h2>
        <ul className="review">
          {result.questions.map((r) => {
            const entry = qById.get(r.id);
            if (!entry) return null;
            return (
              <li key={r.id} className={r.correct ? "ok" : "ng"}>
                <details>
                  <summary>
                    <span className="mark">{r.correct ? "○" : r.score > 0 ? "△" : "×"}</span>
                    Q{entry.no} {entry.q.question}
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

      <button className="secondary block" onClick={onRestart}>
        別のリポジトリで試す
      </button>
    </div>
  );
}
