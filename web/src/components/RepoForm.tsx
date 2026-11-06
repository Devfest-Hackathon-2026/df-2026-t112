import { useState, type FormEvent } from "react";

type Props = { onSubmit: (url: string) => void; error?: string | null };

export function RepoForm({ onSubmit, error }: Props) {
  const [url, setUrl] = useState("");

  const handle = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim()) onSubmit(url.trim());
  };

  return (
    <form className="card repo-form" onSubmit={handle}>
      <h2>リポジトリの理解度をチェック</h2>
      <p className="muted">
        GitHub のリポジトリ URL(公開、またはログイン中の自分の非公開リポジトリ)を入力すると、AI がコードを読んで 18 問のクイズを作ります。
      </p>
      <label htmlFor="repo-url">リポジトリ URL</label>
      <input
        id="repo-url"
        type="text"
        placeholder="https://github.com/owner/repo"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        autoFocus
      />
      {error && <p className="error" role="alert">{error}</p>}
      <button type="submit" disabled={!url.trim()}>
        クイズを作る
      </button>
    </form>
  );
}
