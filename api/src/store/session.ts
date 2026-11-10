import { randomUUID } from "node:crypto";
import type { GradeResult } from "../grading/grade.js";
import type { Answer } from "../grading/scoring.js";
import type { AskedQuestion, Quiz } from "../quiz/types.js";

export type Session = {
  id: string;
  createdAt: number;
  quiz: Quiz;
  /** セッションを作った人(Firebase の uid)。ログインを必須にする前に作られたものは undefined。 */
  uid?: string;
  /** 問題ごとの該当コード。 */
  snippets: Record<string, string>;
  /** 特定の人が書いたコードから出題したときの、その人の GitHub ユーザー名。 */
  author?: string;
  /** 続けて解いているとき、このクイズより前に出した問題。 */
  asked?: AskedQuestion[];
  /**
   * 回答途中の状態(問題の id → 回答)。1 問ずつ保存するので、2 つのタブで答えても上書きし合わない(#32、#34 の D21)。
   * 再読み込みや別の端末で、続きから解くために使う。
   */
  answers?: Record<string, Answer>;
  /** 採点済みなら結果。再採点で Gemini を呼び直さないために保存する。 */
  result?: GradeResult;
};

/** 保存先を差し替えられるようにする(メモリ → Firestore)。 */
export interface SessionStore {
  create(data: Omit<Session, "id" | "createdAt">): Promise<Session>;
  get(id: string): Promise<Session | undefined>;
  saveResult(id: string, result: GradeResult): Promise<void>;
  /** 1 問分の回答を保存する。ほかの問題の回答には触れない。 */
  saveAnswer(id: string, questionId: string, answer: Answer): Promise<void>;
  /** ユーザーの採点済みセッションの結果(新しい順、最大 limit 件)。苦手分析に使う。 */
  listResultsByUid(uid: string, limit: number): Promise<GradeResult[]>;
}

export class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, Session>();

  constructor(
    private ttlMs = 2 * 60 * 60 * 1000,
    private maxSessions = 500,
    private now: () => number = Date.now,
  ) {}

  async create(data: Omit<Session, "id" | "createdAt">): Promise<Session> {
    this.evict();
    const session: Session = { ...data, id: randomUUID(), createdAt: this.now() };
    this.sessions.set(session.id, session);
    return session;
  }

  async get(id: string): Promise<Session | undefined> {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    if (this.now() - s.createdAt > this.ttlMs) {
      this.sessions.delete(id);
      return undefined;
    }
    return s;
  }

  async saveResult(id: string, result: GradeResult): Promise<void> {
    const s = await this.get(id);
    if (s) s.result = result;
  }

  async saveAnswer(id: string, questionId: string, answer: Answer): Promise<void> {
    const s = await this.get(id);
    if (s) s.answers = { ...s.answers, [questionId]: answer };
  }

  async listResultsByUid(uid: string, limit: number): Promise<GradeResult[]> {
    return [...this.sessions.values()]
      .filter((s) => s.uid === uid && s.result && this.now() - s.createdAt <= this.ttlMs)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((s) => s.result!);
  }

  private evict() {
    for (const [id, s] of this.sessions) {
      if (this.now() - s.createdAt > this.ttlMs) this.sessions.delete(id);
    }
    while (this.sessions.size >= this.maxSessions) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
  }
}
