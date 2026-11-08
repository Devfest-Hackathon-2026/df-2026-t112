import { useState } from "react";
import { CATEGORY_LABELS, type Answer, type PublicQuestion } from "../types";

type Props = {
  index: number;
  question: PublicQuestion;
  answer: Answer | undefined;
  onChange: (answer: Answer) => void;
  disabled?: boolean;
};

export function QuestionCard({ index, question: q, answer, onChange, disabled }: Props) {
  const [showHint, setShowHint] = useState(false);

  return (
    <section className={q.snippet ? "slide" : "slide no-code"}>
      <div className="slide-question">
        <p className="muted slide-meta">
          {CATEGORY_LABELS[q.category]} ・ {"★".repeat(q.difficulty)}
        </p>
        <h2 className="question-text">{q.question}</h2>
      </div>

      {q.snippet && (
        <figure className="slide-code">
          <figcaption>
            {q.codeRef.path} L{q.codeRef.startLine}-{q.codeRef.endLine}
          </figcaption>
          <pre>
            <code>{q.snippet}</code>
          </pre>
        </figure>
      )}

      <div className="slide-answer">
        {q.type === "choice" ? (
          <div className="choices" role="group" aria-label={`問題 ${index + 1} の選択肢`}>
            {q.choices.map((c, i) => (
              <button
                key={i}
                type="button"
                className={answer?.choice === i ? "choice selected" : "choice"}
                aria-pressed={answer?.choice === i}
                disabled={disabled}
                onClick={() => onChange({ choice: i })}
              >
                <span className="choice-key" aria-hidden="true">
                  {i + 1}
                </span>
                <span>{c}</span>
              </button>
            ))}
          </div>
        ) : (
          <textarea
            rows={6}
            aria-label={`問題 ${index + 1} の回答`}
            placeholder="自分の言葉で説明してください(2〜3文)"
            value={answer?.text ?? ""}
            readOnly={disabled}
            onChange={(e) => onChange({ text: e.target.value })}
          />
        )}

        <div className="hint">
          {showHint ? (
            <p className="hint-text">{q.hint}</p>
          ) : (
            <button type="button" className="link" onClick={() => setShowHint(true)}>
              ヒントを見る
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
