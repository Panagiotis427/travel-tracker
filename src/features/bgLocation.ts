// Background geolocation (Tier 2, experimental, Android-only). No-ops on web/desktop.
// Uses @capacitor-community/background-geolocation, which runs a foreground service
// and wakes on significant movement (distanceFilter). Each fix is classified + marked.
import { Capacitor, registerPlugin } from '@capacitor/core';

interface BgPosition { latitude: number; longitude: number; }
interface BackgroundGeolocationPlugin {
  addWatcher(
    options: {
      backgroundMessage?: string;
      backgroundTitle?: string;
      requestPermissions?: boolean;
      stale?: boolean;
      distanceFilter?: number;
    },
    callback: (position?: BgPosition, error?: { code: string; message: string }) => void,
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
}

const BG = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

let watcherId: string | null = null;

export async function startBackground(onLoc: (lat: number, lng: number) => void): Promise<boolean> {
  if (!isNative() || watcherId) return false;
  watcherId = await BG.addWatcher(
    {
      backgroundTitle: 'Scratch Globe',
      backgroundMessage: 'Marking countries you enter.',
      requestPermissions: true,
      distanceFilter: 20_000, // metres — wake on ~20 km moves (country-level)
    },
    (pos) => { if (pos) onLoc(pos.latitude, pos.longitude); },
  );
  return true;
}

export async function stopBackground(): Promise<void> {
  if (watcherId) {
    await BG.removeWatcher({ id: watcherId });
    watcherId = null;
  }
}
