import { stripCommentsWithLines } from "./comments.js";
import { isSourceFile, isTestPath, priority, testQuota, type RepoSize, type TreeEntry } from "./filter.js";
import { githubClient, type FetchOptions, type LineRange, type RepoSnapshot } from "./snapshot.js";
import { RepoError, parseRepoUrl } from "./url.js";

/** GitHub API の呼び出しが増えすぎないよう、見るコミットと行単位で調べるファイルを絞る。 */
const MAX_COMMITS = 30;
const MAX_BLAME_FILES = 20;
const MAX_BLAME_TESTS = 4;
const CONCURRENCY = 6;

/** 本人の行の前後に、文脈として残す行数。 */
const CONTEXT_LINES = 20;

const STYLE_RE = /\.(css|scss|sass|less)$/i;

const NO_AUTHORED = "このリポジトリには、あなたが書いたコードが見つからないため、問題を作れません。";

/** 同時に実行する数を絞って、順に処理する。 */
async function mapLimited<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return results;
}

/** GitHub の数字の ID から、今のユーザー名を調べる。 */
export async function findLogin(githubId: string, opts: FetchOptions = {}): Promise<string> {
  const user = await githubClient(opts).getJson<{ login: string }>(`/user/${encodeURIComponent(githubId)}`);
  return user.login;
}

/** その人のコミット(マージコミットは本人が書いたコードではないので除く)。 */
async function ownCommits(client: ReturnType<typeof githubClient>, owner: string, repo: string, login: string) {
  const commits = await client.getJson<{ sha: string; parents: unknown[] }[]>(
    `/repos/${owner}/${repo}/commits?author=${encodeURIComponent(login)}&per_page=100`,
  );
  return commits.filter((c) => c.parents.length <= 1);
}

/** その人のコミットがリポジトリに無ければ、no_authored を投げる。 */
export async function requireOwnCommits(urlInput: string, login: string, opts: FetchOptions = {}): Promise<void> {
  const { owner, repo } = parseRepoUrl(urlInput);
  if ((await ownCommits(githubClient(opts), owner, repo, login)).length === 0) throw new RepoError("no_authored", NO_AUTHORED);
}

type BlameRange = { startingLine: number; endingLine: number; commit: { author: { user: { login: string } | null } | null } };

const BLAME_QUERY = `query($o:String!,$r:String!,$p:String!){repository(owner:$o,name:$r){defaultBranchRef{target{... on Commit{blame(path:$p){ranges{startingLine endingLine commit{author{user{login}}}}}}}}}}`;

/** そのユーザーが書いて、今も残っている行(元のファイルの行番号)。 */
async function blameLines(
  client: ReturnType<typeof githubClient>,
  owner: string,
  repo: string,
  path: string,
  login: string,
): Promise<Set<number>> {
  const res = await client.f("https://api.github.com/graphql", {
    method: "POST",
    headers: client.headers,
    body: JSON.stringify({ query: BLAME_QUERY, variables: { o: owner, r: repo, p: path } }),
  });
  if (res.status === 401) throw new RepoError("token_required", "行ごとの著者を調べるには GitHub トークンが必要です");
  if (res.status === 403 || res.status === 429) {
    throw new RepoError("rate_limited", "GitHub API の制限に達しました。しばらくしてから再度お試しください");
  }
  if (!res.ok) throw new RepoError("upstream", `GitHub API エラー (${res.status})`);
  const body = (await res.json()) as { data?: { repository?: { defaultBranchRef?: { target?: { blame?: { ranges: BlameRange[] } } } } } };
  // 取得できないファイルは飛ばす(バイナリ扱いなど)
  const ranges = body.data?.repository?.defaultBranchRef?.target?.blame?.ranges ?? [];
  const lines = new Set<number>();
  const target = login.toLowerCase();
  for (const r of ranges) {
    if (r.commit.author?.user?.login.toLowerCase() !== target) continue;
    for (let n = r.startingLine; n <= r.endingLine; n++) lines.add(n);
  }
  return lines;
}

/** 行番号の集合を、連続した範囲にまとめる。 */
export function toRanges(lines: number[]): LineRange[] {
  const sorted = [...lines].sort((a, b) => a - b);
  const ranges: LineRange[] = [];
  for (const n of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && n === last.end + 1) last.end = n;
    else ranges.push({ start: n, end: n });
  }
  return ranges;
}

/**
 * 本人の行とその周辺だけを残し、他の行は空行にする。行番号を変えないので、blame の結果や問題の codeRef はそのまま使える。
 * 大きなファイルでも、本人の行が上限で切り捨てられないようにするため。
 */
export function focusOnLines(content: string, mine: number[], context = CONTEXT_LINES): string {
  const keep = new Set<number>();
  for (const line of mine) for (let n = line - context; n <= line + context; n++) keep.add(n);
  return content
    .split("\n")
    .map((line, i) => (keep.has(i + 1) ? line : ""))
    .join("\n");
}

/** Gemini に渡すときは連続する空行を省略するので、その分を除いた長さ。 */
function compactLength(content: string): number {
  return content.replace(/\n{2,}/g, "\n").length;
}

/** 読める量に収まるよう、本人の行を半分ずつ減らす。ファイルごと飛ばすと、本人の主なコードを読めなくなるため。 */
export function fitToBudget(stripped: string, mine: number[], remaining: number): { content: string; mine: number[] } | null {
  for (let lines = mine; lines.length > 0; lines = lines.slice(0, Math.floor(lines.length / 2))) {
    const content = focusOnLines(stripped, lines);
    if (compactLength(content) <= remaining) return { content, mine: lines };
  }
  return null;
}

