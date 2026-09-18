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

The artifact is a debug build, signed with Android's standard debug key. That is
enough to install and play. Shipping to a store needs a release build signed
with your own keystore:

```sh
cd ten-hits/android
./gradlew assembleRelease   # then sign app-release-unsigned.apk with your key
```

## Building locally

On a machine that has the Android SDK (Android Studio installs it):

```sh
cd ten-hits
npm ci
npm run android:apk    # build -> cap sync -> gradlew assembleDebug
```

The APK lands in `ten-hits/android/app/build/outputs/apk/debug/`.

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
