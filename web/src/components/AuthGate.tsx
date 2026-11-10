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

function LoginScreen({ error }: { error?: string }) {
  const { login } = useAuth();
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
      <p className="terms-agree">GitHub でログインすると、この利用規約に同意したものとします。</p>
      <button onClick={handle} disabled={busy}>
        GitHub でログイン
      </button>
      {message && <p role="alert">{message}</p>}
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
