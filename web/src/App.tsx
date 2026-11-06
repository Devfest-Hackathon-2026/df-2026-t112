import { useState } from "react";
import { ApiError, createQuiz } from "./api";
import { QuizView } from "./components/QuizView";
import { RepoForm } from "./components/RepoForm";
import type { Answers, QuizSession } from "./types";

type Phase = { name: "input" } | { name: "loading"; url: string } | { name: "quiz"; session: QuizSession } | { name: "answered"; count: number };

export function App() {
  const [phase, setPhase] = useState<Phase>({ name: "input" });
  const [error, setError] = useState<string | null>(null);

  const start = async (url: string) => {
    setError(null);
    setPhase({ name: "loading", url });
    try {
      setPhase({ name: "quiz", session: await createQuiz(url) });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "予期しないエラーが発生しました");
      setPhase({ name: "input" });
    }
  };

  const submit = (answers: Answers) => setPhase({ name: "answered", count: Object.keys(answers).length });

  return (
    <main>
      <header className="app-header">
        <h1>EVC</h1>
        <span className="muted">Escape VibeCoder</span>
      </header>

      {phase.name === "input" && <RepoForm onSubmit={start} error={error} />}
      {phase.name === "loading" && (
        <div className="card center" aria-live="polite">
          <p>コードを読んで問題を作っています…(30秒ほどかかります)</p>
          <p className="muted">{phase.url}</p>
        </div>
      )}
      {phase.name === "quiz" && <QuizView session={phase.session} submitting={false} onSubmit={submit} />}
      {phase.name === "answered" && <div className="card center">{phase.count} 問に回答しました(採点は次のステップで実装)</div>}
    </main>
  );
}
