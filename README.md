# EVC (Escape VibeCoder)

AI に作らせたコードを「作っただけ」で終わらせないための理解度チェック Web アプリ。

GitHub の公開リポジトリ URL を渡すと、Gemini がそのコードを読んで問題を作ります。回答すると、コードをどれだけ理解しているかがスコアで分かります。

- 仕様: [docs/spec.md](docs/spec.md)
- 開発ルール: [docs/workflow.md](docs/workflow.md)

## 技術スタック

| 領域 | 採用 |
|---|---|
| フロント | React + Vite + TypeScript(`/web`) |
| API | Hono + TypeScript、Cloud Run(`/api`) |
| AI | Gemini |
| データ | Firestore |
| 認証 | Firebase Auth(GitHub でログイン) |
| 配信 | Firebase Hosting |
| 秘密情報 | Secret Manager |

## 開発

```sh
npm install
cp .env.example .env        # GEMINI_API_KEY などを設定

npm run dev:api             # API  http://localhost:8080
npm run dev:web             # Web  http://localhost:5173 (/api は API に転送)
npm test                    # API のテスト
npm run typecheck
```

この起動方法では、ログインせずに開発用のユーザーとして使えます(`AUTH` と `VITE_FIREBASE_*` を設定しない場合)。

Gemini / GitHub を使わずに画面だけ確認したいときは、API の代わりにモックを起動します。

```sh
npm run dev:mock -w api
```

ホストに Node を入れずに、Docker だけで API と Web を起動することもできます(`.env` はそのまま読まれます)。

```sh
docker compose -f compose.dev.yaml up                        # Web http://localhost:5173
API_SCRIPT=dev:mock docker compose -f compose.dev.yaml up    # モックで起動
docker compose -f compose.dev.yaml down                      # 停止
```

Web は `0.0.0.0` で待ち受けるので、同じネットワークや Tailscale の他の端末から `http://<このマシンの IP>:5173` で開けます。

Docker で起動したときは、本番と同じくログインが必要です。ログインには Firebase Auth のエミュレータを使い、本物の GitHub アカウントは使いません。「GitHub でログイン」を押して開いた画面で「Add new account」を選び、架空のアカウントを作ります(作ったアカウントは、止めても残ります)。そのため、非公開リポジトリは読めません。「まだ使えません」の画面を試すときは、`ALLOWED_GITHUB_IDS=1 docker compose -f compose.dev.yaml up` のように、架空のアカウントとは違う ID を許可リストに入れて起動します。

問題の質を確かめるときは検証 CLI を使います。

```sh
npm run eval -w api -- https://github.com/owner/repo [--prompt-only] [--dump]
```

デプロイは [docs/deploy.md](docs/deploy.md) を参照してください。

## 機能

- GitHub でログインして使う。一般公開までは、許可リストに入っている人だけが使える
- 公開リポジトリと、自分が読める非公開リポジトリから問題を生成。問題数は本体のコードの総量に応じて 4〜18 問。`QUIZ_PROFILE` で固定もできる
- 選択式は機械採点、記述式は Gemini がルーブリックで採点
- 総合スコア、説明力、AI の詳しい総評
- 間違えたら類似問題、全問正解なら未出題の問題で続けて挑戦
- 全利用者の匿名集計との比較
