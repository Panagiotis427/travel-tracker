# Deploy & package (all $0)

The app builds to a static `dist/` and is an installable, offline PWA. Three
distribution targets; each stays at zero recurring cost.

## Web — GitHub Pages (recommended, you already use GitHub)

A workflow is included at `.github/workflows/deploy.yml`.

1. Create a GitHub repo and push this project to `main`.
2. Repo → Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Every push to `main` builds and deploys. URL: `https://<user>.github.io/<repo>/`.

`base: './'` in `vite.config.ts` makes the build work from the project sub-path,
so no extra config is needed.

## Web — Cloudflare Pages (best economics, commercial-OK, zero egress)

Option A, CLI:
```
npm run build
npx wrangler login          # one time
npm run deploy:cf           # wrangler pages deploy dist --project-name scratch-globe
```
Option B, dashboard: connect the GitHub repo in Cloudflare Pages with build
command `npm run build` and output directory `dist`.

## Desktop

No separate build. Open the deployed site in Chrome/Edge and use the browser's
**Install** action. It runs offline and gets its own window and icon.

## Android — APK sideload (needs Android Studio + JDK 17)

Capacitor is configured (`capacitor.config.ts`, appId `app.scratchglobe.travel`).
The `android/` folder is generated (gitignored), not committed.

```
npm run build
npm run android:add        # npx cap add android   (first time only)
npm run android:sync       # copy dist into the native project
npm run android:open       # opens Android Studio -> Build > Build APK
```
Install Android Studio (bundles the SDK) and a JDK 17 first; then the commands
above produce a debug APK you can sideload. Photo EXIF import already works
through the file picker inside the Android WebView; a native media-library
plugin (with `ACCESS_MEDIA_LOCATION`) is a later enhancement for full-library
auto-scan.

## Notes
- The service worker precaches the app shell + overview/mid globe layers; the
  10m layer, admin-1 files, and the Earth texture are cached on first use.
- No backend is required. Everything is local-first; optional $0 cloud sync is
  described in `BLUEPRINT.md` §10 if multi-device is ever wanted.
