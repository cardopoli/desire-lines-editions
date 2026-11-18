# Desire Lines Editions

Website for the imprint: https://desirelineseditions.co.uk

Hugo site, edited in Sveltia (`/admin/`), built and served by Cloudflare Workers (static assets + a small worker in `src/worker.js`).

## Pages

| Address | What | Edit in Sveltia |
|---|---|---|
| `/` | Statement + latest publications | Pages › Homepage |
| `/catalogue/` | Every publication, newest first | Pages › Catalogue intro |
| `/catalogue/<entry>/` | One publication: cover, details, links, "Also from Desire Lines" | Catalogue |
| `/catalogue/<entry>/read/` | The full-screen reader (from the This Was Tomorrow site kit) | made automatically when a PDF is attached |
| `/pdf/<entry>.pdf` | Clean PDF address (hides the real source, e.g. Dropbox) | automatic |
| `/about/` | Publisher details | Pages › About |
| `/manage/` | Dashboard: what's live, which commit, quick links | - |
| `/tools/studio.html` | Studio: ISBN barcodes, QR codes, colours, type, embeds | Settings › Studio (`static/tools/studio.json`) |
| `/admin/` | Sveltia CMS | - |

Footer email: Settings › Contact.

Colours, fonts and sizes: Settings › Design (`data/design.yml`). Fonts kept in the repo are listed in `data/fonts.yml`
(files in `static/fonts`, all SIL Open Font Licence); any Google font can be used instead by name or link.
The values are written into every page by `layouts/partials/design.html`.

## Cloudflare Workers settings

The site runs as a Worker with static assets, set up in `wrangler.jsonc` (worker name `desire-lines-editions`).
Cloudflare builds it with `npm run build` (`hugo --minify`, Hugo 0.160.1 from the `hugo-extended` package) and serves `public/`.

The worker (`src/worker.js`) only handles four paths; everything else is plain files:

- `/dropbox?u=<share link>` - fetches a public Dropbox link for the reader (dropbox.com only; share as "anyone with the link")
- `/files/<name>` - files from the R2 bucket `desire-lines-files` (binding `FILES`)
- `/pdf/<entry>.pdf` - each publication's PDF at a clean address, looked up in `/_pdf-map.json`
- `/_pdf-map.json` - blocked to visitors (404)

Custom domains: `desirelineseditions.co.uk` (and `www.desirelineseditions.co.uk`).

## Sveltia sign-in

Uses the same worker as This Was Tomorrow (`sveltia-cms-auth.cardopoli.workers.dev`). If that worker has an
`ALLOWED_DOMAINS` variable, add `desirelineseditions.co.uk` to it. Sveltia is pinned to 0.182.0 (see `static/admin/index.html`).

## Local preview

`hugo server` then open http://localhost:1313
