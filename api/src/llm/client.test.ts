import { describe, expect, it } from "vitest";
import { ThinkingLevel } from "@google/genai";
import { z } from "zod";
import {
  DEFAULT_FALLBACK_MODELS,
  createGeminiClient,
  describeGeminiError,
  fallbackModelsFromEnv,
  thinkingConfigFromEnv,
} from "./client.js";

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

describe("model fallback", () => {
  const schema = z.object({ ok: z.boolean() });
  const quota = () => Object.assign(new Error("Quota exceeded ... requests per day limit"), { status: 429 });
  const req = { system: "s", user: "u", schema };

  function client(handler: (model: string) => { text?: string } | Error, now = () => 0) {
    const calls: string[] = [];
    const c = createGeminiClient({
      model: "primary",
      fallbackModels: ["backup1", "backup2"],
      now,
      call: async ({ model }) => {
        calls.push(model);
        const r = handler(model);
        if (r instanceof Error) throw r;
        return r;
      },
    });
    return { c, calls };
  }

  it("falls back to the next model when the daily quota is exhausted", async () => {
    const { c, calls } = client((m) => (m === "primary" ? quota() : { text: '{"ok":true}' }));
    expect(await c.generateJson(req)).toEqual({ ok: true });
    expect(calls).toEqual(["primary", "backup1"]);
  });

  it("skips an exhausted model on later calls, then tries it again after the cooldown", async () => {
    let t = 0;
    const { c, calls } = client((m) => (m === "primary" ? quota() : { text: '{"ok":true}' }), () => t);
    await c.generateJson(req);
    await c.generateJson(req);
    expect(calls).toEqual(["primary", "backup1", "backup1"]);
    t = 11 * 60_000;
    await c.generateJson(req);
    expect(calls.slice(3)).toEqual(["primary", "backup1"]);
  });

  it("moves on past a retired model (404) too", async () => {
    const { c, calls } = client((m) => (m === "backup2" ? { text: '{"ok":true}' } : Object.assign(new Error("gone"), { status: m === "primary" ? 404 : 429 })));
    expect(await c.generateJson(req)).toEqual({ ok: true });
    expect(calls).toEqual(["primary", "backup1", "backup2"]);
  });

  it("does not fall back on other errors such as a bad key", async () => {
    const { c, calls } = client(() => Object.assign(new Error("bad key"), { status: 403 }));
    await expect(c.generateJson(req)).rejects.toThrow("GEMINI_API_KEY");
    expect(calls).toEqual(["primary"]);
  });

  it("reports the daily quota clearly when every model is exhausted", async () => {
    const { c, calls } = client(() => quota());
    await expect(c.generateJson(req)).rejects.toThrow("1日あたりの無料枠");
    expect(calls).toEqual(["primary", "backup1", "backup2"]);
  });
});

describe("fallbackModelsFromEnv", () => {
  it("uses defaults, a custom list, or none", () => {
    expect(fallbackModelsFromEnv(undefined)).toEqual(DEFAULT_FALLBACK_MODELS);
    expect(fallbackModelsFromEnv("a, b")).toEqual(["a", "b"]);
    expect(fallbackModelsFromEnv("")).toEqual([]);
  });
});
