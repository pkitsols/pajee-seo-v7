# Vercel Environment Variables — Pajee SEO V11

Add these under **Vercel → Project → Settings → Environment Variables** for Production and Preview.

```env
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash
BACKLINK_GEMINI_ASSIST=true

GOOGLE_PAGESPEED_API_KEY=
GOOGLE_CRUX_API_KEY=
OPENPAGERANK_API_KEY=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://YOUR-PROJECT.vercel.app/api/google/callback
SESSION_SECRET=replace-with-a-long-random-secret

RESEND_API_KEY=
CONTACT_FROM_EMAIL=Pajee SEO <onboarding@resend.dev>
CONTACT_TO_EMAIL=pkitsol@gmail.com
```

## Optional Gemini behaviour for backlinks

```env
BACKLINK_GEMINI_ASSIST=true
```

- `true`: Gemini 3.5 Flash may suggest extra discovery queries.
- `false`: backlink discovery directly uses public-search fallback queries.
- Missing key, exhausted quota, invalid model, permission failure, timeout, or temporary Gemini outage: fallback starts automatically and the report continues.

Use exactly:

```env
GEMINI_MODEL=gemini-3.5-flash
```

Do not use `gemini-3.1-flash`.

## Search Console backlink imports

The browser import supports CSV, semicolon-delimited CSV, TSV, and plain URL/domain lists. Use Search Console's **Latest links**, **More sample links**, or **Top linking sites** export. **Top linked pages** only contains the audited site's destination URLs and is therefore not a backlink-source list.
