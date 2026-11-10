import { FirebaseError } from "firebase/app";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, checkRepo } from "../api";
import { useAuth } from "../auth";
import { loginErrorMessage } from "../authStatus";
import { githubAppInstallUrl } from "../githubApp";
import { accessFrom, checkDelay, checkFailure, repoHint, type RepoCheckState } from "../repoCheck";
import { Wordmark } from "./Wordmark";

type Props = {
  onSubmit: (url: string) => void;
  error?: string | null;
  /** 保存してあるクイズや結果を開くボタン。 */
  resume?: { label: string; onClick: () => void };
};

export function RepoForm({ onSubmit, error, resume }: Props) {
  const [url, setUrl] = useState("");
  const [check, setCheck] = useState<RepoCheckState>({ state: "idle" });
  const [reconnectError, setReconnectError] = useState<string | null>(null);
  // 増やすと、同じ URL をもう一度確かめる
  const [recheck, setRecheck] = useState(0);
  const pasted = useRef(false);
  const { enabled, hasGithubToken, reconnectGithub } = useAuth();

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
        setCheck(e instanceof ApiError ? checkFailure(e.code, e.message, accessFrom(e.data)) : { state: "idle" });
      }
    }, checkDelay(pasted.current));
    pasted.current = false;

    return () => {
      clearTimeout(timer);
      abort.abort();
    };
    // GitHub でログインし直したときや、GitHub で許可して戻ってきたときも、同じ URL をもう一度確かめる
  }, [url, hasGithubToken, recheck]);

  const hint = repoHint(check, { loginEnabled: enabled, hasGithubToken, canInstall: githubAppInstallUrl !== undefined });

  // GitHub の画面で EVC に許可を出して(リポジトリを足して)、この画面に戻ってきたら確かめ直す
  useEffect(() => {
    if (hint !== "install" && hint !== "configure") return;
    let last = 0;
    const again = () => {
      // 戻ったときは focus と visibilitychange の両方が来ることがあるので、1 回にまとめる
      if (document.visibilityState !== "visible" || Date.now() - last < 1000) return;
      last = Date.now();
      pasted.current = true;
      setRecheck((n) => n + 1);
    };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => {
      window.removeEventListener("focus", again);
      document.removeEventListener("visibilitychange", again);
    };
  }, [hint]);

  const reconnect = async () => {
    setReconnectError(null);
    try {
      pasted.current = true; // 取り直したらすぐに確かめ直す
      await reconnectGithub();
    } catch (e) {
      pasted.current = false;
      setReconnectError(loginErrorMessage(e instanceof FirebaseError ? e.code : undefined));
    }
  };

  const blocked = check.state === "error";

  const handle = (e: FormEvent) => {
    e.preventDefault();
    const value = url.trim();
    if (!value || blocked) return;
    onSubmit(value);
  };

  return (
    <form className="hero" onSubmit={handle}>
      <h1>
        <Wordmark large />
      </h1>
      <p className="hero-tag">そのコード、説明できますか?</p>
      <div className={blocked ? "search invalid" : "search"}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
        </svg>
        <input
          type="text"
          aria-label="リポジトリ URL"
          aria-invalid={blocked}
          placeholder="GitHub のリポジトリ URL を入力"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onPaste={() => {
            pasted.current = true;
          }}
          autoFocus
        />
      </div>
      <p className={`url-status${blocked ? " error" : check.state === "ok" ? " ok" : ""}`} role="status">
        {check.state === "checking" && "確認しています…"}
        {check.state === "ok" && `✓ ${check.name}`}
        {check.state === "error" && check.message}
      </p>
      {hint === "relogin" && (
        <p className="reconnect">
          非公開リポジトリなら、GitHub でログインし直すと読めます。
          <button type="button" className="link" onClick={reconnect}>
            ログインし直す
          </button>
        </p>
      )}
      {hint === "configure" && check.state === "error" && check.access?.kind === "configure" && (
        <div className="reconnect">
          <p>
            非公開リポジトリなら、GitHub で EVC が読めるリポジトリに足すと読めます。
            <a href={check.access.url} target="_blank" rel="noreferrer">
              GitHub で足す
            </a>
          </p>
          <p className="reconnect-note">
            開いた画面の Repository access でこのリポジトリを選び、Save を押してから、この画面に戻ってください。自動で確かめ直します。
          </p>
        </div>
      )}
      {hint === "install" && (
        <div className="reconnect">
          <p>
            非公開リポジトリなら、GitHub で EVC に読む許可を出すと読めます。
            <a href={githubAppInstallUrl} target="_blank" rel="noreferrer">
              GitHub で許可する
            </a>
          </p>
          <p className="reconnect-note">
            開いた画面で読ませるリポジトリを選び、Install を押してから、この画面に戻ってください。自動で確かめ直します。
          </p>
        </div>
      )}
      {reconnectError && <p className="error">{reconnectError}</p>}
      <button type="submit" disabled={!url.trim() || blocked}>
        クイズを作る
      </button>
      {error && <p className="error" role="alert">{error}</p>}
      {resume && (
        <p className="hero-resume">
          <button type="button" className="link" onClick={resume.onClick}>
            {resume.label}
          </button>
        </p>
      )}
      <p className="muted hero-help">AI がコードを読んで、理解度をチェックするクイズを作ります。</p>
    </form>
  );
}
