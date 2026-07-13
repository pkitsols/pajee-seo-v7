# Pajee SEO — Professional Website and Reporting Platform

This is the final multi-page, Vercel Hobby-compatible Pajee SEO website.

## Main product areas

- Conversion-focused homepage and 11 detailed service pages
- Complete SEO Growth Report
- Keyword Intelligence
- PageSpeed and Core Web Vitals
- Whole Website SEO Audit
- Organic Search Performance using verified Search Console data
- Traffic and Behaviour Analytics using verified GA4 data
- Schema Intelligence: analyse, recommend and generate
- AI Summary and 30/60/90-day Execution Roadmap

## Google connection behaviour

The user connects once through read-only Google OAuth. The encrypted session is stored in an HttpOnly, Secure cookie and access tokens are refreshed when possible. Closing the browser does not intentionally disconnect the account. The user remains connected until they disconnect, clear browser cookies, revoke access in Google, or Google invalidates the refresh token. OAuth apps left in Google Testing mode may have shorter refresh-token lifetimes; production publishing is recommended for durable customer connections.

## Vercel Hobby architecture

Only three Serverless Functions are deployed:

1. `api/router.js`
2. `api/google/auth.js`
3. `api/google/callback.js`

The remaining tool actions are consolidated through `/api/router?action=...`.

## Start here

1. Read `DEPLOYMENT-GUIDE.md`.
2. Add the variables listed in `.env.example` to Vercel.
3. Set the exact Google redirect URI to `/api/google/callback`.
4. Deploy and open `/deployment-check.html`.
5. Test the tools using `FINAL-QA-REPORT.md` as the checklist.

No API secrets are included in this folder.
