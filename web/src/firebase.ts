import { initializeApp } from "firebase/app";
import { GithubAuthProvider, connectAuthEmulator, getAuth, type Auth, type UserCredential } from "firebase/auth";

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

/** compose.dev.yaml では、本物の GitHub の代わりに Firebase Auth のエミュレータでログインする。 */
export const usingAuthEmulator = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR === "true";

function setup(): Auth | null {
  if (!config.apiKey || !config.projectId) return null;
  const auth = getAuth(initializeApp(config));
  // エミュレータへは Vite が同じオリジンから転送する(Tailscale など、別の端末から開いても届くように)
  if (usingAuthEmulator) connectAuthEmulator(auth, window.location.origin);
  return auth;
}

/** Firebase の設定が無ければ null。そのときは開発用で、API も開発用のユーザーとして動く。 */
export const firebaseAuth: Auth | null = setup();

/**
 * GitHub のアクセストークン。メモリにだけ置く(localStorage には保存しない)ので、リロードすると消える。
 * GitHub App のトークンは 8 時間で切れる。切れていたら、API の応答を見て捨てる(api.ts)。
 */
let githubToken: string | undefined;
const tokenListeners = new Set<() => void>();

function setGithubToken(token: string | undefined): void {
  githubToken = token;
  for (const listener of tokenListeners) listener();
}

export function rememberGithubToken(result: UserCredential): void {
  setGithubToken(GithubAuthProvider.credentialFromResult(result)?.accessToken);
}

export function forgetGithubToken(): void {
  setGithubToken(undefined);
}

/** トークンを覚えたり捨てたりしたときに呼ぶ。返り値で解除する。 */
export function onGithubTokenChange(listener: () => void): () => void {
  tokenListeners.add(listener);
  return () => {
    tokenListeners.delete(listener);
  };
}

export const hasGithubToken = (): boolean => githubToken !== undefined;

/** API リクエストに付ける認証ヘッダー。ログインしていなければ空。 */
export async function authHeaders(): Promise<Record<string, string>> {
  const user = firebaseAuth?.currentUser;
  if (!user) return {};
  const headers: Record<string, string> = { Authorization: `Bearer ${await user.getIdToken()}` };
  // エミュレータが返す GitHub トークンは偽物で、GitHub では使えない
  if (githubToken && !usingAuthEmulator) headers["X-GitHub-Token"] = githubToken;
  return headers;
}
