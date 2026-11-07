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
export const DEFAULT_MODEL = "gemini-3-flash-preview";

/**
 * 無料枠はモデルごとに 1 日の回数が決まっている(別モデルなら別枠)。
 * 主モデルが使えないとき、この順に試す。GEMINI_FALLBACK_MODELS(カンマ区切り)で変更、空文字で無効。
 */
export const DEFAULT_FALLBACK_MODELS = ["gemini-flash-lite-latest", "gemini-3.1-flash-lite"];

/** 別のモデルなら成功する可能性があるエラーか: 利用枠切れ(429)とモデル終了(404)。 */
export function shouldFallBack(e: unknown): boolean {
  const status = (e as { status?: unknown })?.status;
  return status === 429 || status === 404;
}

export function fallbackModelsFromEnv(value = process.env.GEMINI_FALLBACK_MODELS): string[] {
  if (value === undefined) return DEFAULT_FALLBACK_MODELS;
  return value.split(",").map((m) => m.trim()).filter(Boolean);
}

type GenerateParams = {
  model: string;
  contents: string;
  config: Record<string, unknown>;
};

export type GeminiClientOptions = {
  apiKey?: string;
  model?: string;
  fallbackModels?: string[];
  /** テスト用に差し替える。未指定なら Gemini SDK を使う。 */
  call?: (params: GenerateParams) => Promise<{ text?: string }>;
  now?: () => number;
};

/** 枠切れ・終了したモデルを、しばらく試さない時間。 */
const COOLDOWN_MS = { 429: 10 * 60_000, 404: 60 * 60_000 } as const;

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
      return /per day/i.test(String((e as Error)?.message))
        ? "Gemini の1日あたりの無料枠を使い切りました。時間をおくか、.env の GEMINI_MODEL を別のモデルにするか、課金を有効にしてください"
        : "Gemini の利用上限に達しました。しばらく待ってから、もう一度お試しください";
    default:
      return typeof status === "number" && status >= 500
        ? `Gemini 側で一時的なエラーが発生しました(HTTP ${status})。しばらくしてからお試しください`
        : "Gemini の呼び出しに失敗しました";
  }
}

export function createGeminiClient(opts: GeminiClientOptions = {}): LlmClient {
  const apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY;
  if (!apiKey && !opts.call) throw new LlmError("GEMINI_API_KEY が設定されていません");
  const primary = opts.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
  const models = [...new Set([primary, ...(opts.fallbackModels ?? fallbackModelsFromEnv())])];
  const now = opts.now ?? Date.now;
  const call =
    opts.call ?? ((params: GenerateParams) => new GoogleGenAI({ apiKey }).models.generateContent(params as never));

  /** model -> この時刻までは試さない */
  const skipUntil = new Map<string, number>();

  return {
    async generateJson({ system, user, schema, temperature }) {
      const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
      const config = {
        // 応答が返らないまま待ち続けないようにする
        httpOptions: { timeout: REQUEST_TIMEOUT_MS },
        thinkingConfig: thinkingConfigFromEnv(),
        systemInstruction: system,
        responseMimeType: "application/json",
        responseJsonSchema: jsonSchema,
        temperature: temperature ?? 0.7,
      };

      // 休止中のモデルは飛ばす。全部休止中なら、主モデルから順に試し直す
      const usable = models.filter((m) => (skipUntil.get(m) ?? 0) <= now());
      const order = usable.length > 0 ? usable : models;

      let res: { text?: string } | undefined;
      let lastError: unknown;
      let lastModel = order[0];
      for (const [i, model] of order.entries()) {
        lastModel = model;
        try {
          res = await withRetry(() => call({ model, contents: user, config }), {
            onRetry: (e, attempt, delay) =>
              console.warn(`gemini transient error (HTTP ${(e as { status?: number }).status}), retry ${attempt} in ${delay}ms`),
          });
          if (i > 0) console.warn(`gemini: using fallback model ${model}`);
          break;
        } catch (e) {
          lastError = e;
          const status = (e as { status?: number }).status;
          if (!shouldFallBack(e) || i === order.length - 1) break;
          skipUntil.set(model, now() + COOLDOWN_MS[status as 429 | 404]);
          console.warn(`gemini: ${model} unavailable (HTTP ${status}), trying ${order[i + 1]}`);
        }
      }

      if (!res) {
        console.error("gemini error:", lastError);
        throw new LlmError(describeGeminiError(lastError, lastModel));
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
