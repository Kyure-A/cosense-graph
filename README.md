# Cosense Graph

This application visualize Cosense page link as Obsidian graph view.

## Setup

```bash
npm install
npm run dev
```
or

```bash
npm run preview:worker
```

## Deployed page

```text
https://graph.kyre.moe/help-jp
```
This page access below endpoint.

```text
/api/pages/:projectName/search/titles
```

## Deploy

Production deploy is handled by Cloudflare Workers Builds via Connect GitHub.

Use these settings in the Cloudflare dashboard:

- Production branch: `master`
- Build command: `npm run build`
- Deploy command: `npm run deploy:worker`

The Worker configuration lives in `wrangler.jsonc`. Static assets are served from `dist`, and `/cosense-api/*` is routed through the Worker proxy before falling back to static assets.

If private Cosense projects need to work in production, set `COSENSE_COOKIE` as a Cloudflare Worker secret.
