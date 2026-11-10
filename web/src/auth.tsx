import { GithubAuthProvider, onAuthStateChanged, reauthenticateWithPopup, signInWithPopup, signOut, type User } from "firebase/auth";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, getMe, saveConsent } from "./api";
import { hasAgreed, statusFromMe, type AuthStatus } from "./authStatus";
import { TERMS_VERSION } from "./components/Terms";
import { firebaseAuth, forgetGithubToken, hasGithubToken, rememberGithubToken } from "./firebase";
import { forgetQuiz } from "./persist";
import { showQuizInUrl } from "./quizUrl";
import type { Consent } from "./types";

type AuthState = {
  status: AuthStatus;
  /** Firebase の設定があり、ログインできる。無ければ開発用(ログインなし)。 */
  enabled: boolean;
  user: User | null;
  /** API が非公開リポジトリを読むか(PRIVATE_REPOS。Gemini を有料枠にするまでは、本番では読まない)。 */
  privateRepos: boolean;
  /** 規約への同意。同意していなければ null。 */
  consent: Consent | null;
  /** ログインの画面で規約に同意してから呼ぶ。ログインできたら、その同意を記録する。 */
  login: () => Promise<void>;
  /** ログインのあとで、今の規約に同意する。 */
  agree: () => Promise<void>;
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
  privateRepos: false,
  consent: null,
  login: async () => {},
  agree: async () => {},
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
  const [privateRepos, setPrivateRepos] = useState(false);
  const [consent, setConsent] = useState<Consent | null>(null);
  /** ログインの画面で、規約に同意してからログインを押した。ログインできたら、その同意を記録する。 */
  const consentAtLogin = useRef(false);
  // ログインし直したあとに、前の人の確認結果で上書きしないようにする
  const generation = useRef(0);

  useEffect(() => {
    /** 使ってよい人かどうかを API に確かめる。 */
    const check = async (signedIn: boolean) => {
      const mine = ++generation.current;
      let error: string | null = null;
      let readsPrivate = false;
      let agreed: Consent | null = null;
      try {
        const me = await getMe();
        readsPrivate = me.privateRepos === true;
        agreed = me.consent ?? null;
      } catch (e) {
        error = e instanceof ApiError ? e.code : "unknown";
      }
      if (mine !== generation.current) return;
      // ログインの画面で規約に同意してからログインした人は、ここで同意を記録する。記録できなければ、同意の画面を出す
      if (error === null && signedIn && consentAtLogin.current && !hasAgreed(agreed, TERMS_VERSION)) {
        agreed = await saveConsent(TERMS_VERSION).then(
          (r) => r.consent,
          () => agreed,
        );
        if (mine !== generation.current) return;
      }
      consentAtLogin.current = false;
      setPrivateRepos(readsPrivate);
      setConsent(agreed);
      const next = statusFromMe(error, signedIn, agreed, TERMS_VERSION);
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
      privateRepos,
      consent,
      login: async () => {
        if (!firebaseAuth) return;
        consentAtLogin.current = true;
        try {
          rememberGithubToken(await signInWithPopup(firebaseAuth, new GithubAuthProvider()));
        } catch (e) {
          consentAtLogin.current = false;
          throw e;
        }
        setTokenHeld(hasGithubToken());
      },
      agree: async () => {
        const saved = await saveConsent(TERMS_VERSION);
        setConsent(saved.consent);
        setStatus({ state: "ready" });
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
    [status, user, privateRepos, consent, tokenHeld],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
