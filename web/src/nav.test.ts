import { describe, expect, it } from "vitest";
import { enterApp } from "./nav";

function fakeHistory(state: unknown = null) {
  const entries = [state];
  return {
    entries,
    get state() {
      return entries[entries.length - 1];
    },
    pushState: (next: unknown) => void entries.push(next),
    replaceState: (next: unknown) => void (entries[entries.length - 1] = next),
  } as unknown as History & { entries: unknown[] };
}

describe("enterApp", () => {
  it("starts on the input screen on a first visit", () => {
    const history = fakeHistory();
    expect(enterApp(history)).toBe("input");
    expect(history.entries).toEqual([{ screen: "input" }]);
  });

  it("stays on the same screen after a reload", () => {
    const history = fakeHistory({ screen: "mistakes" });
    expect(enterApp(history)).toBe("mistakes");
    expect(history.entries).toEqual([{ screen: "mistakes" }]);
  });

  it("ignores history state written by something else", () => {
    const history = fakeHistory({ screen: "other" });
    expect(enterApp(history)).toBe("input");
  });
});
