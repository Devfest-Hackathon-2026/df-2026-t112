import { describe, expect, it } from "vitest";
import { isTransient, withRetry } from "./retry.js";

const err = (status: number) => Object.assign(new Error(`status ${status}`), { status });
const noSleep = async () => {};

describe("isTransient", () => {
  it("treats 500/502/503 as transient, but not 504, 4xx or unknown errors", () => {
    expect([500, 502, 503].every((s) => isTransient(err(s)))).toBe(true);
    expect([504, 400, 401, 404, 429].some((s) => isTransient(err(s)))).toBe(false);
    expect(isTransient(new Error("boom"))).toBe(false);
  });
});

describe("withRetry", () => {
  it("retries transient errors and returns the eventual result", async () => {
    let calls = 0;
    const delays: number[] = [];
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw err(503);
        return "ok";
      },
      { sleep: noSleep, onRetry: (_e, _n, d) => delays.push(d) },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(delays).toEqual([1000, 3000]);
  });

  it("gives up after the configured retries and rethrows the last error", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw err(503);
        },
        { sleep: noSleep },
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(calls).toBe(3);
  });

  it("does not retry non-transient errors", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw err(404);
        },
        { sleep: noSleep },
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(calls).toBe(1);
  });
});
