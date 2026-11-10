import { useCallback, useEffect, useState } from "react";
import { ApiError, answerMistake, listMistakes } from "../api";
import type { MistakeAnswer, MistakeItem, ResolvedMistakeItem } from "../types";
import { CodeBlock } from "./CodeBlock";
import { RichText } from "./RichText";

const messageOf = (e: unknown) => (e instanceof ApiError ? e.message : "予期しないエラーが発生しました");

type Folder = { open: MistakeItem[]; resolved: ResolvedMistakeItem[] };

/** 間違えた問題のフォルダ。未解決と解決済みを分けて見せ、未解決の問題を復習できる。 */
export function MistakesView({ onBack }: { onBack: () => void }) {
  const [folder, setFolder] = useState<Folder | null>(null);
  const [tab, setTab] = useState<"open" | "resolved">("open");
  /** 解いている問題。again は解決済みの問題の解き直し。 */
  const [reviewing, setReviewing] = useState<{ items: MistakeItem[]; again: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    listMistakes()
      .then(setFolder)
      .catch((e) => setError(messageOf(e)));
  }, []);

  useEffect(load, [load]);

  if (reviewing) {
    return (
      <MistakeReview
        items={reviewing.items}
        again={reviewing.again}
        onDone={() => {
          setReviewing(null);
          load();
        }}
      />
    );
  }

  if (!folder) {
    return (
      <div className="loading" aria-live="polite">
        {error ? (
          <>
            <p className="error" role="alert">{error}</p>
            <button className="secondary" onClick={onBack}>戻る</button>
          </>
        ) : (
          <div className="spinner" />
        )}
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
            <>
              <button className="primary" onClick={() => setReviewing({ items: folder.open, again: false })}>
                未解決の問題を復習する({folder.open.length} 問)
              </button>
              <ul className="mistake-list">
                {folder.open.map((m) => (
                  <li key={m.id}>
                    <p className="mistake-meta">
                      <span className="status open">未解決</span>
                      <span className="muted">
                        {m.repo.owner}/{m.repo.name} ・ {m.wrongCount} 回間違えた
                      </span>
                    </p>
                    <p className="mistake-question">
                      <RichText text={m.reviewQuestion} />
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ) : (
        <section role="tabpanel">
          {folder.resolved.length === 0 ? (
            <p className="muted mistake-empty">解決済みの問題はまだありません。</p>
          ) : (
            <>
            <button className="primary" onClick={() => setReviewing({ items: folder.resolved, again: true })}>
              解決済みの問題をすべて解き直す({folder.resolved.length} 問)
            </button>
            <p className="muted mistake-note">解き直して 0.7 点に届かなかった問題は、未解決に戻ります。</p>
            <ul className="mistake-list">
              {folder.resolved.map((m) => (
                <li key={m.id}>
                  <p className="mistake-meta">
                    <span className="status resolved">解決済み</span>
                    <span className="muted">
                      {m.repo.owner}/{m.repo.name} ・ {new Date(m.resolvedAt).toLocaleDateString("ja-JP")}
                    </span>
                    <button type="button" className="link mistake-again" onClick={() => setReviewing({ items: [m], again: true })}>
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

      <button className="secondary block mistake-back" onClick={onBack}>
        トップに戻る
      </button>
    </div>
  );
}

/** 問題を、1 問ずつ自分の言葉で説明して復習する。 */
function MistakeReview({ items, again, onDone }: { items: MistakeItem[]; again: boolean; onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const [text, setText] = useState("");
  const [result, setResult] = useState<MistakeAnswer | null>(null);
  const [resolved, setResolved] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const item = items[index];
  if (!item) {
    return (
      <div className="loading">
        <h2>復習が終わりました</h2>
        <p className="muted">
          {items.length} 問中 {resolved} 問を{again ? "正解しました" : "解決しました"}
        </p>
        <button onClick={onDone}>フォルダに戻る</button>
      </div>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const answer = await answerMistake(item.id, text);
      setResult(answer);
      if (answer.correct) setResolved((n) => n + 1);
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const next = () => {
    setIndex((i) => i + 1);
    setText("");
    setResult(null);
    setError(null);
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="quiz">
      <div className="quiz-top">
        <span className="muted quiz-repo">
          間違えた問題の復習 ・ {item.repo.owner}/{item.repo.name}
        </span>
        <span className="quiz-count">
          {index + 1} / {items.length}
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
          <button type="button" className="secondary" onClick={onDone}>
            やめる
          </button>
          <span className="quiz-keys" />
          {result ? (
            <button type="button" onClick={next}>
              {index + 1 < items.length ? "次の問題へ" : "終わる"}
            </button>
          ) : (
            <button type="button" disabled={busy || !text.trim()} onClick={submit}>
              {busy ? "採点中…" : "採点する"}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
