import type { Answers, GradeResult, QuizSession } from "./types";

/** 再読み込みやタブを閉じたあとも進行状況が消えないように、期限つきで localStorage に保存する。 */
export type Saved = {
  session: QuizSession;
  answers: Answers;
  /** 採点済みなら結果。無ければ回答中。 */
  result?: GradeResult;
};

/** 最後に回答してから、この時間が過ぎたら保存内容を捨てる。 */
export const RETENTION_MS = 24 * 60 * 60 * 1000;

const KEY = "evc:progress";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Stored = Saved & { savedAt: number };

/** 保存先が使えない環境(プライベートウィンドウなど)でも、アプリ自体は動かす。 */
function defaultStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isStored(v: unknown): v is Stored {
  if (typeof v !== "object" || v === null) return false;
  const { session, answers, savedAt } = v as Partial<Stored>;
  return (
    typeof savedAt === "number" &&
    typeof session?.sessionId === "string" &&
    Array.isArray(session.questions) &&
    typeof answers === "object" &&
    answers !== null
  );
}

export function loadProgress(storage: KeyValueStorage | null = defaultStorage(), now = Date.now()): Saved | null {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isStored(parsed)) return null;
    const { savedAt, ...saved } = parsed;
    if (now - savedAt >= RETENTION_MS) {
      storage?.removeItem(KEY);
      return null;
    }
    return saved;
  } catch {
    return null;
  }
}

export function saveProgress(saved: Saved, storage: KeyValueStorage | null = defaultStorage(), now = Date.now()): void {
  try {
    const stored: Stored = { ...saved, savedAt: now };
    storage?.setItem(KEY, JSON.stringify(stored));
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
