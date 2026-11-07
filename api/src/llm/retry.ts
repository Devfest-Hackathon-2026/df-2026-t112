/** 少し待てば直る可能性が高いエラー(Gemini 側の過負荷・内部エラー)か。504 は長く待った後なので除く。 */
export function isTransient(e: unknown): boolean {
  const status = (e as { status?: unknown })?.status;
  return status === 500 || status === 502 || status === 503;
}

export type RetryOptions = {
  /** 失敗してから次の試行までの待ち時間(ms)。要素数が再試行の回数になる。 */
  delaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
};

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const delays = opts.delaysMs ?? [1000, 3000];
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= delays.length || !isTransient(e)) throw e;
      opts.onRetry?.(e, attempt + 1, delays[attempt]);
      await sleep(delays[attempt]);
    }
  }
}
