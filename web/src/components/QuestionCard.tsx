import { useState } from "react";
import { CATEGORY_LABELS, type Answer, type PublicQuestion } from "../types";

type Props = {
  index: number;
  question: PublicQuestion;
  answer: Answer | undefined;
  onChange: (answer: Answer) => void;
};

export function QuestionCard({ index, question: q, answer, onChange }: Props) {
  const [showHint, setShowHint] = useState(false);

  return (
    <section className="card question">
      <header>
        <span className="badge">Q{index + 1}</span>
        <span className="badge category">{CATEGORY_LABELS[q.category]}</span>
        <span className="muted">{"★".repeat(q.difficulty)}</span>
        <span className="tag">{q.type === "choice" ? "選択式" : "記述式"}</span>
      </header>

      <p className="question-text">{q.question}</p>

      {q.snippet && (
        <figure>
          <figcaption>
            {q.codeRef.path} L{q.codeRef.startLine}-{q.codeRef.endLine}
          </figcaption>
          <pre>
            <code>{q.snippet}</code>
          </pre>
        </figure>
      )}

      {q.type === "choice" ? (
        <div className="choices" role="radiogroup" aria-label={`Q${index + 1} の選択肢`}>
          {q.choices.map((c, i) => (
            <label key={i} className={answer?.choice === i ? "choice selected" : "choice"}>
              <input
                type="radio"
                name={q.id}
                checked={answer?.choice === i}
                onChange={() => onChange({ choice: i })}
              />
              <span>{c}</span>
            </label>
          ))}
        </div>
      ) : (
        <textarea
          rows={5}
          placeholder="自分の言葉で説明してください(2〜3文)"
          value={answer?.text ?? ""}
          onChange={(e) => onChange({ text: e.target.value })}
        />
      )}

      <div className="hint">
        {showHint ? (
          <p className="hint-text">ヒント: {q.hint}</p>
        ) : (
          <button type="button" className="link" onClick={() => setShowHint(true)}>
            ヒントを見る
          </button>
        )}
      </div>
    </section>
  );
}
