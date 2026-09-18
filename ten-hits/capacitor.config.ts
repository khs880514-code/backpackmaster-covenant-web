import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Android wrapper around the same Vite bundle the web build serves. `webDir`
 * points at the committed `play/` output, so `npx cap sync android` after
 * `npm run build` is all the packaging step needs.
 */
const config: CapacitorConfig = {
  appId: 'com.tenhits.game',
  appName: 'TEN HITS',
  webDir: '../play',
  android: {
    backgroundColor: '#0b0a0d'
  },
  server: {
    androidScheme: 'https'
  }
};

export default config;
