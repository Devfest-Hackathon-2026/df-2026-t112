import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Wordmark } from "./components/Wordmark";

const KEY = "evc-access-password";

const read = () => {
  try {
    return sessionStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
};

/** API リクエストに付けるパスワードヘッダー。入力前は空。 */
export function accessHeaders(): Record<string, string> {
  const pw = read();
  return pw ? { "X-App-Password": pw } : {};
}

async function check(password: string): Promise<boolean> {
  try {
    const res = await fetch("/api/access", { headers: password ? { "X-App-Password": password } : {} });
    return res.ok;
  } catch {
    // API に届かないときはゲートを通し、通常のエラー表示に任せる
    return true;
  }
}

/** 共有パスワードを入力しないと中に入れない。パスワード未設定の API なら素通り。タブを閉じると再入力が必要。 */
export function AccessGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"checking" | "locked" | "open">("checking");
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    check(read()).then((ok) => setState(ok ? "open" : "locked"));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(false);
    if (await check(input)) {
      try {
        sessionStorage.setItem(KEY, input);
      } catch {
        /* 保存できなくても、このページの間は通す */
      }
      setState("open");
    } else {
      setError(true);
    }
  };

  if (state === "open") return <>{children}</>;
  if (state === "checking") return null;
  return (
    <main>
      <form className="card gate" onSubmit={submit}>
        <h1>
          <Wordmark />
        </h1>
        <p className="muted">パスワードを入力してください</p>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="パスワード"
        />
        {error && <p role="alert">パスワードが違います</p>}
        <button type="submit" disabled={!input}>
          入る
        </button>
      </form>
    </main>
  );
}
