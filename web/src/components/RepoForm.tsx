import { useState, type FormEvent } from "react";

type Props = { onSubmit: (url: string) => void; error?: string | null };

export function RepoForm({ onSubmit, error }: Props) {
  const [url, setUrl] = useState("");

  const handle = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim()) onSubmit(url.trim());
  };

  return (
    <form className="hero" onSubmit={handle}>
      <h2>そのコード、説明できますか?</h2>
      <p className="muted">GitHub のリポジトリを入力すると、AI がコードを読んでクイズを作ります。</p>
      <div className="url-row">
        <input
          type="text"
          aria-label="リポジトリ URL"
          placeholder="https://github.com/owner/repo"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={!url.trim()}>
          クイズを作る
        </button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  );
}
