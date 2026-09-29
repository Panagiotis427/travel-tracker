# Deploy & package (all $0)

The app builds to a static `dist/` and is an installable, offline PWA. It ships
to the web and, installed from there, to the desktop, both at zero recurring cost.

## Web — GitHub Pages (recommended, you already use GitHub)

A workflow is included at `.github/workflows/deploy.yml`.

1. Create a GitHub repo and push this project to `main`.
2. Repo → Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Every push to `main` builds and deploys. URL: `https://<user>.github.io/<repo>/`.

`base: './'` in `vite.config.ts` makes the build work from the project sub-path,
so no extra config is needed.

## Web — other static hosts (alternative, not set up)

Any static host can serve `dist/`. Cloudflare Pages, for example (commercial use
allowed, no egress fees): connect the GitHub repo in its dashboard with build
command `npm run build` and output directory `dist`.

## Desktop

No separate build. Open the deployed site in Chrome/Edge and use the browser's
**Install** action. It runs offline and gets its own window and icon.

## Android — not planned

The owner's phone is an iPhone, and the web app installs there as a PWA. The
unused Capacitor wrapper (its config, the android:* scripts, the packages and the
background-GPS module) was removed; commit 89b7a85 still has it, with the APK build
steps in this file.

## Notes
- The service worker precaches the app shell + overview/mid globe layers; the
  10m layer, admin-1 files, and the Earth texture are cached on first use.
- No backend is required. Everything is local-first; optional $0 accounts and
  sync across devices are set up as in `docs/SUPABASE.md`.
