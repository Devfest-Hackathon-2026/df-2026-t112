/** ログインまわりで、画面に何を出すか。 */
export type AuthStatus =
  | { state: "loading" }
  | { state: "signedOut"; error?: string }
  /** ログインはできたが、許可リストに入っていない。 */
  | { state: "notAllowed" }
  /** API はログインを求めているのに、Web に Firebase の設定が無い。 */
  | { state: "misconfigured" }
  | { state: "ready" };

/**
 * ログインした直後に呼ぶ GET /api/me の結果から、次の状態を決める。
 * error は失敗したときの API のエラーコード(成功なら null)。signedIn は Firebase でログインしているか。
 */
export function statusFromMe(error: string | null, signedIn: boolean): AuthStatus {
  if (error === null) return { state: "ready" };
  if (error === "not_allowed") return { state: "notAllowed" };
  if (error === "unauthorized") {
    return signedIn ? { state: "signedOut", error: "ログインできませんでした。もう一度お試しください" } : { state: "misconfigured" };
  }
  // API に届かないなど、ログインとは関係ない失敗。画面は開き、いつものエラー表示に任せる
  return { state: "ready" };
}

/** ログインのポップアップが失敗したときの表示。自分で閉じたときは何も出さない。 */
export function loginErrorMessage(code: string | undefined): string | null {
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return null;
  if (code === "auth/popup-blocked") return "ポップアップがブロックされました。ブラウザの設定で、このサイトのポップアップを許可してください";
  if (code === "auth/user-mismatch") return "ログインしているのとは別の GitHub アカウントが選ばれました";
  return "ログインできませんでした。もう一度お試しください";
}
