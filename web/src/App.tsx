import { useEffect, useRef, useState } from "react";
import { ApiError, createQuiz, getQuiz, gradeQuiz, listMistakes, retryQuiz, saveAnswer } from "./api";
import { AnswerSaver } from "./answerSaver";
import { useAuth } from "./auth";
import { AccountMenu } from "./components/AccountMenu";
import { MistakesView } from "./components/MistakesView";
import { QuizView } from "./components/QuizView";
import { RepoForm } from "./components/RepoForm";
import { ResultView } from "./components/ResultView";
import { Wordmark } from "./components/Wordmark";
import { forgetQuiz, lastQuiz, rememberQuiz } from "./persist";
import { quizIdFrom, showQuizInUrl } from "./quizUrl";
import type { Answers, GradeResult, QuizSession, SavedQuiz } from "./types";

/** 間違えた問題フォルダは、どの画面からでも開いて、元の画面に戻れる。 */
type Phase = BasePhase | { name: "mistakes"; back: BasePhase };

type BasePhase =
  | { name: "input" }
  | { name: "loading"; url: string; message?: string }
  | { name: "quiz"; session: QuizSession; submitting: boolean }
  | { name: "result"; session: QuizSession; result: GradeResult };

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : "予期しないエラーが発生しました");

/** ログインしない開発用のときに、最後に使ったクイズを覚えておく名前。 */
const DEV_UID = "dev";

