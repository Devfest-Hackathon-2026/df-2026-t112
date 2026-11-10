export type RepoCheckState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; name: string }
  | { state: "error"; code: string; message: string };

/** 確実に使えないと分かる失敗。これ以外(GitHub の混雑や通信失敗など)は、確認できなかっただけなので送信を止めない。 */
const DEFINITE_FAILURES = new Set(["invalid_url", "not_found", "private"]);

export function checkFailure(code: string, message: string): RepoCheckState {
  return DEFINITE_FAILURES.has(code) ? { state: "error", code, message } : { state: "idle" };
}

/**
 * GitHub でログインし直すと読めるかもしれない失敗か。
 * GitHub のトークンはリロードすると消えるので、そのあとは非公開リポジトリが「見つからない」になる。
 */
export function mayNeedGithubLogin(check: RepoCheckState, hasGithubToken: boolean): boolean {
  return check.state === "error" && (check.code === "not_found" || check.code === "private") && !hasGithubToken;
}

/** 打ち込み途中に問い合わせないよう待つ時間。貼り付けのときは待たない。 */
export function checkDelay(pasted: boolean): number {
  return pasted ? 0 : 500;
}
