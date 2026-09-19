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

## Android — APK sideload

Capacitor 8 is configured (`capacitor.config.ts`, appId `app.scratchglobe.travel`).
The `android/` folder is generated (gitignored), not committed.

**Requirements:** JDK **21** (Capacitor 8 needs 21, not 17) and the Android SDK
(platform + build-tools **35**, platform-tools). Android Studio bundles both.

**Path caveat:** Gradle can misbehave when the project path contains a space
(this repo lives under `D:\Code Projects\...`). If a build fails oddly, copy or
clone the project to a space-free path (e.g. `D:\code\travel-tracker`) and build
there.

**Easy path (Android Studio):**
```
npm run build
npm run android:add        # npx cap add android   (first time only)
npm run android:sync       # copy dist into the native project
npm run android:open       # Build > Build Bundle(s)/APK(s) > Build APK(s)
```

**Headless path (no GUI):** install JDK 21 + SDK command-line tools, then:
```
set JAVA_HOME=...\jdk-21     ANDROID_SDK_ROOT=...\android-sdk
sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
npm run build && npx cap sync android
cd android && gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

**Background GPS permissions:** because `android/` is regenerated, re-add these to
`android/app/src/main/AndroidManifest.xml` after `cap add` (already applied in the
current tree): `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`,
`ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`.
The background-geolocation plugin declares `>=3.0.0` for Capacitor and compiles
against the app's `capacitor-android` (v8); if a future plugin bump is needed,
check `@capacitor-community/background-geolocation` for Capacitor-8 support.

Photo EXIF import already works through the file picker in the Android WebView; a
native media-library plugin (with `ACCESS_MEDIA_LOCATION`) is a later enhancement
for full-library auto-scan.

## Notes
- The service worker precaches the app shell + overview/mid globe layers; the
  10m layer, admin-1 files, and the Earth texture are cached on first use.
- No backend is required. Everything is local-first; optional $0 cloud sync is
  described in `BLUEPRINT.md` §10 if multi-device is ever wanted.
