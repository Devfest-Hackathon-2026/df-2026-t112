import { randomUUID } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore, type Firestore } from "firebase-admin/firestore";
import type { GradeResult } from "../grading/grade.js";
import { CATEGORIES } from "../quiz/types.js";
import { byRecent, newMistake, type Mistake, type MistakeDraft, type MistakeStore } from "./mistakes.js";
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
    author: s.author ?? null,
    asked: s.asked ? JSON.stringify(s.asked) : null,
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
    author: typeof d.author === "string" ? d.author : undefined,
    asked: typeof d.asked === "string" ? JSON.parse(d.asked) : undefined,
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

  async listResultsByUid(uid: string, limit: number): Promise<GradeResult[]> {
    // uid の等価条件だけなら複合インデックス不要。並び替えはメモリで行う。
    const snaps = await this.col().where("uid", "==", uid).limit(100).get();
    return snaps.docs
      .map((d) => deserializeSession(d.id, d.data()))
      .filter((s) => s.result)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((s) => s.result!);
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

export function serializeMistake(m: Mistake) {
  const { id: _id, firstWrongAt, lastAttemptAt, resolvedAt, ...rest } = m;
  return {
    ...rest,
    firstWrongAt: Timestamp.fromMillis(firstWrongAt),
    lastAttemptAt: Timestamp.fromMillis(lastAttemptAt),
    resolvedAt: resolvedAt === null ? null : Timestamp.fromMillis(resolvedAt),
  };
}

export function deserializeMistake(id: string, d: Record<string, unknown>): Mistake {
  const millis = (v: unknown) => (v as Timestamp).toMillis();
  return {
    ...(d as Omit<Mistake, "id" | "firstWrongAt" | "lastAttemptAt" | "resolvedAt">),
    id,
    firstWrongAt: millis(d.firstWrongAt),
    lastAttemptAt: millis(d.lastAttemptAt),
    resolvedAt: d.resolvedAt ? millis(d.resolvedAt) : null,
  };
}

export class FirestoreMistakeStore implements MistakeStore {
  constructor(private db: Firestore = getDb()) {}

  private col(uid: string) {
    return this.db.collection("users").doc(uid).collection("mistakes");
  }

  async add(uid: string, drafts: MistakeDraft[]): Promise<void> {
    const batch = this.db.batch();
    for (const draft of drafts) {
      const mistake = newMistake(draft, Date.now());
      batch.set(this.col(uid).doc(mistake.id), serializeMistake(mistake));
    }
    await batch.commit();
  }

  private async listByStatus(uid: string, status: Mistake["status"], limit: number): Promise<Mistake[]> {
    // status の等価条件だけなら複合インデックス不要。並び替えはメモリで行う
    const snaps = await this.col(uid).where("status", "==", status).limit(500).get();
    return snaps.docs.map((d) => deserializeMistake(d.id, d.data())).sort(byRecent).slice(0, limit);
  }

  listOpen(uid: string, limit: number): Promise<Mistake[]> {
    return this.listByStatus(uid, "open", limit);
  }

  listResolved(uid: string, limit: number): Promise<Mistake[]> {
    return this.listByStatus(uid, "resolved", limit);
  }

  async get(uid: string, id: string): Promise<Mistake | undefined> {
    const snap = await this.col(uid).doc(id).get();
    return snap.exists ? deserializeMistake(id, snap.data()!) : undefined;
  }

  async recordAnswer(uid: string, id: string, correct: boolean): Promise<void> {
    const now = Timestamp.now();
    await this.col(uid)
      .doc(id)
      .update(correct ? { status: "resolved", resolvedAt: now, lastAttemptAt: now } : { status: "open", resolvedAt: null, wrongCount: FieldValue.increment(1), lastAttemptAt: now });
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
      if (typeof v !== "number") continue;
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