/**
 * 指定したユーザーが書いたコードを読む。
 * PR の作成者ではなくコミットの著者を基準にし、blame で「その人が書いて今も残っている行」を調べる。
 * コードは本人の行とその周辺を渡し、authored で本人の行を示す。
 */
export async function fetchAuthoredSnapshot(urlInput: string, login: string, opts: FetchOptions = {}): Promise<RepoSnapshot> {
  const { owner, repo } = parseRepoUrl(urlInput);
  if (!opts.token && !opts.fetchImpl) throw new RepoError("token_required", "行ごとの著者を調べるには GitHub トークンが必要です");
  const client = githubClient(opts);
  const meta = await client.getMeta(owner, repo);

  const own = (await ownCommits(client, owner, repo, login)).slice(0, MAX_COMMITS);
  if (own.length === 0) throw new RepoError("no_authored", NO_AUTHORED);

  const details = await mapLimited(own, (c) =>
    client.getJson<{ files?: { filename: string; changes: number }[] }>(`/repos/${owner}/${repo}/commits/${c.sha}`),
  );
  const changes = new Map<string, number>();
  for (const d of details) for (const f of d.files ?? []) changes.set(f.filename, (changes.get(f.filename) ?? 0) + f.changes);

  const branch = encodeURIComponent(meta.default_branch);
  const tree = await client.getJson<{ tree: { path: string; type: string; size?: number }[] }>(
    `/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
  );
  const entries: TreeEntry[] = tree.tree.filter((t) => t.type === "blob").map((t) => ({ path: t.path, size: t.size ?? 0 }));
  // 直近のコミットだけだと、以前に書いた本体のコードを見落とす。直近に触ったファイルの次に、重要なファイルも調べる
  const sources = entries.filter((e) => isSourceFile(e));
  const byChanges = (a: TreeEntry, b: TreeEntry) => changes.get(b.path)! - changes.get(a.path)!;
  const recentCode = sources.filter((e) => changes.has(e.path) && !isTestPath(e.path)).sort(byChanges);
  const otherCode = sources.filter((e) => !changes.has(e.path) && !isTestPath(e.path)).sort((a, b) => priority(a) - priority(b));
  const recentTests = sources.filter((e) => changes.has(e.path) && isTestPath(e.path)).sort(byChanges);
  const toBlame = [...[...recentCode, ...otherCode].slice(0, MAX_BLAME_FILES - MAX_BLAME_TESTS), ...recentTests.slice(0, MAX_BLAME_TESTS)];

  const blamed = await mapLimited(toBlame, async (e) => ({ path: e.path, lines: await blameLines(client, owner, repo, e.path, login) }));
  const withLines = blamed.filter((b) => b.lines.size > 0);

  // コメントを除くと行番号がずれるので、除去後の行番号に直して持つ
  const files = await mapLimited(withLines, async ({ path, lines }) => {
    const { content: stripped, lines: originals } = stripCommentsWithLines(path, await client.getFile(owner, repo, meta.default_branch, path));
    const output = stripped.split("\n");
    const mine = originals.flatMap((original, i) => (lines.has(original) ? [i + 1] : []));
    const chars = mine.reduce((n, line) => n + output[line - 1].length + 1, 0);
    return { path, stripped, mine, chars };
  });
  const available = files.filter((f) => f.mine.length > 0);
  if (available.length === 0) throw new RepoError("no_authored", NO_AUTHORED);

  // 問題の題材としては、見た目の定義よりロジックを優先する
  const isCode = (f: { path: string }) => !isTestPath(f.path) && !STYLE_RE.test(f.path);
  const code = available.filter(isCode);
  const counted = code.length > 0 ? code : available;
  const size: RepoSize = { files: counted.length, bytes: counted.reduce((n, f) => n + f.chars, 0) };
  const limits = typeof opts.limits === "function" ? opts.limits(size) : opts.limits;
  const maxFiles = limits?.maxFiles ?? 40;
  const maxTotalChars = limits?.maxTotalChars ?? 120_000;

  // 本人の行が多いファイルから読む。テストは一部だけにする
  const byChars = [...available].sort((a, b) => b.chars - a.chars);
  const tests = byChars.filter((f) => isTestPath(f.path)).slice(0, limits ? testQuota(limits) : 5);
  const styles = byChars.filter((f) => STYLE_RE.test(f.path));
  const candidates = [...byChars.filter(isCode), ...tests, ...styles];
  const selected: { path: string; content: string; mine: number[] }[] = [];
  let budget = 0;
  for (const f of candidates) {
    if (selected.length >= maxFiles) break;
    const fitted = fitToBudget(f.stripped, f.mine, maxTotalChars - budget);
    if (!fitted) continue;
    selected.push({ path: f.path, ...fitted });
    budget += compactLength(fitted.content);
  }
  if (selected.length === 0) throw new RepoError("no_authored", NO_AUTHORED);

  return {
    owner,
    repo,
    branch: meta.default_branch,
    description: meta.description,
    files: selected.map((f) => ({ path: f.path, content: f.content })),
    skipped: entries.length - selected.length,
    size,
    authored: Object.fromEntries(selected.map((f) => [f.path, toRanges(f.mine)])),
  };
}
