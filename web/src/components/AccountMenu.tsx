import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth";

/** 右上のアカウントのアイコン。押すと名前とログアウトを出す。開発用(ログインなし)では出さない。 */
export function AccountMenu() {
  const { enabled, user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!enabled || !user) return null;
  const name = user.displayName ?? "ログイン中";

  return (
    <div className="account" ref={root}>
      <button type="button" className="icon-button avatar-button" aria-label="アカウント" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {user.photoURL ? (
          <img className="avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" />
        ) : (
          <span className="avatar avatar-initial" aria-hidden="true">
            {[...name][0]}
          </span>
        )}
      </button>
      {open && (
        <div className="account-menu" role="menu">
          <p className="account-name">{name}</p>
          <button type="button" role="menuitem" className="secondary block" onClick={logout}>
            ログアウト
          </button>
        </div>
      )}
    </div>
  );
}
