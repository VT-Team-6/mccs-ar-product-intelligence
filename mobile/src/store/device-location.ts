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

/** Everything except a fix: what the UI has to explain. */
export type LocationRefusal = Exclude<DeviceLocation, { status: 'granted' }>;

// Why a location attempt produced no fix, in the shopper's terms. Each one names
// the way forward instead of an error code. Shared by the store sheet and the
// product page so a refusal reads the same wherever it happens.
export function locationProblem(refusal: LocationRefusal): string {
  if (refusal.status === 'denied') {
    return refusal.canAskAgain
      ? 'Location is off for this app. You can allow it next time, or search a ZIP.'
      : 'Location is blocked for this app. Allow it in settings, or search a ZIP.';
  }
  if (refusal.reason === 'services-off') {
    return 'Location services are off on this device. Turn them on, or search a ZIP.';
  }
  if (refusal.reason === 'no-fix') {
    return 'Could not get your location. Try again, or search a ZIP.';
  }
  return 'Could not use your location. Try again, or search a ZIP.';
}

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
