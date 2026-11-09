import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, checkRepo } from "../api";
import { checkDelay, checkFailure, type RepoCheckState } from "../repoCheck";

type Props = { onSubmit: (url: string) => void; error?: string | null };

export function RepoForm({ onSubmit, error }: Props) {
  const [url, setUrl] = useState("");
  const [check, setCheck] = useState<RepoCheckState>({ state: "idle" });
  const pasted = useRef(false);

  useEffect(() => {
    const value = url.trim();
    setCheck({ state: "idle" });
    if (!value) return;

    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setCheck({ state: "checking" });
      try {
        const repo = await checkRepo(value, abort.signal);
        if (!abort.signal.aborted) setCheck({ state: "ok", name: `${repo.owner}/${repo.repo}` });
      } catch (e) {
        if (abort.signal.aborted) return;
        setCheck(e instanceof ApiError ? checkFailure(e.code, e.message) : { state: "idle" });
      }
    }, checkDelay(pasted.current));
    pasted.current = false;

    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [url]);

  const blocked = check.state === "error";

  const handle = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim() && !blocked) onSubmit(url.trim());
  };

  return (
    <form className="hero" onSubmit={handle}>
      <h2>そのコード、説明できますか?</h2>
      <p className="muted">GitHub のリポジトリを入力すると、AI がコードを読んでクイズを作ります。</p>
      <div className="url-row">
        <input
          type="text"
          aria-label="リポジトリ URL"
          aria-invalid={blocked}
          placeholder="https://github.com/owner/repo"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onPaste={() => {
            pasted.current = true;
          }}
          autoFocus
        />
        <button type="submit" disabled={!url.trim() || blocked}>
          クイズを作る
        </button>
      </div>
      <p className={`url-status${blocked ? " error" : check.state === "ok" ? " ok" : ""}`} role="status">
        {check.state === "checking" && "確認しています…"}
        {check.state === "ok" && `✓ ${check.name}`}
        {check.state === "error" && check.message}
      </p>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
