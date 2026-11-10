import { useCallback, useEffect, useState } from "react";
import { ApiError, answerMistake, listMistakes } from "../api";
import { currentReview, currentScreen, pushScreen, type ReviewRef } from "../nav";
import type { MistakeAnswer, MistakeItem, ResolvedMistakeItem } from "../types";
import { CodeBlock } from "./CodeBlock";
import { RichText } from "./RichText";

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : "予期しないエラーが発生しました");

type Folder = { open: MistakeItem[]; resolved: ResolvedMistakeItem[] };

/** 間違えた問題のフォルダ。未解決と解決済みを分けて見せ、解く問題を自分で選べる。 */
export function MistakesView() {
  const [folder, setFolder] = useState<Folder | null>(null);
  const [tab, setTab] = useState<"open" | "resolved">("open");
  /** 解いている問題。ブラウザの戻るでフォルダに帰れるよう、履歴に合わせる。 */
  const [reviewing, setReviewing] = useState<ReviewRef | null>(currentReview);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    listMistakes()
      .then(setFolder)
      .catch((e) => setError(messageOf(e)));
  }, []);

  useEffect(load, [load]);

  useEffect(() => {
    const onPop = () => {
      const next = currentReview();
      setReviewing(next);
      // 問題からフォルダに帰ったら、解いた結果を一覧に反映する
      if (!next && currentScreen() === "mistakes") load();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [load]);

  const solve = (item: MistakeItem, again: boolean) => {
    const review = { id: item.id, again };
    pushScreen("mistakes", review);
    setReviewing(review);
    window.scrollTo({ top: 0 });
  };

  const solving = reviewing && folder ? [...folder.open, ...folder.resolved].find((m) => m.id === reviewing.id) : undefined;
  if (reviewing && solving) {
    return <MistakeReview key={solving.id} item={solving} again={reviewing.again} onDone={() => window.history.back()} />;
  }

  if (!folder) {
    return (
      <div className="loading" aria-live="polite">
        {error ? <p className="error" role="alert">{error}</p> : <div className="spinner" />}
      </div>
    );
  }

  return (
    <div className="mistake-folder">
      <h2>間違えた問題</h2>

      <div className="tabs" role="tablist" aria-label="問題の状態">
        <button type="button" role="tab" aria-selected={tab === "open"} className={tab === "open" ? "tab active" : "tab"} onClick={() => setTab("open")}>
          未解決 <span className="tab-count">{folder.open.length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === "resolved"} className={tab === "resolved" ? "tab active" : "tab"} onClick={() => setTab("resolved")}>
          解決済み <span className="tab-count">{folder.resolved.length}</span>
        </button>
      </div>

      {error && <p className="error" role="alert">{error}</p>}

      {tab === "open" ? (
        <section role="tabpanel">
          {folder.open.length === 0 ? (
            <p className="muted mistake-empty">未解決の問題はありません。</p>
          ) : (
            <ul className="mistake-list">
              {folder.open.map((m) => (
                <li key={m.id}>
                  <button type="button" className="mistake-row" onClick={() => solve(m, false)}>
                    <span className="mistake-meta">
                      <span className="status open">未解決</span>
                      <span className="muted">
                        {m.repo.owner}/{m.repo.name} ・ {m.wrongCount} 回間違えた
                      </span>
                    </span>
                    <span className="mistake-question">
                      <RichText text={m.reviewQuestion} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <section role="tabpanel">
          {folder.resolved.length === 0 ? (
            <p className="muted mistake-empty">解決済みの問題はまだありません。</p>
          ) : (
            <>
              <p className="muted mistake-note">解き直して 0.7 点に届かなかった問題は、未解決に戻ります。</p>
              <ul className="mistake-list">
                {folder.resolved.map((m) => (
                  <li key={m.id}>
                    <p className="mistake-meta">
                      <span className="status resolved">解決済み</span>
                      <span className="muted">
                        {m.repo.owner}/{m.repo.name} ・ {new Date(m.resolvedAt).toLocaleDateString("ja-JP")}
                      </span>
                      <button type="button" className="link mistake-again" onClick={() => solve(m, true)}>
                        もう一度解く
                      </button>
                    </p>
                    <details>
                      <summary className="mistake-question">
                        <RichText text={m.reviewQuestion} />
                      </summary>
                      <div className="mistake-detail">
                        {m.snippet && <CodeBlock code={m.snippet} startLine={m.codeRef.startLine} />}
                        <h3>満たすべき要点</h3>
                        <p className="pre-wrap">
                          <RichText text={m.rubric} />
                        </p>
                        <h3>解説</h3>
                        <p>
                          <RichText text={m.explanation} />
                        </p>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
    </div>
  );
}

/** 選んだ問題を、自分の言葉で説明して採点する。 */
function MistakeReview({ item, again, onDone }: { item: MistakeItem; again: boolean; onDone: () => void }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<MistakeAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await answerMistake(item.id, text));
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="quiz">
      <div className="quiz-top">
        <span className="muted quiz-repo">
          間違えた問題の復習 ・ {item.repo.owner}/{item.repo.name}
        </span>
      </div>

      <div className="slide-frame">
        <section className={item.snippet ? "slide" : "slide no-code"}>
          <div className="slide-question">
            <h2 className="question-text">
              <RichText text={item.reviewQuestion} />
            </h2>
          </div>

          {item.snippet && (
            <figure className="slide-code">
              <figcaption>
                {item.codeRef.path} L{item.codeRef.startLine}-{item.codeRef.endLine}
              </figcaption>
              <CodeBlock code={item.snippet} startLine={item.codeRef.startLine} />
            </figure>
          )}

          <div className="slide-answer">
            <textarea
              rows={6}
              aria-label="回答"
              placeholder="自分の言葉で説明してください"
              value={text}
              readOnly={busy || result !== null}
              onChange={(e) => setText(e.target.value)}
            />
            {result && (
              <div className={result.correct ? "mistake-result ok" : "mistake-result ng"} role="status">
                <p className="mistake-verdict">
                  {result.correct ? (again ? "正解です" : "解決しました") : again ? "未解決に戻しました" : "もう少しです"}
                  <span className="muted"> ・ {Math.round(result.score * 100)} 点</span>
                </p>
                <p>{result.feedback}</p>
                <h3>満たすべき要点</h3>
                <p className="pre-wrap">
                  <RichText text={result.rubric} />
                </p>
                <h3>解説</h3>
                <p>
                  <RichText text={result.explanation} />
                </p>
              </div>
            )}
          </div>
        </section>
      </div>

      <footer className="quiz-nav">
        {error && <p className="error" role="alert">{error}</p>}
        <div className="quiz-nav-row">
          {result ? (
            <>
              <span className="quiz-keys" />
              <button type="button" onClick={onDone}>
                フォルダに戻る
              </button>
            </>
          ) : (
            <>
              <button type="button" className="secondary" onClick={onDone}>
                やめる
              </button>
              <span className="quiz-keys" />
              <button type="button" disabled={busy || !text.trim()} onClick={submit}>
                {busy ? "採点中…" : "採点する"}
              </button>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}
