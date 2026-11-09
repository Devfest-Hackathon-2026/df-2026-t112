export type Limits = {
  maxFiles: number;
  maxFileBytes: number;
  maxCharsPerFile: number;
  maxTotalChars: number;
};

export const LIMITS: Limits = {
  maxFiles: 40,
  maxFileBytes: 100_000,
  maxCharsPerFile: 8_000,
  maxTotalChars: 120_000,
};

const CODE_EXT = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "vue", "svelte", "py", "rb", "go", "rs", "java", "kt",
  "cs", "cpp", "cc", "c", "h", "hpp", "swift", "php", "dart", "lua", "gd", "html", "css", "scss",
  "sql", "sh", "shader", "hlsl",
]);
const KEY_FILES = new Set(["README.md", "package.json", "Dockerfile", "pyproject.toml", "go.mod", "Cargo.toml"]);
const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", "out", ".git", ".next", "vendor", "venv", ".venv", "__pycache__",
  "coverage", "Library", "Temp", "obj", "bin", "Packages", "target",
]);
const SKIP_FILE_RE = /(\.min\.|\.lock$|-lock\.|\.d\.ts$|\.generated\.|\.designer\.)/;
const TEST_RE = /(^|\/)(__tests__|tests?([-_][a-z0-9]+)?|spec|e2e|cypress)(\/|$)|\.(test|spec)\.|(^|\/)tests?\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.(go|py)$/;

/** アプリ本体ではないフォルダ。浅い階層にあると本体より優先されてしまうので、読まない。 */
const LOW_VALUE_DIRS = new Set([
  "example", "examples", "demo", "demos", "sample", "samples", "playground", "fixture", "fixtures",
  "mock", "mocks", "__mocks__", "stories", "__snapshots__", "bench", "benchmark", "benchmarks",
  "doc", "docs", "website",
]);
const CONFIG_FILE_RE = /\.config\.[cm]?[jt]s$/i;

/** 問題の題材としてテストは一部あればよいので、読むファイル数のうちこの割合までにする。 */
const TEST_FILE_RATIO = 1 / 8;
const MIN_TEST_FILES = 2;

export type TreeEntry = { path: string; size: number };

/** リポジトリの本体のコードの総量。上限で切り詰める前の値で、問題数を決めるために使う。 */
export type RepoSize = { files: number; bytes: number };

function ext(path: string): string {
  const name = path.split("/").pop() ?? "";
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

function isReadable(entry: TreeEntry, limits: Limits): boolean {
  const parts = entry.path.split("/");
  const name = parts[parts.length - 1];
  if (parts.slice(0, -1).some((d) => SKIP_DIRS.has(d))) return false;
  if (SKIP_FILE_RE.test(name)) return false;
  if (entry.size === 0 || entry.size > limits.maxFileBytes) return false;
  return KEY_FILES.has(name) || CODE_EXT.has(ext(entry.path));
}

/** 出題の題材になるファイルか。サンプルや設定、サブフォルダの package.json などは読まない。 */
export function isCandidate(entry: TreeEntry, limits: Limits = LIMITS): boolean {
  if (!isReadable(entry, limits)) return false;
  const parts = entry.path.split("/");
  const name = parts[parts.length - 1];
  const dirs = parts.slice(0, -1);
  if (dirs.some((d) => d.startsWith(".") || LOW_VALUE_DIRS.has(d.toLowerCase()))) return false;
  if (name.startsWith(".") || CONFIG_FILE_RE.test(name)) return false;
  return CODE_EXT.has(ext(entry.path)) || parts.length === 1;
}

/** 除外するとコードが残らないリポジトリ(サンプル集など)は、除外せずに読む。 */
function candidates(tree: TreeEntry[], limits: Limits): TreeEntry[] {
  const strict = tree.filter((e) => isCandidate(e, limits));
  return strict.some((e) => CODE_EXT.has(ext(e.path))) ? strict : tree.filter((e) => isReadable(e, limits));
}

/** 小さな値ほど優先度が高い。浅い階層・src 配下・テスト以外を優先する。 */
export function priority(entry: TreeEntry): number {
  const parts = entry.path.split("/");
  const name = parts[parts.length - 1];
  let p = parts.length * 10;
  if (name === "README.md") p -= 100;
  else if (KEY_FILES.has(name)) p -= 15;
  if (parts.some((d) => d === "src" || d === "app" || d === "Scripts" || d === "lib")) p -= 20;
  if (TEST_RE.test(entry.path)) p += 40;
  if (!CODE_EXT.has(ext(entry.path))) p += 5;
  return p;
}

/** 問題数を決めるための規模。テストやサンプルは含めず、本体のコードだけを数える。 */
export function measureSource(tree: TreeEntry[]): RepoSize {
  const source = candidates(tree, LIMITS).filter((e) => CODE_EXT.has(ext(e.path)) && !TEST_RE.test(e.path));
  return { files: source.length, bytes: source.reduce((n, e) => n + e.size, 0) };
}

export function selectFiles(tree: TreeEntry[], limits: Limits = LIMITS): { selected: TreeEntry[]; skipped: number } {
  const sorted = candidates(tree, limits).sort((a, b) => priority(a) - priority(b) || a.path.localeCompare(b.path));
  const estimate = (e: TreeEntry) => Math.min(e.size, limits.maxCharsPerFile);

  // テストの枠を先に確保する。本体で上限まで埋まっても、テストについての問題を作れるように
  const testQuota = Math.max(MIN_TEST_FILES, Math.floor(limits.maxFiles * TEST_FILE_RATIO));
  const tests = sorted.filter((e) => TEST_RE.test(e.path)).slice(0, testQuota);
  const main = sorted.filter((e) => !TEST_RE.test(e.path));

  const selected: TreeEntry[] = [];
  let budget = 0;
  const take = (entries: TreeEntry[], maxFiles: number, maxChars: number) => {
    for (const e of entries) {
      if (selected.length >= maxFiles) break;
      if (budget + estimate(e) > maxChars) continue;
      selected.push(e);
      budget += estimate(e);
    }
  };
  take(main, limits.maxFiles - tests.length, limits.maxTotalChars - tests.reduce((n, e) => n + estimate(e), 0));
  take(tests, limits.maxFiles, limits.maxTotalChars);
  selected.sort((a, b) => priority(a) - priority(b) || a.path.localeCompare(b.path));
  return { selected, skipped: tree.length - selected.length };
}
