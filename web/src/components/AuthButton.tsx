import { useAuth } from "../auth";

/** ログインしている人の名前とログアウト。開発用(ログインなし)では出さない。 */
export function AuthButton() {
  const { enabled, user, logout } = useAuth();
  if (!enabled || !user) return null;

  return (
    <div className="auth">
      <span className="muted">{user.displayName ?? "ログイン中"}</span>
      <button className="link" onClick={logout}>
        ログアウト
      </button>
    </div>
  );
}
