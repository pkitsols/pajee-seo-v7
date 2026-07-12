# Deploy on Vercel Hobby

## Why the previous deployment failed

The previous version placed each API endpoint inside `/api`, so Vercel treated each file as a separate Serverless Function. The Hobby deployment then exceeded its Function-count limit.

## What changed

This build keeps only one deployable entry point:

```text
api/router.js
```

All tools still use their original public URLs, for example:

```text
/api/router?action=pagespeed
/api/router?action=site-audit
/api/router?action=schema-intelligence
/api/router?action=google-report
```

`vercel.json` rewrites these URLs to the single router. Tool logic is stored under `lib/handlers/` and is bundled with the router.

## GitHub upload structure

The GitHub repository root must directly contain:

```text
index.html
vercel.json
api/
lib/
tools/
results/
services/
dashboard/
contact/
```

Do not upload an extra outer folder above these files.

## Vercel settings

```text
Framework Preset: Other
Root Directory: leave empty
Build Command: leave empty
Output Directory: leave empty
Install Command: leave default/empty
```

## Environment variables

Copy the names from `.env.example` into:

```text
Vercel → Project → Settings → Environment Variables
```

After adding or changing a key, redeploy the project.

## Production verification

Open:

```text
https://YOUR-DOMAIN/deployment-check.html
```

Then test:

```text
/api/router?action=health
/tools/pagespeed-core-web-vitals/
/tools/website-seo-audit/
/tools/schema-intelligence/
/tools/keyword-intelligence/
/tools/traffic-analytics/
/dashboard/
/contact/
```

## Important maintenance rule

Never add separate `.js`, `.ts`, `.py`, or other runtime files directly inside `/api` unless you intentionally want another deployable Function. Add new tool handlers inside `lib/handlers/` and register them in `api/router.js` plus `vercel.json`.
