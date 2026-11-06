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

export function createGeminiClient(opts: { apiKey?: string; model?: string } = {}): LlmClient {
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey) throw new LlmError("GEMINI_API_KEY が設定されていません");
  const model = opts.model ?? process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const ai = new GoogleGenAI({ apiKey });

  return {
    async generateJson({ system, user, schema, temperature }) {
      const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
      const res = await ai.models.generateContent({
        model,
        contents: user,
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          responseJsonSchema: jsonSchema,
          temperature: temperature ?? 0.7,
        },
      });
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
