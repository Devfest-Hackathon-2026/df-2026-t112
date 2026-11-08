import { useEffect, useRef, useState } from "react";
import { isAnswered, startIndex, unansweredIndexes } from "../quizNav";
import type { Answer, Answers, QuizSession } from "../types";
import { QuestionCard } from "./QuestionCard";

type Props = {
  session: QuizSession;
  submitting: boolean;
  error?: string | null;
  onSubmit: (answers: Answers) => void;
  /** 再読み込み後に、入力済みの回答を復元するための初期値。 */
  initialAnswers?: Answers;
  /** 回答が変わるたびに呼ばれる(進行状況の保存に使う)。 */
  onAnswersChange?: (answers: Answers) => void;
};

/** 文字入力中は、矢印キーや数字キーを入力の操作として扱う。 */
function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

export function QuizView({ session, submitting, error, onSubmit, initialAnswers, onAnswersChange }: Props) {
  const { questions } = session;
  const [answers, setAnswers] = useState<Answers>(initialAnswers ?? {});
  const [index, setIndex] = useState(() => startIndex(questions, initialAnswers ?? {}));
  const [direction, setDirection] = useState<"next" | "prev" | null>(null);
  const frame = useRef<HTMLDivElement>(null);

  const total = questions.length;
  const q = questions[index];
  const unanswered = unansweredIndexes(questions, answers);
  const ready = unanswered.length === 0;
  const isLast = index === total - 1;

  const go = (to: number) => {
    if (to < 0 || to >= total || to === index) return;
    setDirection(to > index ? "next" : "prev");
    setIndex(to);
  };

  const answer = (a: Answer) => {
    const next = { ...answers, [q.id]: a };
    setAnswers(next);
    onAnswersChange?.(next);
  };

  // 問題を切り替えたら先頭に戻し、読み上げソフトにも新しい問題を伝える。初回は何もしない
  useEffect(() => {
    if (direction === null) return;
    window.scrollTo({ top: 0 });
    frame.current?.focus({ preventScroll: true });
    // direction は移動のたびに index と一緒に変わるので、index だけを追えばよい
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || submitting) return;
      if (e.key === "ArrowRight") go(index + 1);
      else if (e.key === "ArrowLeft") go(index - 1);
      else if (q?.type === "choice") {
        const n = Number(e.key);
        if (n >= 1 && n <= q.choices.length) answer({ choice: n - 1 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!q) return null;

  return (
    <div className="quiz">
      <div className="quiz-top">
        <span className="muted quiz-repo">
          {session.repo.owner}/{session.repo.repo}
        </span>
        <span className="quiz-count">
          {index + 1} / {total}
        </span>
      </div>

      <nav className="steps" aria-label="問題の一覧">
        {questions.map((item, i) => {
          const done = isAnswered(item, answers[item.id]);
          return (
            <button
              key={item.id}
              type="button"
              className={`step${done ? " done" : ""}${i === index ? " current" : ""}`}
              aria-label={`問題 ${i + 1}(${done ? "回答済み" : "未回答"})`}
              aria-current={i === index ? "step" : undefined}
              onClick={() => go(i)}
            />
          );
        })}
      </nav>

      <div key={q.id} ref={frame} tabIndex={-1} className={`slide-frame${direction ? ` from-${direction}` : ""}`}>
        <QuestionCard index={index} question={q} answer={answers[q.id]} onChange={answer} disabled={submitting} />
      </div>

      <footer className="quiz-nav">
        {error && <p className="error" role="alert">{error}</p>}
        {isLast && !ready && (
          <p className="muted quiz-remaining">
            未回答が {unanswered.length} 問あります。
            <button type="button" className="link" onClick={() => go(unanswered[0])}>
              問題 {unanswered[0] + 1} へ移動
            </button>
          </p>
        )}
        <div className="quiz-nav-row">
          <button type="button" className="secondary" disabled={index === 0} onClick={() => go(index - 1)}>
            前へ
          </button>
          <span className="muted quiz-keys">← → で移動{q.type === "choice" && ` / 1〜${q.choices.length} で選択`}</span>
          {!isLast && (
            <button type="button" className={ready ? "secondary" : undefined} onClick={() => go(index + 1)}>
              次へ
            </button>
          )}
          {(isLast || ready) && (
            <button type="button" disabled={!ready || submitting} onClick={() => onSubmit(answers)}>
              {submitting ? "採点中…" : "採点する"}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
