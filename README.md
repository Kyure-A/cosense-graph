# Cosense Graph

Cosense のページリンクを、Obsidian の graph view に近いフルスクリーンの force graph として表示する小さな Vite アプリです。

## 起動

```bash
npm install
npm run dev
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

`public/_redirects` には、静的ホスティング向けの SPA fallback と Cosense API proxy の rewrite を入れています。
