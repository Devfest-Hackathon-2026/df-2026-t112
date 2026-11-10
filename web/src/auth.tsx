import { GithubAuthProvider, onAuthStateChanged, reauthenticateWithPopup, signInWithPopup, signOut, type User } from "firebase/auth";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, getMe } from "./api";
import { statusFromMe, type AuthStatus } from "./authStatus";
import { firebaseAuth, forgetGithubToken, hasGithubToken, rememberGithubToken } from "./firebase";
import { forgetQuiz } from "./persist";
import { showQuizInUrl } from "./quizUrl";

type AuthState = {
  status: AuthStatus;
  /** Firebase の設定があり、ログインできる。無ければ開発用(ログインなし)。 */
  enabled: boolean;
  user: User | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  /** 非公開リポジトリを読むための GitHub トークンを持っているか(リロードすると消える)。 */
  hasGithubToken: boolean;
  /** GitHub でログインし直して、トークンを取り直す。 */
  reconnectGithub: () => Promise<void>;
};

const Ctx = createContext<AuthState>({
  status: { state: "loading" },
  enabled: false,
  user: null,
  login: async () => {},
  logout: async () => {},
  hasGithubToken: false,
  reconnectGithub: async () => {},
});

export const useAuth = () => useContext(Ctx);

/** GitHub の数字の ID。許可リストに入れてもらうときに使う。 */
export const githubIdOf = (user: User | null) => user?.providerData.find((p) => p.providerId === "github.com")?.uid;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>({ state: "loading" });
  const [tokenHeld, setTokenHeld] = useState(false);
  // ログインし直したあとに、前の人の確認結果で上書きしないようにする
  const generation = useRef(0);

  useEffect(() => {
    /** 使ってよい人かどうかを API に確かめる。 */
    const check = async (signedIn: boolean) => {
      const mine = ++generation.current;
      let error: string | null = null;
      try {
        await getMe();
      } catch (e) {
        error = e instanceof ApiError ? e.code : "unknown";
      }
      if (mine !== generation.current) return;
      const next = statusFromMe(error, signedIn);
      setStatus(next);
      // API が受け付けないログインは捨てる(エミュレータを作り直したときなど)
      if (next.state === "signedOut" && firebaseAuth) await signOut(firebaseAuth);
    };

    if (!firebaseAuth) {
      void check(false);
      return;
    }
    return onAuthStateChanged(firebaseAuth, (u) => {
      setUser(u);
      if (!u) {
        generation.current++;
        // 確認で失敗してログアウトしたときは、そのエラーを残す
        setStatus((s) => (s.state === "signedOut" ? s : { state: "signedOut" }));
        return;
      }
      setStatus({ state: "loading" });
      void check(true);
    });
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      enabled: firebaseAuth !== null,
      user,
      login: async () => {
        if (!firebaseAuth) return;
        rememberGithubToken(await signInWithPopup(firebaseAuth, new GithubAuthProvider()));
        setTokenHeld(hasGithubToken());
      },
      logout: async () => {
        forgetGithubToken();
        setTokenHeld(false);
        // 共有の端末で、次の人が前の人のクイズを開こうとしないようにする(中身はサーバーにあり、本人にしか返さない)
        forgetQuiz();
        showQuizInUrl(null);
        if (firebaseAuth) await signOut(firebaseAuth);
      },
      hasGithubToken: tokenHeld,
      reconnectGithub: async () => {
        const current = firebaseAuth?.currentUser;
        if (!current) return;
        rememberGithubToken(await reauthenticateWithPopup(current, new GithubAuthProvider()));
        setTokenHeld(hasGithubToken());
      },
    }),
    [status, user, tokenHeld],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
