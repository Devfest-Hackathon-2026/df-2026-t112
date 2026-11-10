import { useEffect, useState } from "react";
import { ApiError, createQuiz, getQuiz, gradeQuiz, listMistakes, retryQuiz } from "./api";
import { AuthButton } from "./components/AuthButton";
import { MistakesView } from "./components/MistakesView";
import { QuizView } from "./components/QuizView";
import { RepoForm } from "./components/RepoForm";
import { ResultView } from "./components/ResultView";
import { Wordmark } from "./components/Wordmark";
import { clearProgress, loadProgress, saveProgress } from "./persist";
import type { Answers, GradeResult, QuizSession } from "./types";

type Phase =
  | { name: "input" }
  | { name: "mistakes" }
  | { name: "loading"; url: string; message?: string }
  | { name: "quiz"; session: QuizSession; submitting: boolean }
  | { name: "result"; session: QuizSession; result: GradeResult };

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : "予期しないエラーが発生しました");

export function App() {
  // 再読み込みしても、回答中のクイズや結果が消えないようにする
  const [saved] = useState(() => loadProgress());
  const [phase, setPhase] = useState<Phase>(() =>
    !saved
      ? { name: "input" }
      : saved.result
        ? { name: "result", session: saved.session, result: saved.result }
        : { name: "quiz", session: saved.session, submitting: false },
  );
  const [answers, setAnswers] = useState<Answers>(saved?.answers ?? {});
  const [error, setError] = useState<string | null>(null);
  const [mistakeCounts, setMistakeCounts] = useState({ open: 0, resolved: 0 });

  // トップ画面に戻るたびに、問題の数を取り直す。取得に失敗しても、クイズは作れる
  useEffect(() => {
    if (phase.name !== "input") return;
    let active = true;
    listMistakes()
      .then((r) => {
        if (active) setMistakeCounts({ open: r.open.length, resolved: r.resolved.length });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [phase.name]);

  // 回答中だったクイズがサーバー側に残っているか確かめる(API の再起動や期限切れで消えることがある)
  useEffect(() => {
    if (!saved || saved.result) return;
    getQuiz(saved.session.sessionId).catch((e) => {
      if (e instanceof ApiError && e.code === "not_found") {
        clearProgress();
        setAnswers({});
        setError("前回のクイズは期限切れで、続きから再開できませんでした。もう一度作成してください");
        setPhase({ name: "input" });
      }
    });
  }, [saved]);

  const restart = () => {
    clearProgress();
    setAnswers({});
    setPhase({ name: "input" });
  };

  /** クイズを作って開く。失敗したら onFail の画面に戻す(前の結果を消さないよう、保存は成功してから上書きする)。 */
  const openQuiz = async (create: () => Promise<QuizSession>, loading: Phase, onFail: Phase) => {
    setError(null);
    setPhase(loading);
    try {
      const session = await create();
      setAnswers({});
      saveProgress({ session, answers: {} });
      setPhase({ name: "quiz", session, submitting: false });
    } catch (e) {
      setError(messageOf(e));
      setPhase(onFail);
    }
  };

  const start = (url: string, author?: string) =>
    openQuiz(
      () => createQuiz(url, author),
      { name: "loading", url, message: author ? `${author} が書いたコードから問題を作っています…` : undefined },
      { name: "input" },
    );

  const retry = (session: QuizSession, result: GradeResult) =>
    openQuiz(
      () => retryQuiz(session.sessionId),
      {
        name: "loading",
        url: `${session.repo.owner}/${session.repo.repo}`,
        message: result.questions.every((r) => r.correct)
          ? "まだ解いていない問題を作っています…"
          : "間違えた問題から類似問題を作っています…",
      },
      { name: "result", session, result },
    );

  const submit = async (session: QuizSession, answers: Answers) => {
    setError(null);
    setPhase({ name: "quiz", session, submitting: true });
    try {
      const result = await gradeQuiz(session.sessionId, answers);
      saveProgress({ session, answers, result });
      window.scrollTo({ top: 0 });
      setPhase({ name: "result", session, result });
    } catch (e) {
      setError(messageOf(e));
      setPhase({ name: "quiz", session, submitting: false });
    }
  };

  return (
    <>
      {/* 入口には大きなロゴがあるので、上部のバーには出さない */}
      <header className={phase.name === "input" ? "app-bar plain" : "app-bar"}>
        {phase.name !== "input" && (
          <>
            <Wordmark />
            <span className="muted">Escape VibeCoder</span>
          </>
        )}
        <AuthButton />
      </header>

      <main className={phase.name === "quiz" || phase.name === "mistakes" ? "wide" : undefined}>
      {phase.name === "input" && (
        <RepoForm
          onSubmit={start}
          error={error}
          footer={
            mistakeCounts.open + mistakeCounts.resolved > 0 && (
              <button type="button" className="link mistake-entry" onClick={() => setPhase({ name: "mistakes" })}>
                間違えた問題フォルダ(未解決 {mistakeCounts.open} 問)
              </button>
            )
          }
        />
      )}
      {phase.name === "mistakes" && <MistakesView onBack={() => setPhase({ name: "input" })} />}
      {phase.name === "loading" && (
        <div className="loading" aria-live="polite">
          <div className="spinner" />
          <p>{phase.message ?? "コードを読んで問題を作っています…"}</p>
          <p className="muted">{phase.url}</p>
        </div>
      )}
      {phase.name === "quiz" && (
        <QuizView
          key={phase.session.sessionId}
          session={phase.session}
          initialAnswers={answers}
          onAnswersChange={(next) => {
            setAnswers(next);
            saveProgress({ session: phase.session, answers: next });
          }}
          submitting={phase.submitting}
          error={error}
          onSubmit={(answers) => submit(phase.session, answers)}
        />
      )}
      {phase.name === "result" && (
        <ResultView
          session={phase.session}
          result={phase.result}
          onRestart={restart}
          onRetry={() => retry(phase.session, phase.result)}
          error={error}
        />
      )}
      </main>
    </>
  );
}
