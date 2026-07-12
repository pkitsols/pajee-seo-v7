# API key setup

## Required for AI tools
- `GEMINI_API_KEY` from Google AI Studio
- `GEMINI_MODEL` defaults to `gemini-2.5-flash`

## Recommended for PageSpeed production quota
- `GOOGLE_PAGESPEED_API_KEY`

## Optional public authority signal
- `OPENPAGERANK_API_KEY`

## Google Search Console and GA4 dashboard
Enable Search Console API, Google Analytics Data API and Google Analytics Admin API. Create an OAuth Web Client and add:
- `https://pajeeseo.pk/api/google/callback`
- your temporary Vercel callback URL

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` and a long random `SESSION_SECRET`.

## Contact form
Set `RESEND_API_KEY` and verify `pajeeseo.pk` in Resend. Set `CONTACT_FROM_EMAIL`.


## Current Vercel-only email setup

Use these values until `pajeeseo.pk` is connected and verified in Resend:

```env
GOOGLE_REDIRECT_URI=https://pkitsols-pajee-seo-v6.vercel.app/api/google/callback
CONTACT_FROM_EMAIL=Pajee SEO <onboarding@resend.dev>
CONTACT_TO_EMAIL=pkitsol@gmail.com
```

Create/login to the Resend account with `pkitsol@gmail.com`. The Resend testing sender can only deliver to the email address associated with that Resend account. After the custom domain is verified, change only `CONTACT_FROM_EMAIL` to `Pajee SEO <website@pajeeseo.pk>`.
