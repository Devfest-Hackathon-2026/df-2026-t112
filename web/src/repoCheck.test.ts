import { describe, expect, it } from "vitest";
import { checkDelay, checkFailure, mayNeedGithubLogin } from "./repoCheck";

describe("checkFailure", () => {
  it.each(["invalid_url", "not_found", "private"])("shows %s as an error", (code) => {
    expect(checkFailure(code, "理由")).toEqual({ state: "error", code, message: "理由" });
  });

  it.each(["rate_limited", "upstream", "network", "unreachable"])("does not block on %s", (code) => {
    expect(checkFailure(code, "理由")).toEqual({ state: "idle" });
  });
});

describe("mayNeedGithubLogin", () => {
  it.each(["not_found", "private"])("suggests logging in again when %s and the GitHub token is gone", (code) => {
    expect(mayNeedGithubLogin(checkFailure(code, "理由"), false)).toBe(true);
  });

  it("does not suggest it while the GitHub token is still held", () => {
    expect(mayNeedGithubLogin(checkFailure("not_found", "理由"), true)).toBe(false);
  });

  it("does not suggest it for other results", () => {
    expect(mayNeedGithubLogin(checkFailure("invalid_url", "理由"), false)).toBe(false);
    expect(mayNeedGithubLogin({ state: "ok", name: "o/r" }, false)).toBe(false);
  });
});

describe("checkDelay", () => {
  it("checks a pasted URL right away and waits while typing", () => {
    expect(checkDelay(true)).toBe(0);
    expect(checkDelay(false)).toBeGreaterThan(0);
  });
});
