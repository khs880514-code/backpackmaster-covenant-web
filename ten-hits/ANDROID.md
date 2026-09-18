# Android build

The APK is the same game as the web build. Capacitor wraps the Vite output in
`play/` inside a WebView shell — there is no second codebase, and no game logic
lives on the native side.

## Where the APK comes from

The Android SDK cannot be downloaded in the container this repo is developed in
(`dl.google.com` is blocked by the egress policy), so the APK is assembled by
GitHub Actions instead: `.github/workflows/android-apk.yml`.

It runs automatically on every push to `main` or a `claude/**` branch, and can
be started by hand from the **Actions** tab. When the run finishes, download
**`ten-hits-apk`** from the run's *Artifacts* section, unzip it, and install
`app-debug.apk` on the phone (Android 7.0 / API 24 and newer).

The artifact is a **release** build: R8-minified, resource-shrunk, and not
debuggable. With no keystore configured it is signed with Android's standard
debug key, which installs and plays fine but cannot be published to a store.

To sign it with your own key instead, add four repository secrets —
`ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`,
`ANDROID_KEY_PASSWORD` — and the same build picks them up. Nothing else
changes.

> Because the debug key is regenerated on each runner, an APK from one run will
> not install *over* one from another run. Uninstall first, or configure the
> keystore secrets above.

## Building locally

On a machine that has the Android SDK (Android Studio installs it):

```sh
cd ten-hits
npm ci
npm run android:apk    # build -> cap sync -> gradlew assembleRelease
```

The APK lands in `ten-hits/android/app/build/outputs/apk/release/`.

`npm run android:sync` alone rebuilds the web bundle and copies it into the
Android project, which is what you want while iterating in Android Studio.

## What the wrapper sets

| Setting | Value | Why |
| --- | --- | --- |
| `appId` | `com.tenhits.game` | Package name on the device |
| `minSdkVersion` | 24 | WebGL 2 and the WebAudio paths the game needs |
| `webDir` | `../play` | The committed Vite output, shared with the web build |
| `androidScheme` | `https` | Keeps `localStorage` and the audio unlock behaving as on the web |
| `backgroundColor` | `#0b0a0d` | Matches the page so the launch does not flash white |

Everything under `android/app/src/main/assets/public` is copied output and is
git-ignored; never edit it by hand.

## Where the size went

| | before | after |
| --- | ---: | ---: |
| glTF models | 12.52 MB | 5.32 MB |
| JavaScript | 646 KB | 657 KB |
| audio | 375 KB | 375 KB |

`scripts/compress-models.mjs` applies `EXT_meshopt_compression` to every shipped
`.glb`. Geometry, not texture, was the weight: a pose clip carried ~1.7 MB of
vertex buffers behind ~0.2 MB of WebP. The decoder ships inside `three`, costs
22 KB, and `src/render/gltf.ts` attaches it to every loader — which is why the
JavaScript went slightly *up* while the download went down by 7 MB.

Re-run it with `npm run models:compress` after replacing any authored asset; a
file that is already compressed is skipped.
