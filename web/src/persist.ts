import type { Answers, GradeResult, QuizSession } from "./types";

/** 再読み込みしても進行状況が消えないように、タブ単位(sessionStorage)で保存する。 */
export type Saved = {
  session: QuizSession;
  answers: Answers;
  /** 採点済みなら結果。無ければ回答中。 */
  result?: GradeResult;
};

const KEY = "evc:progress";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** 保存先が使えない環境(プライベートウィンドウなど)でも、アプリ自体は動かす。 */
function defaultStorage(): KeyValueStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isSaved(v: unknown): v is Saved {
  if (typeof v !== "object" || v === null) return false;
  const { session, answers } = v as Partial<Saved>;
  return (
    typeof session?.sessionId === "string" &&
    Array.isArray(session.questions) &&
    typeof answers === "object" &&
    answers !== null
  );
}

export function loadProgress(storage: KeyValueStorage | null = defaultStorage()): Saved | null {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSaved(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveProgress(saved: Saved, storage: KeyValueStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(saved));
  } catch {
    // 容量超過など。保存できなくても、そのまま続けられる
  }
}

export function clearProgress(storage: KeyValueStorage | null = defaultStorage()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // 何もしない
  }
}
