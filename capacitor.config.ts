import type { CapacitorConfig } from '@capacitor/cli';

// Android wrapper config. To build the APK (needs Android Studio + JDK 17):
//   npm run build && npx cap add android && npx cap sync && npx cap open android
const config: CapacitorConfig = {
  appId: 'app.scratchglobe.travel',
  appName: 'Scratch Globe',
  webDir: 'dist',
  backgroundColor: '#0b1f2a',
};

export default config;
