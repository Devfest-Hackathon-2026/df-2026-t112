import { useState } from "react";
import { useAuth } from "../auth";

export function AuthButton() {
  const { enabled, user, login, logout } = useAuth();
  const [error, setError] = useState<string | null>(null);

  if (!enabled) return null;

  const handleLogin = async () => {
    setError(null);
    try {
      await login();
    } catch {
      setError("ログインできませんでした");
    }
  };

  return (
    <div className="auth">
      {user ? (
        <>
          <span className="muted">{user.displayName ?? "ログイン中"}</span>
          <button className="link" onClick={logout}>
            ログアウト
          </button>
        </>
      ) : (
        <button className="link" onClick={handleLogin}>
          GitHub でログイン(非公開リポジトリ用)
        </button>
      )}
      {error && <span className="error">{error}</span>}
    </div>
  );
}
