# Pajee SEO — Hobby-plan API Architecture

## Deployment count

- Vercel Function entry points: **1**
- Public API routes: **15**
- Internal handler modules: **15**

## Request flow

```text
Browser tool page
    ↓
Public route such as /api/router?action=site-audit
    ↓
vercel.json rewrite
    ↓
/api/router?action=site-audit
    ↓
api/router.js
    ↓
lib/handlers/site-audit.js
```

## Why handlers do not increase the Function count

The handler files are library modules outside `/api`. They are imported by `api/router.js` and bundled into that single deployable Function.

## Public API compatibility

The frontend did not need to change its API URLs. All existing routes remain available:

- `/api/router?action=health`
- `/api/router?action=pagespeed`
- `/api/router?action=keyword-intelligence`
- `/api/router?action=site-audit`
- `/api/router?action=visibility`
- `/api/router?action=traffic-estimate`
- `/api/router?action=ai-roadmap`
- `/api/router?action=ai-summary`
- `/api/router?action=schema-intelligence`
- `/api/router?action=contact`
- `/api/google/auth`
- `/api/google/callback`
- `/api/router?action=google-status`
- `/api/router?action=google-report`
- `/api/router?action=google-disconnect`

## Runtime safeguards

- Public-URL validation blocks local/private network targets.
- Redirect destinations are revalidated.
- Tool requests have basic per-instance rate limits.
- API responses use `no-store`.
- AI estimates are normalised and labelled.
- Google data is labelled verified only after OAuth access.
- Site audit separates broken links from blocked/unverified links.
- Common Crawl presence is not misrepresented as backlink data.
