import { describe, expect, it } from "vitest";
import { ThinkingLevel } from "@google/genai";
import { describeGeminiError, thinkingConfigFromEnv } from "./client.js";

describe("describeGeminiError", () => {
  const err = (status: unknown) => ({ status });

  it("explains an unavailable model and names it", () => {
    const msg = describeGeminiError(err(404), "old-model");
    expect(msg).toContain("old-model");
    expect(msg).toContain("GEMINI_MODEL");
  });

  it("points at the API key for 401/403", () => {
    expect(describeGeminiError(err(401), "m")).toContain("GEMINI_API_KEY");
    expect(describeGeminiError(err(403), "m")).toContain("GEMINI_API_KEY");
  });

  it("distinguishes quota, server errors and unknown failures", () => {
    expect(describeGeminiError(err(429), "m")).toContain("上限");
    expect(describeGeminiError(err(503), "m")).toContain("一時的");
    expect(describeGeminiError(new Error("boom"), "m")).toBe("Gemini の呼び出しに失敗しました");
  });
});

describe("describeGeminiError (timeouts)", () => {
  it("explains a 504 deadline error as a timeout", () => {
    expect(describeGeminiError({ status: 504 }, "m")).toContain("時間内");
  });
});

describe("thinkingConfigFromEnv", () => {
  it("defaults to LOW, supports other levels, and can be turned off", () => {
    expect(thinkingConfigFromEnv(undefined)).toEqual({ thinkingLevel: ThinkingLevel.LOW });
    expect(thinkingConfigFromEnv("minimal")).toEqual({ thinkingLevel: ThinkingLevel.MINIMAL });
    expect(thinkingConfigFromEnv("HIGH")).toEqual({ thinkingLevel: ThinkingLevel.HIGH });
    expect(thinkingConfigFromEnv("default")).toBeUndefined();
  });
});
