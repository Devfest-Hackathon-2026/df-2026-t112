import { useEffect, useState } from "react";

export function App() {
  const [apiOk, setApiOk] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setApiOk(d.ok === true))
      .catch(() => setApiOk(false));
  }, []);

  return (
    <main>
      <h1>EVC - Escape VibeCoder</h1>
      <p>API: {apiOk === null ? "確認中" : apiOk ? "OK" : "未接続"}</p>
    </main>
  );
}
