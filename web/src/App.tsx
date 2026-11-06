import { useState } from "react";
import { ApiError, createQuiz, gradeQuiz } from "./api";
import { QuizView } from "./components/QuizView";
import { RepoForm } from "./components/RepoForm";
import { ResultView } from "./components/ResultView";
import type { Answers, GradeResult, QuizSession } from "./types";

type Phase =
  | { name: "input" }
  | { name: "loading"; url: string }
  | { name: "quiz"; session: QuizSession; submitting: boolean }
  | { name: "result"; session: QuizSession; result: GradeResult };

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : "予期しないエラーが発生しました");

export function App() {
  const [phase, setPhase] = useState<Phase>({ name: "input" });
  const [error, setError] = useState<string | null>(null);

  const start = async (url: string) => {
    setError(null);
    setPhase({ name: "loading", url });
    try {
      setPhase({ name: "quiz", session: await createQuiz(url), submitting: false });
    } catch (e) {
      setError(messageOf(e));
      setPhase({ name: "input" });
    }
  };

  const submit = async (session: QuizSession, answers: Answers) => {
    setError(null);
    setPhase({ name: "quiz", session, submitting: true });
    try {
      const result = await gradeQuiz(session.sessionId, answers);
      window.scrollTo({ top: 0 });
      setPhase({ name: "result", session, result });
    } catch (e) {
      setError(messageOf(e));
      setPhase({ name: "quiz", session, submitting: false });
    }
  };

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
      {phase.name === "quiz" && (
        <QuizView
          session={phase.session}
          submitting={phase.submitting}
          error={error}
          onSubmit={(answers) => submit(phase.session, answers)}
        />
      )}
      {phase.name === "result" && (
        <ResultView session={phase.session} result={phase.result} onRestart={() => setPhase({ name: "input" })} />
      )}
    </main>
  );
}
