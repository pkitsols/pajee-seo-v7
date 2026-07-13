# API and OAuth Setup

## Required for AI tools

- `GEMINI_API_KEY`
- `GEMINI_MODEL=gemini-2.5-flash`

AI-based keyword demand and public visibility are explicitly labelled estimates. They are not presented as official Google Ads or analytics figures.

## Performance data

- `GOOGLE_PAGESPEED_API_KEY`
- `GOOGLE_CRUX_API_KEY`

PageSpeed supplies Lighthouse lab data. CrUX supplies real-user field data when the tested origin has enough data. INP is shown only from real field data; TBT is not relabelled as INP.

## Authority signal

- `OPENPAGERANK_API_KEY`

If no verified authority response is available, the UI shows unavailable rather than a fabricated zero.

## Search Console and GA4

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI=https://YOUR-VERCEL-PROJECT.vercel.app/api/google/callback`
- `SESSION_SECRET`

Required Google APIs:

- Search Console API
- Google Analytics Data API
- Google Analytics Admin API

## Contact email

- `RESEND_API_KEY`
- `CONTACT_FROM_EMAIL=Pajee SEO <onboarding@resend.dev>`
- `CONTACT_TO_EMAIL=pkitsol@gmail.com`

All secrets belong in Vercel Environment Variables only.
