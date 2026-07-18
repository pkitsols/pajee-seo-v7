# Gemini model fix

Use this Vercel environment variable:

```env
GEMINI_MODEL=gemini-3.5-flash
```

Do not include the `models/` prefix. The backend now normalises it if it is accidentally included.

The old hardcoded fallbacks `gemini-2.5-flash` and `gemini-2.5-flash-lite` were removed. Current fallbacks are:

1. the configured `GEMINI_MODEL`
2. `gemini-3.5-flash`
3. `gemini-3.1-flash-lite`

After uploading the changed files, redeploy Vercel without cache and test:

`/api/router?action=health`

Then run Keyword Intelligence or AI Roadmap.
