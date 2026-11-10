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
import { currentScreen, enterApp, pushScreen } from "./nav";
import { forgetQuiz, lastQuiz, rememberQuiz } from "./persist";
import { quizIdFrom, showQuizInUrl } from "./quizUrl";
import type { Answers, GradeResult, QuizSession, SavedQuiz } from "./types";

type Phase =
  | { name: "input" }
  | { name: "mistakes" }
  | { name: "loading"; url: string; message?: string }
  | { name: "quiz"; session: QuizSession; submitting: boolean }
  | { name: "result"; session: QuizSession; result: GradeResult };

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : "予期しないエラーが発生しました");

/** ログインしない開発用のときに、最後に使ったクイズを覚えておく名前。 */
const DEV_UID = "dev";

const RESTORING: Phase = { name: "loading", url: "", message: "前回のクイズを読み込んでいます…" };

/**
 * 続きから開くクイズの ID。URL(?quiz=)のものを優先し、無ければこの人が最後に使ったもの。
 * クイズの中身・回答・採点結果はサーバーにあるので、開くたびに読み直す(#32)。
 */
const quizToOpen = (uid: string) => quizIdFrom(window.location.search) ?? lastQuiz(uid);

export function App() {
  const { user } = useAuth();
  const uid = user?.uid ?? DEV_UID;
  // 画面はブラウザの履歴から決める。再読み込みなら同じ画面のまま、URL を打って開いたときは入口から始める(#55、#56)
  const [entryScreen] = useState(() => enterApp());
  const [restoreId] = useState(() => (entryScreen === "app" ? quizToOpen(uid) : null));
  const [phase, setPhase] = useState<Phase>(() =>
    entryScreen === "mistakes" ? { name: "mistakes" } : restoreId ? RESTORING : { name: "input" },
  );
  const [answers, setAnswers] = useState<Answers>({});
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [openMistakes, setOpenMistakes] = useState(0);
  /** 入口の画面に出す、続きから開けるクイズ。 */
  const [offer, setOffer] = useState<SavedQuiz | null>(null);
  /** ブラウザの戻る・進むのたびに増える。増えていたら、待っていた処理の結果で画面を変えない。 */
  const navigations = useRef(0);
  /** history.back() の移動先で見せるエラー。 */
  const pendingError = useRef<string | null>(null);
  /** 開いているクイズの回答を、1 問ずつサーバーに送る係。 */
  const saver = useRef<{ sessionId: string; saver: AnswerSaver } | null>(null);
  /** 今表示しているクイズ。サーバーの応答が遅れて届いたときに、別のクイズの画面を上書きしないために使う。 */
  const shown = useRef<string | null>(null);
  shown.current = phase.name === "quiz" || phase.name === "result" ? phase.session.sessionId : null;

  /** 履歴を 1 つ戻して入口の画面に帰り、そこでエラーを見せる。 */
  const backWithError = (message: string) => {
    pendingError.current = message;
    window.history.back();
  };

  /** 開けなかったクイズ(期限切れか、別の人のもの)を、覚えている場所から外す。ほかのクイズの記録は残す。 */
  const dropQuiz = (id: string) => {
    if (lastQuiz(uid) === id) forgetQuiz();
    if (quizIdFrom(window.location.search) === id) showQuizInUrl(null);
  };

  /** サーバーから読み直したクイズを開く。採点済みなら結果の画面にする。 */
  const show = (saved: SavedQuiz) => {
    const { answers, result, ...session } = saved;
    rememberQuiz(uid, session.sessionId);
    showQuizInUrl(session.sessionId);
    setAnswers(answers);
    setPhase(result ? { name: "result", session, result } : { name: "quiz", session, submitting: false });
  };

  /**
   * サーバーに保存してあるクイズを読み直して開く。待っている間に stale() が true になったら
   * (ブラウザの戻る・進むで別の画面へ移った)、画面を変えない。
   */
  const reopen = async (id: string, stale: () => boolean) => {
    setPhase(RESTORING);
    try {
      // まだ送っていない回答があれば先に送る(読み直したときに、手元の回答が古い内容に戻らないように)
      await saver.current?.saver.flush();
      const saved = await getQuiz(id);
      if (!stale()) show(saved);
    } catch (e) {
      if (stale()) return;
      if (e instanceof ApiError && e.code === "not_found") {
        // 期限切れか、別の人のクイズ(ログインし直したときなど)。続きからは開けない
        dropQuiz(id);
        backWithError("前回のクイズは期限切れで、続きから再開できませんでした。もう一度作成してください");
      } else {
        setError("前回のクイズを読み込めませんでした。ページを再読み込みしてください");
        setPhase({ name: "input" });
      }
    }
  };

  // ブラウザの戻る・進むで、履歴の画面に合わせる。クイズと結果は、サーバーから読み直す
  useEffect(() => {
    const onPop = () => {
      navigations.current++;
      setError(pendingError.current);
      pendingError.current = null;
      const screen = currentScreen() ?? "input";
      const id = screen === "app" ? quizToOpen(uid) : null;
      if (id) {
        const at = navigations.current;
        void reopen(id, () => at !== navigations.current);
      } else {
        setPhase(screen === "mistakes" ? { name: "mistakes" } : { name: "input" });
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // reopen は、そのときの state ではなく ref と set 関数だけを使う。uid が変わったときだけつけ直せばよい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

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

  // 再読み込みしたときは、開いていたクイズをサーバーから読み直す(StrictMode では 2 回動くので、古いほうは捨てる)
  useEffect(() => {
    if (!restoreId) return;
    let active = true;
    void reopen(restoreId, () => !active);
    return () => {
      active = false;
    };
    // 開いたときに 1 回だけ読む
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreId]);

  // 入口の画面では、続きから開けるクイズ(URL のもの、無ければ最後に使ったもの)をボタンで知らせる(#56)
  useEffect(() => {
    setOffer(null);
    if (phase.name !== "input") return;
    const id = quizToOpen(uid);
    if (!id) return;
    let active = true;
    getQuiz(id)
      .then((saved) => {
        if (active) setOffer(saved);
      })
      .catch((e) => {
        if (!active || !(e instanceof ApiError) || e.code !== "not_found") return;
        // 期限切れか、別の人のクイズ。覚えておいても開けない
        dropQuiz(id);
      });
    return () => {
      active = false;
    };
  }, [phase.name, uid]);

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
    setAnswers({});
    setSaveError(null);
    window.history.back();
  };

  /** クイズを作って開く。失敗したら onFail を呼ぶ(前の結果を消さないよう、覚えるのは成功してから)。 */
  const openQuiz = async (create: () => Promise<QuizSession>, loading: Phase, onFail: (message: string) => void) => {
    setError(null);
    setPhase(loading);
    const at = navigations.current;
    try {
      const session = await create();
      // 待っている間にブラウザの戻るで離れていても、作った問題は「進む」で開ける
      rememberQuiz(uid, session.sessionId);
      if (at !== navigations.current) return;
      showQuizInUrl(session.sessionId);
      setAnswers({});
      setSaveError(null);
      setPhase({ name: "quiz", session, submitting: false });
    } catch (e) {
      if (at === navigations.current) onFail(messageOf(e));
    }
  };

  const start = (url: string) => {
    // 入口の URL に前のクイズの ID が残っていれば外す(戻ったときに、そのクイズを勧めないため)
    showQuizInUrl(null);
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
    // 待っている回答を送り切ってから採点する(送れなかった回答も、提出する回答に入っている)
    await saverFor(session.sessionId).flush();
    try {
      const result = await gradeQuiz(session.sessionId, answers);
      setSaveError(null);
      if (at !== navigations.current) return;
      window.scrollTo({ top: 0 });
      setPhase({ name: "result", session, result });
    } catch (e) {
      if (at !== navigations.current) return;
      setError(messageOf(e));
      setPhase({ name: "quiz", session, submitting: false });
    }
  };

  /** 入口の画面から、続きのクイズや結果を開く。 */
  const resume = (saved: SavedQuiz) => {
    pushScreen("app");
    setError(null);
    const at = navigations.current;
    void reopen(saved.sessionId, () => at !== navigations.current);
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
      {phase.name === "input" && <RepoForm
          onSubmit={start}
          error={error}
          resume={offer ? { label: `${offer.repo.owner}/${offer.repo.repo} の${offer.result ? "結果を見る" : "続きから解く"}`, onClick: () => resume(offer) } : undefined}
        />}
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
