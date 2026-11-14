// The device's own coordinates for the store picker, asked for only when the
// shopper taps "Use my location".
//
// Nothing here throws: every way of failing (permission refused, location
// switched off, no fix, a native error) is a value the sheet can render, so a
// denied permission can never break store selection.

import * as Location from 'expo-location';

// How long to wait for a real fix.
const FIX_TIMEOUT_MS = 12_000;

// A fix from the last couple of minutes still sorts stores correctly 
const LAST_KNOWN_MAX_AGE_MS = 2 * 60 * 1000;
const LAST_KNOWN_ACCURACY_METERS = 1000;

export type DeviceLocation =
  | { status: 'granted'; latitude: number; longitude: number }
  | { status: 'denied'; canAskAgain: boolean }
  | { status: 'unavailable'; reason: 'services-off' | 'no-fix' | 'error' };

export async function locateDevice(): Promise<DeviceLocation> {
  try {
    // Permission can be granted while location is switched off system-wide, so
    // services are checked first
    if (!(await Location.hasServicesEnabledAsync())) {
      return { status: 'unavailable', reason: 'services-off' };
    }

    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      return { status: 'denied', canAskAgain: permission.canAskAgain };
    }

    const position = await oneFix();
    if (position === null) {
      return { status: 'unavailable', reason: 'no-fix' };
    }

    return {
      status: 'granted',
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };
  } catch {
    return { status: 'unavailable', reason: 'error' };
  }
}

// The last known position if it is recent enough, otherwise one live fix.
async function oneFix(): Promise<Location.LocationObject | null> {
  const lastKnown = await Location.getLastKnownPositionAsync({
    maxAge: LAST_KNOWN_MAX_AGE_MS,
    requiredAccuracy: LAST_KNOWN_ACCURACY_METERS,
  }).catch(() => null);
  if (lastKnown !== null) return lastKnown;

  const fix = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  // If the fix fails, the sheet can render a refusal reason, so swallow any error.
  fix.catch(() => null);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), FIX_TIMEOUT_MS);
  });

  try {
    return await Promise.race([fix, timedOut]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
