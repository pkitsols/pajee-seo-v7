# Deployment checklist

1. Upload folder contents to GitHub repository root.
2. Import repository in Vercel. Framework preset: Other. No build command.
3. Add environment variables from `.env.example`.
4. Deploy and open `/api/router?action=health`.
5. Test every tool with a public URL.
6. Connect a test Google account and verify GSC/GA4 properties.
7. Add real Facebook, LinkedIn and X URLs in the common header/footer before launch.
8. Add `pajeeseo.pk` in Vercel Domains and update OAuth callback if needed.
