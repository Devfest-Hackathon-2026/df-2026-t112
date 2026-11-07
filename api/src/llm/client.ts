import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { withRetry } from "./retry.js";

export type JsonRequest = {
  system: string;
  user: string;
  /** zod スキーマ。Gemini の構造化出力と、返却値の検証に使う。 */
  schema: z.ZodType;
  temperature?: number;
};

/** テストで差し替えられるように、Gemini への依存はこの interface の裏に隠す。 */
export interface LlmClient {
  generateJson(req: JsonRequest): Promise<unknown>;
}

export class LlmError extends Error {}

const REQUEST_TIMEOUT_MS = 120_000;

/**
 * 思考モードは出力前に時間がかかる。出題・採点は深い推論が要らないので既定は LOW。
 * GEMINI_THINKING_LEVEL=minimal|low|medium|high で変更、default でモデルの既定に戻す。
 */
export function thinkingConfigFromEnv(value = process.env.GEMINI_THINKING_LEVEL): { thinkingLevel: ThinkingLevel } | undefined {
  switch ((value ?? "low").toLowerCase()) {
    case "default":
      return undefined;
    case "minimal":
      return { thinkingLevel: ThinkingLevel.MINIMAL };
    case "medium":
      return { thinkingLevel: ThinkingLevel.MEDIUM };
    case "high":
      return { thinkingLevel: ThinkingLevel.HIGH };
    default:
      return { thinkingLevel: ThinkingLevel.LOW };
  }
}

/** モデルは世代交代で使えなくなることがある。環境変数 GEMINI_MODEL で差し替えられる。 */
export const DEFAULT_MODEL = "gemini-3.8-flash";

/** Gemini SDK の例外を、画面に出せる原因付きのメッセージにする。 */
export function describeGeminiError(e: unknown, model: string): string {
  const status = (e as { status?: unknown })?.status;
  if ((e as { name?: unknown })?.name === "AbortError" || /timed? ?out/i.test(String((e as Error)?.message))) {
    return "Gemini の応答が時間内に返りませんでした。リポジトリが大きすぎる可能性があります";
  }
  switch (status) {
    case 400:
      return "Gemini へのリクエストが不正です。モデルが構造化出力に対応しているか確認してください";
    case 401:
    case 403:
      return "Gemini の API キーが無効、または権限がありません。GEMINI_API_KEY を確認してください";
    case 404:
      return `Gemini のモデル「${model}」が使えません。.env の GEMINI_MODEL で利用できるモデルを指定してください`;
    case 504:
      return "Gemini の応答が時間内に返りませんでした。リポジトリが大きい可能性があります。もう一度お試しください";
    case 429:
      return "Gemini の利用上限に達しました。しばらく待つか、プランの上限を確認してください";
    default:
      return typeof status === "number" && status >= 500
        ? `Gemini 側で一時的なエラーが発生しました(HTTP ${status})。しばらくしてからお試しください`
        : "Gemini の呼び出しに失敗しました";
  }
}

export function createGeminiClient(opts: { apiKey?: string; model?: string } = {}): LlmClient {
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new LlmError("GEMINI_API_KEY が設定されていません");
  const model = opts.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  const ai = new GoogleGenAI({ apiKey });

  return {
    async generateJson({ system, user, schema, temperature }) {
      const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
      let res;
      try {
        res = await withRetry(
          () =>
            ai.models.generateContent({
              model,
              contents: user,
              config: {
                // 応答が返らないまま待ち続けないようにする
                httpOptions: { timeout: REQUEST_TIMEOUT_MS },
                thinkingConfig: thinkingConfigFromEnv(),
                systemInstruction: system,
                responseMimeType: "application/json",
                responseJsonSchema: jsonSchema,
                temperature: temperature ?? 0.7,
              },
            }),
          {
            onRetry: (e, attempt, delay) =>
              console.warn(`gemini transient error (HTTP ${(e as { status?: number }).status}), retry ${attempt} in ${delay}ms`),
          },
        );
      } catch (e) {
        console.error("gemini error:", e);
        throw new LlmError(describeGeminiError(e, model));
      }
      const text = res.text;
      if (!text) throw new LlmError("Gemini の応答が空でした");
      try {
        return JSON.parse(text);
      } catch {
        throw new LlmError("Gemini の応答が JSON として解釈できませんでした");
      }
    },
  };
}
