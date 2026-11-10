/**
 * 最後に使ったクイズの ID だけを、ログインした人ごとに覚えておく。サイトを開き直したときに、続きから再開するため。
 * クイズの中身・回答・採点結果はサーバーに置き、ブラウザには残さない(#32、#34 の D21)。
 */
export type LastQuiz = { uid: string; sessionId: string; savedAt: number };

/** サーバーがセッションを残す期間(7 日)に合わせる。 */
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const KEY = "evc:last-quiz";
/** 以前は、クイズと回答を丸ごとこのキーに保存していた。残っていれば消す。 */
const LEGACY_KEY = "evc:progress";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** 保存先が使えない環境(プライベートウィンドウなど)でも、アプリ自体は動かす。 */
function defaultStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function rememberQuiz(uid: string, sessionId: string, storage = defaultStorage(), now = Date.now()): void {
  try {
    const value: LastQuiz = { uid, sessionId, savedAt: now };
    storage?.setItem(KEY, JSON.stringify(value));
    storage?.removeItem(LEGACY_KEY);
  } catch {
    // 容量超過など。覚えられなくても、そのまま続けられる
  }
}

/** その人が最後に使ったクイズの ID。別の人のものや、期間を過ぎたものは返さない。 */
export function lastQuiz(uid: string, storage = defaultStorage(), now = Date.now()): string | null {
  try {
    storage?.removeItem(LEGACY_KEY);
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LastQuiz> | null;
    if (typeof v?.uid !== "string" || typeof v.sessionId !== "string" || typeof v.savedAt !== "number") return null;
    if (v.uid !== uid || now - v.savedAt >= RETENTION_MS) return null;
    return v.sessionId;
  } catch {
    return null;
  }
}

export function forgetQuiz(storage = defaultStorage()): void {
  try {
    storage?.removeItem(KEY);
    storage?.removeItem(LEGACY_KEY);
  } catch {
    // 何もしない
  }
}
