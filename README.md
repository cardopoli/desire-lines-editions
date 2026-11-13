# Desire Lines Editions

Website for the imprint: https://desirelineseditions.co.uk

Hugo site, edited in Sveltia (`/admin/`), built and served by Cloudflare Pages.

## Pages

| Address | What | Edit in Sveltia |
|---|---|---|
| `/` | Statement + latest publications | Pages › Homepage |
| `/catalogue/` | Every publication, newest first | Pages › Catalogue intro |
| `/catalogue/<entry>/` | One publication: cover, details, Read online / PDF | Catalogue |
| `/catalogue/<entry>/read.html` | The full-screen reader (from the This Was Tomorrow site kit) | made automatically when a PDF is attached |
| `/about/` | Publisher details | Pages › About |
| `/manage/` | Dashboard: what's live, quick links | - |

Footer email: Settings › Contact.

## Cloudflare Pages settings

Workers & Pages › Create › Pages › Connect to Git › `cardopoli/desire-lines-editions`

- Framework preset: **Hugo**
- Build command: `hugo --minify`
- Build output directory: `public`
- Environment variable: `HUGO_VERSION` = `0.160.1`

Then Custom domains › add `desirelineseditions.co.uk` (and `www.desirelineseditions.co.uk`).

## Sveltia sign-in

Uses the same worker as This Was Tomorrow (`sveltia-cms-auth.cardopoli.workers.dev`). If that worker has an
`ALLOWED_DOMAINS` variable, add `desirelineseditions.co.uk` to it. Sveltia is pinned to 0.182.0 (see `static/admin/index.html`).

## Local preview

`hugo server` then open http://localhost:1313
