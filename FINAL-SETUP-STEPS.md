# Final Setup Steps

1. Upload every file and folder in this package to the root of the GitHub repository.
2. Import the repository into Vercel with Framework Preset **Other**.
3. Do not add a build command or output directory.
4. Copy variables from `.env.example` into Vercel Project Settings → Environment Variables.
5. Redeploy after adding environment variables.
6. Open `/api/router?action=health` and confirm required integrations show as configured.
7. Add both production and temporary Vercel OAuth callback URLs to the Google OAuth web client.
8. Verify `pajeeseo.pk` in Resend before enabling contact-form email delivery.
9. Replace placeholder Facebook, LinkedIn and X links with official Pajee SEO profile URLs.
10. Connect `pajeeseo.pk` in Vercel Domains and apply the DNS values Vercel provides.
