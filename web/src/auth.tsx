import { initializeApp } from "firebase/app";
import {
  GithubAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

/** Firebase の設定が無ければログイン機能ごと無効にする(匿名利用のみ)。 */
const firebaseAuth: Auth | null = config.apiKey && config.projectId ? getAuth(initializeApp(config)) : null;

type AuthState = {
  enabled: boolean;
  user: User | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
};

/** GitHub のアクセストークンはメモリにだけ置く(localStorage には保存しない)。 */
let githubToken: string | undefined;

/** API リクエストに付ける認証ヘッダー。未ログインなら空。 */
export async function authHeaders(): Promise<Record<string, string>> {
  const user = firebaseAuth?.currentUser;
  if (!user) return {};
  const headers: Record<string, string> = { Authorization: `Bearer ${await user.getIdToken()}` };
  if (githubToken) headers["X-GitHub-Token"] = githubToken;
  return headers;
}

const Ctx = createContext<AuthState>({
  enabled: false,
  user: null,
  login: async () => {},
  logout: async () => {},
});

export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => (firebaseAuth ? onAuthStateChanged(firebaseAuth, setUser) : undefined), []);

  const value = useMemo<AuthState>(
    () => ({
      enabled: firebaseAuth !== null,
      user,
      login: async () => {
        if (!firebaseAuth) return;
        const result = await signInWithPopup(firebaseAuth, new GithubAuthProvider());
        githubToken = GithubAuthProvider.credentialFromResult(result)?.accessToken;
      },
      logout: async () => {
        githubToken = undefined;
        if (firebaseAuth) await signOut(firebaseAuth);
      },
    }),
    [user],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
