# Deploy Pajee SEO V10.2 on Vercel

## 1. Replace the repository

Remove the previous website files, then upload the **contents** of the V10.2 root ZIP directly to the GitHub repository root. Do not upload an additional outer folder.

## 2. Confirm the root structure

```text
index.html
vercel.json
package.json
api/
lib/
assets/
services/
tools/
results/
reports/
```

## 3. Vercel project settings

```text
Framework Preset: Other
Root Directory: blank
Build Command: blank
Output Directory: blank
```

## 4. Environment variables

Use the variables in `API-KEY-SETUP.md`. For optional Gemini-assisted backlink discovery:

```env
GEMINI_MODEL=gemini-3.5-flash
BACKLINK_GEMINI_ASSIST=true
```

Set `BACKLINK_GEMINI_ASSIST=false` to skip Gemini entirely. Even when it is `true`, quota/model/key failures automatically use public-search fallback queries.

## 5. Fresh deployment

Redeploy the latest GitHub commit without the previous build cache.

## 6. Production checks

Open:

```text
https://YOUR-PROJECT.vercel.app/deployment-check.html
https://YOUR-PROJECT.vercel.app/api/router?action=health
```

Then test Backlink Intelligence twice:

1. Public discovery with a website URL.
2. Search Console import using Latest links, More sample links, or Top linking sites.

The backlink report should continue even when Gemini quota is exhausted. Public search availability and source-page bot restrictions can still affect the size of the verified sample.
