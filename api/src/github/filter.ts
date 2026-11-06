export const LIMITS = {
  maxFiles: 40,
  maxFileBytes: 100_000,
  maxCharsPerFile: 8_000,
  maxTotalChars: 120_000,
} as const;

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
const TEST_RE = /(^|\/)(__tests__|tests?|spec)(\/|$)|\.(test|spec)\./;

export type TreeEntry = { path: string; size: number };

function ext(path: string): string {
  const name = path.split("/").pop() ?? "";
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function isCandidate(entry: TreeEntry): boolean {
  const parts = entry.path.split("/");
  const name = parts[parts.length - 1];
  if (parts.slice(0, -1).some((d) => SKIP_DIRS.has(d))) return false;
  if (SKIP_FILE_RE.test(name)) return false;
  if (entry.size === 0 || entry.size > LIMITS.maxFileBytes) return false;
  return KEY_FILES.has(name) || CODE_EXT.has(ext(entry.path));
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

export function selectFiles(tree: TreeEntry[]): { selected: TreeEntry[]; skipped: number } {
  const candidates = tree
    .filter(isCandidate)
    .sort((a, b) => priority(a) - priority(b) || a.path.localeCompare(b.path));
  const selected: TreeEntry[] = [];
  let budget = 0;
  for (const e of candidates) {
    if (selected.length >= LIMITS.maxFiles) break;
    const est = Math.min(e.size, LIMITS.maxCharsPerFile);
    if (budget + est > LIMITS.maxTotalChars) continue;
    selected.push(e);
    budget += est;
  }
  return { selected, skipped: tree.length - selected.length };
}
