import { useEffect, useRef, useState } from "react";
import { ApiError, createQuiz, getQuiz, gradeQuiz, listMistakes, retryQuiz } from "./api";
import { AccountMenu } from "./components/AccountMenu";
import { MistakesView } from "./components/MistakesView";
import { QuizView } from "./components/QuizView";
import { RepoForm } from "./components/RepoForm";
import { ResultView } from "./components/ResultView";
import { Wordmark } from "./components/Wordmark";
import { currentScreen, enterApp, pushScreen, type Screen } from "./nav";
import { clearProgress, loadProgress, saveProgress } from "./persist";
import type { Answers, GradeResult, QuizSession } from "./types";

type Phase =
  | { name: "input" }
  | { name: "mistakes" }
  | { name: "loading"; url: string; message?: string }
  | { name: "quiz"; session: QuizSession; submitting: boolean }
  | { name: "result"; session: QuizSession; result: GradeResult };

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : "予期しないエラーが発生しました");

/** 履歴の画面から、表示する内容を決める。クイズと結果は保存した進行状況から戻す。 */
function phaseFor(screen: Screen): Phase {
  if (screen === "mistakes") return { name: "mistakes" };
  const saved = screen === "app" ? loadProgress() : null;
  if (!saved) return { name: "input" };
  return saved.result
    ? { name: "result", session: saved.session, result: saved.result }
    : { name: "quiz", session: saved.session, submitting: false };
}

export function App() {
  // 再読み込みしても、回答中のクイズや結果が消えないようにする
  const [saved] = useState(() => loadProgress());
  const [phase, setPhase] = useState<Phase>(() => phaseFor(enterApp(saved !== null)));
  const [answers, setAnswers] = useState<Answers>(saved?.answers ?? {});
  const [error, setError] = useState<string | null>(null);
  const [openMistakes, setOpenMistakes] = useState(0);
  /** ブラウザの戻る・進むのたびに増える。増えていたら、待っていた処理の結果で画面を変えない。 */
  const navigations = useRef(0);
  /** history.back() の移動先で見せるエラー。 */
  const pendingError = useRef<string | null>(null);

  useEffect(() => {
    const onPop = () => {
      navigations.current++;
      setError(pendingError.current);
      pendingError.current = null;
      setAnswers(loadProgress()?.answers ?? {});
      setPhase(phaseFor(currentScreen() ?? "input"));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /** 履歴を 1 つ戻して入口の画面に帰り、そこでエラーを見せる。 */
  const backWithError = (message: string) => {
    pendingError.current = message;
    window.history.back();
  };

  // 画面が変わるたびに、未解決の数を取り直す。取得に失敗しても、クイズは作れる
  useEffect(() => {
    let active = true;
    listMistakes()
      .then((r) => {
        if (active) setOpenMistakes(r.open.length);
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
        if (currentScreen() === "app") backWithError("前回のクイズは期限切れで、続きから再開できませんでした。もう一度作成してください");
      }
    });
  }, [saved]);

  const restart = () => {
    clearProgress();
    window.history.back();
  };

  /** クイズを作って開く。失敗したら onFail を呼ぶ(前の結果を消さないよう、保存は成功してから上書きする)。 */
  const openQuiz = async (create: () => Promise<QuizSession>, loading: Phase, onFail: (message: string) => void) => {
    setError(null);
    setPhase(loading);
    const at = navigations.current;
    try {
      const session = await create();
      // 待っている間にブラウザの戻るで離れていても、作った問題は「進む」で開ける
      saveProgress({ session, answers: {} });
      if (at !== navigations.current) return;
      setAnswers({});
      setPhase({ name: "quiz", session, submitting: false });
    } catch (e) {
      if (at === navigations.current) onFail(messageOf(e));
    }
  };

  const start = (url: string) => {
    pushScreen("app");
    return openQuiz(() => createQuiz(url), { name: "loading", url, message: "あなたが書いたコードから問題を作っています…" }, backWithError);
  };

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
      (message) => {
        setError(message);
        setPhase({ name: "result", session, result });
      },
    );

  const submit = async (session: QuizSession, answers: Answers) => {
    setError(null);
    setPhase({ name: "quiz", session, submitting: true });
    const at = navigations.current;
    try {
      const result = await gradeQuiz(session.sessionId, answers);
      saveProgress({ session, answers, result });
      if (at !== navigations.current) return;
      window.scrollTo({ top: 0 });
      setPhase({ name: "result", session, result });
    } catch (e) {
      if (at !== navigations.current) return;
      setError(messageOf(e));
      setPhase({ name: "quiz", session, submitting: false });
    }
  };

  const openFolder = () => {
    if (phase.name === "mistakes") return;
    pushScreen("mistakes");
    setPhase({ name: "mistakes" });
    window.scrollTo({ top: 0 });
  };

  return (
    <>
      {/* 入口には大きなロゴがあるので、上部のバーには出さない */}
      <header className={phase.name === "input" ? "app-bar plain" : "app-bar"}>
        {phase.name === "mistakes" && (
          <button type="button" className="icon-button" aria-label="戻る" title="戻る" onClick={() => window.history.back()}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
            </svg>
          </button>
        )}
        {phase.name !== "input" && (
          <div className="app-brand">
            <Wordmark />
            <span className="muted">Escape VibeCoder</span>
          </div>
        )}
        <div className="app-actions">
          <button
            type="button"
            className="icon-button"
            aria-label={`間違えた問題フォルダ(未解決 ${openMistakes} 問)`}
            title="間違えた問題フォルダ"
            disabled={phase.name === "loading" || (phase.name === "quiz" && phase.submitting)}
            onClick={openFolder}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
            </svg>
            {openMistakes > 0 && <span className="icon-badge">{openMistakes}</span>}
          </button>
          <AccountMenu />
        </div>
      </header>

      <main className={phase.name === "quiz" || phase.name === "mistakes" ? "wide" : undefined}>
      {phase.name === "input" && <RepoForm onSubmit={start} error={error} />}
      {phase.name === "mistakes" && <MistakesView />}
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
