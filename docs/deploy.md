# デプロイ手順

構成: Firebase Hosting(`web/dist`)が `/api/**` を Cloud Run の `evc-api` に転送します。同一オリジンなので CORS 設定は不要です。

## 事前準備

- GCP プロジェクトを作り、Firebase を有効にする(Blaze プランが必要)。
- `gcloud` と `firebase-tools` をインストールし、ログインする。
- `.firebaserc.example` を `.firebaserc` にコピーして、プロジェクト ID を書く(`.firebaserc` は git に入れない運用でも可)。
- API を有効にする。

```sh
gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com artifactregistry.googleapis.com
```

## 1. シークレット

`.env` ではなく Secret Manager に入れます。

```sh
printf '%s' "<Gemini API キー>" | gcloud secrets create gemini-api-key --data-file=-
printf '%s' "<GitHub トークン(public_repo 読み取りのみ)>" | gcloud secrets create github-token --data-file=-
```

Cloud Run のサービスアカウントに `Secret Manager Secret Accessor` ロールを付けます。

## 2. Firestore

Firestore(Native モード)を `asia-northeast1` に作成し、次を設定します。

```sh
gcloud firestore databases create --location=asia-northeast1
# 7 日で自動削除(sessions の expireAt)
gcloud firestore fields ttls update expireAt --collection-group=sessions --enable-ttl
# Cloud Run のサービスアカウントに読み書き権限
gcloud projects add-iam-policy-binding <project>   --member=serviceAccount:<service-account> --role=roles/datastore.user
```

## 3. API を Cloud Run へ

リポジトリのルートで実行します。

```sh
gcloud run deploy evc-api \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated \
  --max-instances 3 \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest,GITHUB_TOKEN=github-token:latest \
  --set-env-vars STORE=firestore,GEMINI_MODEL=gemini-2.5-flash,RATE_LIMIT_PER_HOUR=10
```

`--source .` はルートの `Dockerfile` を使います。

## 4. Web を Hosting へ

```sh
npm ci
npm run build -w web
firebase deploy --only hosting
```

## 動作確認

```sh
curl https://<project>.web.app/api/health
```

## 注意

- `STORE=firestore` を付けないと、セッションと採点結果はインスタンスのメモリに置かれます。Cloud Run が複数インスタンスに分かれると、結果取得が 404 になります。
- 匿名の全体集計は Firestore の `stats/global` に入り、`GET /api/stats` で読めます。
- レート制限もインスタンス単位です。厳密な制限が必要なら Cloud Armor などを使ってください。
- `--max-instances` は Gemini の課金を抑えるための上限です。
