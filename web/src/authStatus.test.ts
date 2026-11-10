import { describe, expect, it } from "vitest";
import { hasAgreed, loginErrorMessage, statusFromMe } from "./authStatus";

describe("statusFromMe", () => {
  it("opens the app when the API accepts the user", () => {
    expect(statusFromMe(null, true)).toEqual({ state: "ready" });
    expect(statusFromMe(null, false)).toEqual({ state: "ready" });
  });

  it("tells users who are not on the allowlist", () => {
    expect(statusFromMe("not_allowed", true)).toEqual({ state: "notAllowed" });
  });

  it("asks to log in again when the API rejects the login", () => {
    expect(statusFromMe("unauthorized", true)).toMatchObject({ state: "signedOut", error: expect.any(String) });
  });

  it("reports a missing Firebase setting when the API wants a login the page cannot offer", () => {
    expect(statusFromMe("unauthorized", false)).toEqual({ state: "misconfigured" });
  });

  it("does not block the app on errors unrelated to login", () => {
    expect(statusFromMe("unreachable", true)).toEqual({ state: "ready" });
    expect(statusFromMe("network", false)).toEqual({ state: "ready" });
  });
});

describe("consent to the terms", () => {
  const current = "2026-11-10";
  const agreed = { termsVersion: current, agreedAt: 1, ageConfirmed: true };

  it("opens the app for people who agreed to the current terms", () => {
    expect(statusFromMe(null, true, agreed, current)).toEqual({ state: "ready" });
  });

  it("asks people who never agreed (for example, logged in before the terms were shown)", () => {
    expect(statusFromMe(null, true, null, current)).toEqual({ state: "consent", renewal: false });
  });

  it("asks again, as a renewal, after the terms change", () => {
    expect(statusFromMe(null, true, { ...agreed, termsVersion: "2026-01-01" }, current)).toEqual({ state: "consent", renewal: true });
  });

  it("needs the age confirmation as part of the consent", () => {
    expect(hasAgreed({ ...agreed, ageConfirmed: false }, current)).toBe(false);
    expect(hasAgreed(agreed, current)).toBe(true);
    expect(hasAgreed(undefined, current)).toBe(false);
  });

  it("does not ask in development mode without a login, or when the API refuses the user", () => {
    expect(statusFromMe(null, false, null, current)).toEqual({ state: "ready" });
    expect(statusFromMe("not_allowed", true, null, current)).toEqual({ state: "notAllowed" });
  });
});

describe("loginErrorMessage", () => {
  it("stays quiet when the user closes the popup", () => {
    expect(loginErrorMessage("auth/popup-closed-by-user")).toBeNull();
    expect(loginErrorMessage("auth/cancelled-popup-request")).toBeNull();
  });

  it("explains a blocked popup", () => {
    expect(loginErrorMessage("auth/popup-blocked")).toContain("ポップアップ");
  });

  it("explains picking a different account when logging in again", () => {
    expect(loginErrorMessage("auth/user-mismatch")).toContain("別の GitHub アカウント");
  });

  it("falls back to a general message", () => {
    expect(loginErrorMessage("auth/network-request-failed")).toBeTruthy();
    expect(loginErrorMessage(undefined)).toBeTruthy();
  });
});
