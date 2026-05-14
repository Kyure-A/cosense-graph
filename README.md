# Cosense Graph

Cosense のページリンクを、Obsidian の graph view に近いフルスクリーンの force graph として表示する小さな Vite アプリです。

## 起動

```bash
npm install
npm run dev
```

Workers 経由の本番に近い挙動をローカル確認する場合は、build 後に Wrangler dev を起動します。

```bash
npm run preview:worker
```

デフォルトでは `help-jp` を読み込みます。`/:projectName` を開くと、その project を初期表示します。

```text
https://cosense-graph.kyre.moe/help-jp
```

上の URL は `https://cosen.se/help-jp` のページリンクをグラフ化します。

Private project をローカルで見る場合は、Cosense の `connect.sid` を含む Cookie を `COSENSE_COOKIE` に入れて dev server を起動してください。

```bash
COSENSE_COOKIE='connect.sid=...' npm run dev
```

## 使っている Cosense API

ローカルでは Vite proxy 経由で次のエンドポイントを呼びます。

```text
/api/pages/:projectName/search/titles
```

返ってくる `title` と `links` からノードとエッジを構築します。

本番では Workers Static Assets の `single-page-application` fallback で `/:projectName` へ直アクセスできます。

## Deploy

本番 deploy は GitHub Actions から Cloudflare Workers へ行う構成です。

必要な GitHub Secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

workflow は [`.github/workflows/deploy.yml`](/Users/kyre/ghq/github.com/Kyure-A/cosense-graph/.github/workflows/deploy.yml) です。`master` への push で `npm run build` を実行し、そのまま `wrangler deploy` で production へ反映します。

手元から同じ deploy を実行する場合は次の script を使います。

```bash
npm run deploy
```

Cosense API は static hosting だけでは proxy できないので、本番では [src/worker.ts](/Users/kyre/ghq/github.com/Kyure-A/cosense-graph/src/worker.ts) の Worker が `/cosense-api/*` を `https://scrapbox.io/api/*` へ中継します。静的 assets は [wrangler.jsonc](/Users/kyre/ghq/github.com/Kyure-A/cosense-graph/wrangler.jsonc) の `assets` 設定で配信します。

private project も本番で見たい場合は、Cloudflare Workers 側の secret に `COSENSE_COOKIE` を設定してください。
