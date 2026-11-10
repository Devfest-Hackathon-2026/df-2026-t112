import type { Consent } from "./types";

/** ログインまわりで、画面に何を出すか。 */
export type AuthStatus =
  | { state: "loading" }
  | { state: "signedOut"; error?: string }
  /** ログインはできたが、許可リストに入っていない。 */
  | { state: "notAllowed" }
  /** API はログインを求めているのに、Web に Firebase の設定が無い。 */
  | { state: "misconfigured" }
  /** ログインはできたが、今の利用規約にまだ同意していない。renewal なら、前の版には同意していた。 */
  | { state: "consent"; renewal: boolean }
  | { state: "ready" };

/** 今の規約(termsVersion)に、18 歳以上の確認とあわせて同意しているか。 */
export function hasAgreed(consent: Consent | null | undefined, termsVersion: string): boolean {
  return consent?.termsVersion === termsVersion && consent.ageConfirmed === true;
}

/**
 * ログインした直後に呼ぶ GET /api/me の結果から、次の状態を決める。
 * error は失敗したときの API のエラーコード(成功なら null)。signedIn は Firebase でログインしているか。
 * consent は API が返した規約への同意、termsVersion は今の規約の版(指定しなければ、同意は確かめない)。
 */
export function statusFromMe(error: string | null, signedIn: boolean, consent?: Consent | null, termsVersion?: string): AuthStatus {
  if (error === null) {
    // 規約への同意は、ログインした人にだけ求める(ログインの無い開発用では求めない)
    if (signedIn && termsVersion !== undefined && !hasAgreed(consent, termsVersion)) {
      return { state: "consent", renewal: consent != null };
    }
    return { state: "ready" };
  }
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
