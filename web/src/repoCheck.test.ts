import { describe, expect, it } from "vitest";
import { checkDelay, checkFailure } from "./repoCheck";

describe("checkFailure", () => {
  it.each(["invalid_url", "not_found", "private"])("shows %s as an error", (code) => {
    expect(checkFailure(code, "理由")).toEqual({ state: "error", message: "理由" });
  });

  it.each(["rate_limited", "upstream", "network", "unreachable"])("does not block on %s", (code) => {
    expect(checkFailure(code, "理由")).toEqual({ state: "idle" });
  });
});

describe("checkDelay", () => {
  it("checks a pasted URL right away and waits while typing", () => {
    expect(checkDelay(true)).toBe(0);
    expect(checkDelay(false)).toBeGreaterThan(0);
  });
});
