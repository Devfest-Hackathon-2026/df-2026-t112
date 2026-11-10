import { FirebaseError } from "firebase/app";
import { useState, type ReactNode } from "react";
import { githubIdOf, useAuth } from "../auth";
import { loginErrorMessage } from "../authStatus";
import { Terms } from "./Terms";
import { Wordmark } from "./Wordmark";

/** ログインして、使ってよいと確かめられた人だけに中を見せる。 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  switch (status.state) {
    case "ready":
      return <>{children}</>;
    case "loading":
      return (
        <main>
          <div className="loading" aria-live="polite">
            <div className="spinner" />
          </div>
        </main>
      );
    case "signedOut":
      return <LoginScreen error={status.error} />;
    case "notAllowed":
      return <NotAllowed />;
    case "consent":
      return <ConsentScreen renewal={status.renewal} />;
    case "misconfigured":
      return (
        <Gate>
          <p>ログインの設定がありません。</p>
          <p className="muted">Web のビルドに VITE_FIREBASE_* を設定してください(.env.example を参照)。</p>
        </Gate>
      );
  }
}

function Gate({ children }: { children: ReactNode }) {
  return (
    <main>
      <div className="card gate">
        <h1>
          <Wordmark />
        </h1>
        {children}
      </div>
    </main>
  );
}

/** 規約に同意するチェック。18 歳以上の確認も兼ねる(#37 の consent.ageConfirmed)。 */
function AgreeCheck({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="terms-agree">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      18 歳以上で、この利用規約に同意します
    </label>
  );
}

function LoginScreen({ error }: { error?: string }) {
  const { login } = useAuth();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const handle = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await login();
    } catch (e) {
      setFailure(loginErrorMessage(e instanceof FirebaseError ? e.code : undefined));
    } finally {
      setBusy(false);
    }
  };

  const message = failure ?? error;
  return (
    <Gate>
      <p className="muted">GitHub のアカウントでログインしてください</p>
      <Terms />
      <AgreeCheck checked={agreed} onChange={setAgreed} />
      <button onClick={handle} disabled={busy || !agreed}>
        GitHub でログイン
      </button>
      {message && <p role="alert">{message}</p>}
    </Gate>
  );
}

/** ログインのあとで、今の規約にまだ同意していない人に出す(規約を出す前からログインしていた人や、規約を変えたあと)。 */
function ConsentScreen({ renewal }: { renewal: boolean }) {
  const { agree, logout } = useAuth();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const handle = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await agree();
    } catch {
      setFailure("同意を記録できませんでした。もう一度お試しください");
      setBusy(false);
    }
  };

  return (
    <Gate>
      <p className="muted">
        {renewal ? "利用規約が新しくなりました。続けて使うには、同意をお願いします" : "使う前に、利用規約への同意をお願いします"}
      </p>
      <Terms />
      <AgreeCheck checked={agreed} onChange={setAgreed} />
      <button onClick={handle} disabled={busy || !agreed}>
        同意して始める
      </button>
      {failure && <p role="alert">{failure}</p>}
      <button className="secondary" onClick={logout}>
        ログアウト
      </button>
    </Gate>
  );
}

function NotAllowed() {
  const { user, logout } = useAuth();
  const githubId = githubIdOf(user);
  return (
    <Gate>
      <p>このアカウントは、まだ使えません。</p>
      <p className="muted">
        今は、許可された人だけが使えます。使いたいときは、
        {githubId ? "管理者に次の GitHub ID を伝えてください。" : "管理者に GitHub のユーザー名を伝えてください。"}
      </p>
      {githubId && <p className="gate-id">{githubId}</p>}
      <button className="secondary" onClick={logout}>
        ログアウト
      </button>
    </Gate>
  );
}
