import { randomUUID } from "node:crypto";
import type { Category, Question } from "../quiz/types.js";

/** 間違えた問題を保存するときに渡す内容。 */
export type MistakeDraft = {
  sessionId: string;
  repo: { owner: string; name: string };
  /** 元の問題の形式。復習はどちらも記述式で行う。 */
  type: Question["type"];
  category: Category;
  /** 元の問題文。 */
  question: string;
  /** 復習で表示する記述式の問題文。 */
  reviewQuestion: string;
  /** 復習の採点基準。画面には回答後にだけ見せる。 */
  rubric: string;
  explanation: string;
  codeRef: Question["codeRef"];
  snippet: string;
};

export type Mistake = MistakeDraft & {
  id: string;
  status: "open" | "resolved";
  wrongCount: number;
  firstWrongAt: number;
  lastAttemptAt: number;
  resolvedAt: number | null;
};

/** 間違えた問題集。アカウントごとに分けて持つ(#37 の users/{uid}/mistakes)。 */
export interface MistakeStore {
  add(uid: string, drafts: MistakeDraft[]): Promise<void>;
  /** 未解決の問題を、最近間違えた順に返す。 */
  listOpen(uid: string, limit: number): Promise<Mistake[]>;
  /** 解決済みの問題を、最近解決した順に返す。 */
  listResolved(uid: string, limit: number): Promise<Mistake[]>;
  get(uid: string, id: string): Promise<Mistake | undefined>;
  /** 復習の結果を記録する。正解なら解決済みにする。不正解なら未解決に戻し、間違えた回数を増やす。 */
  recordAnswer(uid: string, id: string, correct: boolean): Promise<void>;
}

export function newMistake(draft: MistakeDraft, now: number): Mistake {
  return { ...draft, id: randomUUID(), status: "open", wrongCount: 1, firstWrongAt: now, lastAttemptAt: now, resolvedAt: null };
}

export function byRecent(a: Mistake, b: Mistake): number {
  return b.lastAttemptAt - a.lastAttemptAt;
}

export class MemoryMistakeStore implements MistakeStore {
  private byUser = new Map<string, Map<string, Mistake>>();

  constructor(private now: () => number = Date.now) {}

  private of(uid: string): Map<string, Mistake> {
    let mistakes = this.byUser.get(uid);
    if (!mistakes) this.byUser.set(uid, (mistakes = new Map()));
    return mistakes;
  }

  async add(uid: string, drafts: MistakeDraft[]): Promise<void> {
    for (const draft of drafts) {
      const mistake = newMistake(draft, this.now());
      this.of(uid).set(mistake.id, mistake);
    }
  }

  async listOpen(uid: string, limit: number): Promise<Mistake[]> {
    return [...this.of(uid).values()].filter((m) => m.status === "open").sort(byRecent).slice(0, limit);
  }

  async listResolved(uid: string, limit: number): Promise<Mistake[]> {
    return [...this.of(uid).values()].filter((m) => m.status === "resolved").sort(byRecent).slice(0, limit);
  }

  async get(uid: string, id: string): Promise<Mistake | undefined> {
    return this.of(uid).get(id);
  }

  async recordAnswer(uid: string, id: string, correct: boolean): Promise<void> {
    const mistake = this.of(uid).get(id);
    if (!mistake) return;
    const now = this.now();
    mistake.lastAttemptAt = now;
    if (correct) {
      mistake.status = "resolved";
      mistake.resolvedAt = now;
    } else {
      mistake.status = "open";
      mistake.resolvedAt = null;
      mistake.wrongCount++;
    }
  }
}
