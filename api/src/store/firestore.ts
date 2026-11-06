import { randomUUID } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore, type Firestore } from "firebase-admin/firestore";
import type { GradeResult } from "../grading/grade.js";
import { CATEGORIES } from "../quiz/types.js";
import type { Session, SessionStore } from "./session.js";
import { toAverages, type GlobalStats, type StatsStore } from "./stats.js";

/** Firestore の TTL ポリシー(expireAt)で自動削除する前提の保存期間。 */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function getDb(): Firestore {
  if (getApps().length === 0) initializeApp();
  return getFirestore();
}

/**
 * quiz / snippets / result は入れ子が深いので JSON 文字列で保存する。
 * 検索に使う値(overall, categories)だけは別フィールドに置く。
 */
export function serializeSession(s: Session) {
  return {
    createdAt: s.createdAt,
    expireAt: new Date(s.createdAt + RETENTION_MS),
    uid: s.uid ?? null,
    repo: `${s.quiz.repo.owner}/${s.quiz.repo.repo}`,
    quiz: JSON.stringify(s.quiz),
    snippets: JSON.stringify(s.snippets),
    result: s.result ? JSON.stringify(s.result) : null,
  };
}

export function deserializeSession(id: string, d: Record<string, unknown>): Session {
  return {
    id,
    createdAt: Number(d.createdAt),
    uid: typeof d.uid === "string" ? d.uid : undefined,
    quiz: JSON.parse(String(d.quiz)),
    snippets: JSON.parse(String(d.snippets)),
    result: typeof d.result === "string" ? JSON.parse(d.result) : undefined,
  };
}

export class FirestoreSessionStore implements SessionStore {
  constructor(private db: Firestore = getDb()) {}

  private col() {
    return this.db.collection("sessions");
  }

  async create(data: Omit<Session, "id" | "createdAt">): Promise<Session> {
    const session: Session = { ...data, id: randomUUID(), createdAt: Date.now() };
    await this.col().doc(session.id).set(serializeSession(session));
    return session;
  }

  async get(id: string): Promise<Session | undefined> {
    const snap = await this.col().doc(id).get();
    return snap.exists ? deserializeSession(id, snap.data()!) : undefined;
  }

  async saveResult(id: string, result: GradeResult): Promise<void> {
    await this.col()
      .doc(id)
      .update({
        result: JSON.stringify(result),
        overall: result.overall,
        categories: result.categories,
        gradedAt: Date.now(),
      });
  }
}

export class FirestoreStatsStore implements StatsStore {
  constructor(private db: Firestore = getDb()) {}

  private doc() {
    return this.db.collection("stats").doc("global");
  }

  async record(result: GradeResult): Promise<void> {
    const sum: Record<string, FieldValue> = {};
    const n: Record<string, FieldValue> = {};
    for (const c of CATEGORIES) {
      const v = result.categories[c];
      if (v === null) continue;
      sum[c] = FieldValue.increment(v);
      n[c] = FieldValue.increment(1);
    }
    await this.doc().set({ count: FieldValue.increment(1), sum, n }, { merge: true });
  }

  async get(): Promise<GlobalStats> {
    const d = (await this.doc().get()).data() ?? {};
    const pick = (key: "sum" | "n") =>
      Object.fromEntries(CATEGORIES.map((c) => [c, Number(d[key]?.[c] ?? 0)])) as Record<(typeof CATEGORIES)[number], number>;
    return toAverages({ count: Number(d.count ?? 0), sum: pick("sum"), n: pick("n") });
  }
}
