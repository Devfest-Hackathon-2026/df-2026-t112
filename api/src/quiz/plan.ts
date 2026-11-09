import { profileFromEnv, type Profile } from "./profile.js";
import { CATEGORIES, type Category } from "./types.js";

/** 1 回の Gemini 呼び出しで作る問題の内訳。 */
export type ChunkSpec = {
  /** 選択式の category(この順に 1 問ずつ)。 */
  choice: Category[];
  /** 記述式の category。 */
  free: Category[];
};

/** 選択式のカテゴリ配分。均等にして、余りは先頭のカテゴリから割り当てる。 */
export function choiceCounts(total: number, categories: readonly Category[] = CATEGORIES): Record<Category, number> {
  const base = Math.floor(total / categories.length);
  return Object.fromEntries(
    categories.map((c, i) => [c, base + (i < total % categories.length ? 1 : 0)]),
  ) as Record<Category, number>;
}

/** README や見た目の定義は、セキュリティの題材にならない。 */
const NON_CODE_RE = /\.(md|mdx|rst|txt|css|scss|sass|less|svg|json|lock|ya?ml|toml)$/i;

/** 認証、外部入力、秘密情報、外部との通信などを扱うコードの目印。 */
const SECURITY_SURFACE_RE = new RegExp(
  [
    "auth(?!ors?\\b)",
    "passw(or)?d",
    "secret",
    "api[_-]?key",
    "\\btoken",
    "jwt",
    "cookie",
    "\\bsession",
    "csrf",
    "\\bcors\\b",
    "access-control",
    "crypt",
    "sanitize",
    "permission",
    "req(uest)?\\.(body|query|params|headers|form|args)",
    "process\\.env",
    "os\\.environ",
    "getenv",
    "innerhtml",
    "\\beval\\(",
    "\\bexec\\(",
    "\\bspawn\\(",
    "\\bselect\\s.+\\sfrom\\s",
    "\\binsert\\s+into\\b",
    "\\bfetch\\(",
    "axios",
    "xmlhttprequest",
    "https?\\.(get|request)",
    "urlopen",
    "requests\\.(get|post)",
    "<form\\b",
    "<input\\b",
    "<script\\b",
    "localstorage",
  ].join("|"),
  "i",
);

/**
 * このコードで出題できるカテゴリ。セキュリティの題材が無いコードで問題を作らせると、
 * プロンプトで禁止しても無関係な問題を「セキュリティ」として作ってしまうので、配分から外す。
 */
export function availableCategories(files: { path: string; content: string }[]): readonly Category[] {
  const hasSurface = files.some((f) => !NON_CODE_RE.test(f.path) && SECURITY_SURFACE_RE.test(f.content));
  return hasSurface ? CATEGORIES : CATEGORIES.filter((c) => c !== "security");
}

/** freeOffset は記述式を割り当て始めるカテゴリの位置。テストで固定するときだけ指定する。 */
export function planChunks(
  profile: Profile = profileFromEnv(),
  categories: readonly Category[] = CATEGORIES,
  freeOffset: number = Math.floor(Math.random() * categories.length),
): ChunkSpec[] {
  const counts = choiceCounts(profile.choice, categories);

  // 同じカテゴリが 1 つのチャンクに偏らないよう、カテゴリを巡回させて並べてから配る
  const ordered: Category[] = [];
  while (ordered.length < profile.choice) {
    for (const c of categories) {
      if (counts[c] > 0 && ordered.length < profile.choice) {
        ordered.push(c);
        counts[c]--;
      }
    }
  }

  // 記述式は点が下がりやすいので、特定のカテゴリに偏らないよう巡回して割り当てる
  const freeCats = Array.from({ length: profile.free }, (_, i) => categories[(freeOffset + i) % categories.length]);
  const chunks: ChunkSpec[] = Array.from({ length: profile.chunks }, () => ({ choice: [], free: [] }));
  ordered.forEach((c, i) => chunks[i % profile.chunks].choice.push(c));
  freeCats.forEach((c, i) => chunks[i % profile.chunks].free.push(c));
  return chunks;
}

/** チャンクごとに「主に根拠にするファイル」を割り振り、問題の重複を減らす。 */
export function primaryFiles(paths: string[], chunkIndex: number, chunks: number): string[] {
  return chunks <= 1 ? [] : paths.filter((_, i) => i % chunks === chunkIndex);
}
