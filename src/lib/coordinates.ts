export interface ParsedCoordinate {
  latitude: number;
  longitude: number;
}

const NUMBER = String.raw`-?\d+(?:\.\d+)?`;
const PATTERNS = [
  new RegExp(String.raw`!3d(${NUMBER})!4d(${NUMBER})`),
  new RegExp(String.raw`@(${NUMBER}),(${NUMBER})`),
  new RegExp(String.raw`[?&](?:q|query|ll)=(${NUMBER}),(${NUMBER})`, "i"),
  new RegExp(String.raw`^\s*(${NUMBER})\s*[,;]\s*(${NUMBER})\s*$`),
];

/**
 * Terima "lat, lng" atau URL Google Maps yang memuat koordinat eksplisit.
 * Link pendek seperti goo.gl/maps/... harus dibuka dulu; koordinatnya tidak
 * bisa ditentukan tanpa mengikuti redirect.
 */
export function parseCoordinateInput(value: string): ParsedCoordinate | null {
  const text = String(value || "").trim();
  if (!text) return null;
  for (const pattern of PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      Math.abs(latitude) <= 90 &&
      Math.abs(longitude) <= 180 &&
      !(latitude === 0 && longitude === 0)
    ) {
      return { latitude, longitude };
    }
  }
  return null;
}

export function formatCoordinateInput(
  latitude?: number,
  longitude?: number,
): string {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat === 0 ||
    lng === 0
  ) {
    return "";
  }
  return `${lat}, ${lng}`;
}
