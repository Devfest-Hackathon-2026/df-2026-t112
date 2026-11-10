import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnswerSaver } from "./answerSaver";
import type { Answer } from "./types";

/** 送った回答を記録する。resolveAll を呼ぶまで送信は終わらない。 */
function recorder() {
  const sent: [string, Answer][] = [];
  const waiting: (() => void)[] = [];
  const send = (id: string, a: Answer) =>
    new Promise<void>((resolve) => {
      sent.push([id, a]);
      waiting.push(resolve);
    });
  const resolveAll = async () => {
    while (waiting.length) waiting.shift()!();
    await vi.runAllTimersAsync();
  };
  return { sent, send, resolveAll };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("AnswerSaver", () => {
  it("sends a choice right away", () => {
    const { sent, send } = recorder();
    new AnswerSaver(send).change("q1", { choice: 2 }, true);
    expect(sent).toEqual([["q1", { choice: 2 }]]);
  });

  it("waits until typing pauses, then sends only the latest text", async () => {
    const { sent, send } = recorder();
    const saver = new AnswerSaver(send, () => {}, 800);
    saver.change("q4", { text: "入" }, false);
    await vi.advanceTimersByTimeAsync(500);
    saver.change("q4", { text: "入力" }, false);
    await vi.advanceTimersByTimeAsync(500);
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(300);
    expect(sent).toEqual([["q4", { text: "入力" }]]);
  });

  it("flushes pending answers before grading and waits for them", async () => {
    const { sent, send, resolveAll } = recorder();
    const saver = new AnswerSaver(send);
    saver.change("q4", { text: "途中" }, false);
    let done = false;
    const flushed = saver.flush().then(() => {
      done = true;
    });
    expect(sent).toEqual([["q4", { text: "途中" }]]);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);
    await resolveAll();
    await flushed;
    expect(done).toBe(true);
  });

  it("sends answers to the same question one after another, so an older answer never lands last", async () => {
    const { sent, send, resolveAll } = recorder();
    const saver = new AnswerSaver(send);
    saver.change("q1", { choice: 0 }, true);
    saver.change("q1", { choice: 3 }, true);
    await vi.advanceTimersByTimeAsync(0);
    // 1 つ目が終わるまで、2 つ目は送らない
    expect(sent).toEqual([["q1", { choice: 0 }]]);
    await resolveAll();
    expect(sent).toEqual([
      ["q1", { choice: 0 }],
      ["q1", { choice: 3 }],
    ]);
  });

  it("reports failures without stopping later saves", async () => {
    const errors: unknown[] = [];
    let calls = 0;
    const saver = new AnswerSaver(
      async () => {
        calls++;
        if (calls === 1) throw new Error("offline");
      },
      (e) => errors.push(e),
    );
    saver.change("q1", { choice: 1 }, true);
    await saver.flush();
    saver.change("q2", { choice: 1 }, true);
    await saver.flush();
    expect(errors).toHaveLength(1);
    expect(calls).toBe(2);
  });

  it("drops waiting answers when the quiz is left", async () => {
    const { sent, send } = recorder();
    const saver = new AnswerSaver(send);
    saver.change("q4", { text: "途中" }, false);
    saver.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toEqual([]);
  });
});
