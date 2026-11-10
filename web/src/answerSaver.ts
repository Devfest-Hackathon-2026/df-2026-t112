import type { Answer } from "./types";

/**
 * 回答を 1 問ずつサーバーに保存する(#32)。
 * - 選択式は選んだらすぐ、記述式は打ち終わって少ししてから送る
 * - 同じ問題を続けて変えたときは、最後の回答だけを送る
 * - 同じ問題の送信は順番に行う(古い回答が後から届いて上書きしないように)
 */
export class AnswerSaver {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private pending = new Map<string, Answer>();
  private chains = new Map<string, Promise<void>>();
  private running = new Set<Promise<void>>();

  constructor(
    private send: (questionId: string, answer: Answer) => Promise<void>,
    private onError: (e: unknown) => void = () => {},
    private delayMs = 800,
  ) {}

  /** 回答が変わった。immediate なら待たずに送る。 */
  change(questionId: string, answer: Answer, immediate: boolean): void {
    this.pending.set(questionId, answer);
    this.clearTimer(questionId);
    if (immediate) this.sendNow(questionId);
    else this.timers.set(questionId, setTimeout(() => this.sendNow(questionId), this.delayMs));
  }

  /** まだ送っていない回答を送り、送り終わるのを待つ(提出の前や、ページを離れるとき)。失敗は onError に渡す。 */
  async flush(): Promise<void> {
    for (const id of [...this.pending.keys()]) this.sendNow(id);
    await Promise.all([...this.running]);
  }

  /** 別のクイズに移るとき。待っている送信をやめる。 */
  dispose(): void {
    for (const id of [...this.timers.keys()]) this.clearTimer(id);
    this.pending.clear();
  }

  private clearTimer(questionId: string): void {
    clearTimeout(this.timers.get(questionId));
    this.timers.delete(questionId);
  }

  private sendNow(questionId: string): void {
    this.clearTimer(questionId);
    const answer = this.pending.get(questionId);
    if (!answer) return;
    this.pending.delete(questionId);
    // 同じ問題の送信が終わっていなければ、その後に送る。無ければ、その場で送る
    const before = this.chains.get(questionId);
    const start = () => new Promise<void>((resolve) => resolve(this.send(questionId, answer)));
    const sent = (before ? before.then(start) : start()).catch(this.onError);
    this.chains.set(questionId, sent);
    this.running.add(sent);
    void sent.then(() => {
      this.running.delete(sent);
      if (this.chains.get(questionId) === sent) this.chains.delete(questionId);
    });
  }
}
