import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

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

/** モデルは世代交代で使えなくなることがある。環境変数 GEMINI_MODEL で差し替えられる。 */
export const DEFAULT_MODEL = "gemini-3.8-flash";

/** Gemini SDK の例外を、画面に出せる原因付きのメッセージにする。 */
export function describeGeminiError(e: unknown, model: string): string {
  const status = (e as { status?: unknown })?.status;
  switch (status) {
    case 400:
      return "Gemini へのリクエストが不正です。モデルが構造化出力に対応しているか確認してください";
    case 401:
    case 403:
      return "Gemini の API キーが無効、または権限がありません。GEMINI_API_KEY を確認してください";
    case 404:
      return `Gemini のモデル「${model}」が使えません。.env の GEMINI_MODEL で利用できるモデルを指定してください`;
    case 429:
      return "Gemini の利用上限に達しました。しばらく待つか、プランの上限を確認してください";
    default:
      return typeof status === "number" && status >= 500
        ? "Gemini 側で一時的なエラーが発生しました。しばらくしてからお試しください"
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
        res = await ai.models.generateContent({
          model,
          contents: user,
          config: {
            systemInstruction: system,
            responseMimeType: "application/json",
            responseJsonSchema: jsonSchema,
            temperature: temperature ?? 0.7,
          },
        });
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
