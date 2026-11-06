import { useState } from "react";
import type { Answers, QuizSession } from "../types";
import { QuestionCard } from "./QuestionCard";

type Props = {
  session: QuizSession;
  submitting: boolean;
  error?: string | null;
  onSubmit: (answers: Answers) => void;
};

export function isAnswered(q: QuizSession["questions"][number], a: Answers[string] | undefined): boolean {
  return q.type === "choice" ? a?.choice !== undefined : (a?.text ?? "").trim().length > 0;
}

export function QuizView({ session, submitting, error, onSubmit }: Props) {
  const [answers, setAnswers] = useState<Answers>({});
  const answered = session.questions.filter((q) => isAnswered(q, answers[q.id])).length;
  const total = session.questions.length;

  return (
    <div className="quiz">
      <div className="card">
        <h2>
          {session.repo.owner}/{session.repo.repo}
        </h2>
        {session.repo.description && <p className="muted">{session.repo.description}</p>}
        <progress value={answered} max={total} />
        <p className="muted">
          {answered} / {total} 問回答済み
        </p>
      </div>

      {session.questions.map((q, i) => (
        <QuestionCard
          key={q.id}
          index={i}
          question={q}
          answer={answers[q.id]}
          onChange={(a) => setAnswers((prev) => ({ ...prev, [q.id]: a }))}
        />
      ))}

      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" disabled={answered < total || submitting} onClick={() => onSubmit(answers)}>
        {submitting ? "採点中…" : "回答を送信"}
      </button>
    </div>
  );
}
