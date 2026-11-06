import { randomUUID } from "node:crypto";
import type { Quiz } from "../quiz/types.js";

export type Session = {
  id: string;
  createdAt: number;
  quiz: Quiz;
  /** 問題ごとの該当コード。 */
  snippets: Record<string, string>;
};

/** 保存先を差し替えられるようにする(メモリ → Firestore)。 */
export interface SessionStore {
  create(data: Omit<Session, "id" | "createdAt">): Promise<Session>;
  get(id: string): Promise<Session | undefined>;
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
