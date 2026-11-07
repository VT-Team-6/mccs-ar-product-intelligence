// Distance between two points, in miles.
//
// Mirrors the backend's /api/stores/nearby formula exactly (2 * 3958.8 * asin),
// including the clamp to [0, 1]: two nearly identical points can push the
// operand marginally above 1 through floating point, and asin would then
// return NaN. Keeping one implementation means a distance shown in the app can
// never disagree with one the server computes.

const EARTH_RADIUS_MILES = 3958.8;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function distanceMiles(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
): number {
  const deltaLatitude = toRadians(toLatitude - fromLatitude);
  const deltaLongitude = toRadians(toLongitude - fromLongitude);
  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(fromLatitude)) *
      Math.cos(toRadians(toLatitude)) *
      Math.sin(deltaLongitude / 2) ** 2;

  const clamped = Math.min(1, Math.max(0, haversine));
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(clamped));
}

// The distance to a store, or null when either end has no coordinates.
// Null is deliberately not 0: a store with no location must sort last, not first.
export function distanceToStore(
  from: { latitude: number | null; longitude: number | null },
  to: { latitude: number | null; longitude: number | null },
): number | null {
  if (
    from.latitude === null ||
    from.longitude === null ||
    to.latitude === null ||
    to.longitude === null
  ) {
    return null;
  }
  return distanceMiles(from.latitude, from.longitude, to.latitude, to.longitude);
}

// "2.4 mi", or "0.1 mi" for anything under a tenth so a very close store never
// reads "0.0 mi". Whole numbers keep the row short.
export function formatMiles(miles: number): string {
  const rounded = miles < 0.1 ? 0.1 : miles;
  return `${rounded.toFixed(1)} mi`;
}
