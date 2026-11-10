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
    expect(enterApp(false, history)).toBe("input");
    expect(history.entries).toEqual([{ screen: "input" }]);
  });

  it("puts the input screen under a restored quiz, so that back stays in the app", () => {
    const history = fakeHistory();
    expect(enterApp(true, history)).toBe("app");
    expect(history.entries).toEqual([{ screen: "input" }, { screen: "app" }]);
  });

  it("stays on the same screen after a reload", () => {
    const history = fakeHistory({ screen: "mistakes" });
    expect(enterApp(true, history)).toBe("mistakes");
    expect(history.entries).toEqual([{ screen: "mistakes" }]);
  });

  it("does not add entries when opened twice", () => {
    const history = fakeHistory();
    enterApp(true, history);
    enterApp(true, history);
    expect(history.entries).toHaveLength(2);
  });

  it("ignores history state written by something else", () => {
    const history = fakeHistory({ screen: "other" });
    expect(enterApp(false, history)).toBe("input");
  });
});