export function App() {
  const { user } = useAuth();
  const uid = user?.uid ?? DEV_UID;
  // 再読み込みや開き直しで続きから解けるように、URL のクイズ(無ければ最後に使ったクイズ)をサーバーから読み直す(#32)
  const [restoreId] = useState(() => quizIdFrom(window.location.search) ?? lastQuiz(uid));
  const [phase, setPhase] = useState<Phase>(() =>
    restoreId ? { name: "loading", url: "", message: "前回のクイズを読み込んでいます…" } : { name: "input" },
  );
  const [answers, setAnswers] = useState<Answers>({});
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [openMistakes, setOpenMistakes] = useState(0);
  /** 開いているクイズの回答を、1 問ずつサーバーに送る係。 */
  const saver = useRef<{ sessionId: string; saver: AnswerSaver } | null>(null);
  /** 今表示しているクイズ。サーバーの応答が遅れて届いたときに、別のクイズの画面を上書きしないために使う。 */
  const shown = useRef<string | null>(null);
  shown.current = phase.name === "quiz" || phase.name === "result" ? phase.session.sessionId : null;

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

  /** サーバーから読み直したクイズを開く。採点済みなら結果の画面にする。 */
  const show = (saved: SavedQuiz) => {
    const { answers, result, ...session } = saved;
    rememberQuiz(uid, session.sessionId);
    showQuizInUrl(session.sessionId);
    setAnswers(answers);
    setPhase(result ? { name: "result", session, result } : { name: "quiz", session, submitting: false });
  };

  useEffect(() => {
    if (!restoreId) return;
    let active = true;
    getQuiz(restoreId)
      .then((saved) => {
        if (active) show(saved);
      })
      .catch((e) => {
        if (!active) return;
        if (e instanceof ApiError && e.code === "not_found") {
          // 期限切れか、別の人のクイズ(ログインし直したときなど)。続きからは開けない
          forgetQuiz();
          showQuizInUrl(null);
          setError("前回のクイズは期限切れで、続きから再開できませんでした。もう一度作成してください");
        } else {
          setError("前回のクイズを読み込めませんでした。ページを再読み込みしてください");
        }
        setPhase({ name: "input" });
      });
    return () => {
      active = false;
    };
    // 開いたときに 1 回だけ読む
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreId]);

  // ページを閉じたり、別のタブに切り替えたりするときは、待っている回答をすぐに送る
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") void saver.current?.saver.flush();
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  // 別のタブで答えたり提出したりした分を、このタブに戻ってきたときにサーバーから読み直す(#32)
  const quizId = phase.name === "quiz" ? phase.session.sessionId : null;
  useEffect(() => {
    if (!quizId) return;
    let last = 0;
    const refresh = () => {
      // 戻ったときは focus と visibilitychange の両方が来ることがあるので、1 回にまとめる
      if (document.visibilityState !== "visible" || Date.now() - last < 1000) return;
      last = Date.now();
      getQuiz(quizId)
        .then((saved) => {
          if (shown.current !== quizId) return;
          if (saved.result) return show(saved);
          // このタブで答えた分を優先し、このタブにまだ無い問題だけを、サーバーの回答で埋める
          setAnswers((mine) => ({ ...saved.answers, ...mine }));
        })
        .catch(() => {});
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
    // show はクイズが変わらない限り同じ動きをするので、クイズの ID だけを追えばよい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizId]);

  /** 回答の保存に失敗した。別のタブで提出済みだったなら、このタブも結果の画面にする。 */
  const onSaveFailed = (sessionId: string, e: unknown) => {
    if (e instanceof ApiError && e.code === "already_graded") {
      getQuiz(sessionId)
        .then((saved) => {
          if (shown.current === sessionId) show(saved);
        })
        .catch(() => {});
      return;
    }
    setSaveError("回答をサーバーに保存できませんでした。通信を確かめてください(このまま提出はできます)");
  };

  const saverFor = (sessionId: string): AnswerSaver => {
    if (saver.current?.sessionId !== sessionId) {
      saver.current?.saver.dispose();
      saver.current = {
        sessionId,
        saver: new AnswerSaver(
          async (questionId, answer) => {
            await saveAnswer(sessionId, questionId, answer);
            setSaveError(null);
          },
          (e) => onSaveFailed(sessionId, e),
        ),
      };
    }
    return saver.current.saver;
  };

  /** 変わった問題の回答だけを送る。選択式はすぐ、記述式は打ち終わって少ししてから。 */
  const changeAnswers = (session: QuizSession, next: Answers) => {
    const s = saverFor(session.sessionId);
    for (const q of session.questions) {
      const a = next[q.id];
      if (a && a !== answers[q.id]) s.change(q.id, a, q.type === "choice");
    }
    setAnswers(next);
  };

  const restart = () => {
    saver.current?.saver.dispose();
    saver.current = null;
    forgetQuiz();
    showQuizInUrl(null);
    setAnswers({});
    setSaveError(null);
    setPhase({ name: "input" });
  };

  /** クイズを作って開く。失敗したら onFail の画面に戻す。 */
  const openQuiz = async (create: () => Promise<QuizSession>, loading: BasePhase, onFail: BasePhase) => {
    setError(null);
    setPhase(loading);
    try {
      const session = await create();
      setAnswers({});
      setSaveError(null);
      rememberQuiz(uid, session.sessionId);
      showQuizInUrl(session.sessionId);
      setPhase({ name: "quiz", session, submitting: false });
    } catch (e) {
      setError(messageOf(e));
      setPhase(onFail);
    }
  };

  const start = (url: string, author?: string) =>
    openQuiz(
      // 本人の行が見つからなかったら、全体から出題する
      () => createQuiz(url, author).catch((e) => {
        if (author && e instanceof ApiError && e.code === "no_authored") return createQuiz(url);
        throw e;
      }),
      { name: "loading", url, message: author ? "あなたが書いたコードから問題を作っています…" : undefined },
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
    // 待っている回答を送り切ってから採点する(送れなかった回答も、提出する回答に入っている)
    await saverFor(session.sessionId).flush();
    try {
      const result = await gradeQuiz(session.sessionId, answers);
      setSaveError(null);
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
        <div className="app-actions">
          <button
            type="button"
            className="icon-button"
            aria-label={`間違えた問題フォルダ(未解決 ${openMistakes} 問)`}
            title="間違えた問題フォルダ"
            disabled={phase.name === "loading" || (phase.name === "quiz" && phase.submitting)}
            onClick={() => setPhase((p) => (p.name === "mistakes" ? p : { name: "mistakes", back: p }))}
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
      {phase.name === "mistakes" && <MistakesView onBack={() => setPhase(phase.back)} />}
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
          answers={answers}
          onAnswersChange={(next) => changeAnswers(phase.session, next)}
          submitting={phase.submitting}
          error={error ?? saveError}
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
