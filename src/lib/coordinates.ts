export interface ParsedCoordinate {
  latitude: number;
  longitude: number;
}

const NUMBER = String.raw`-?\d+(?:\.\d+)?`;
const DMS = String.raw`(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*(\d{1,2}(?:\.\d+)?)\s*(?:["″]|'')\s*([NS])`;
const DMS_LON = DMS.replace("([NS])", "([EW])");
const DMS_PATTERN = new RegExp(
  String.raw`^\s*${DMS}\s*[,;]?\s*${DMS_LON}\s*$`,
  "i",
);
const PATTERNS = [
  new RegExp(String.raw`!3d(${NUMBER})!4d(${NUMBER})`),
  new RegExp(String.raw`@(${NUMBER}),(${NUMBER})`),
  new RegExp(
    String.raw`[?&](?:q|query|ll)=(?:loc(?::|%3A))?(${NUMBER})(?:,|%2C)(${NUMBER})`,
    "i",
  ),
  new RegExp(String.raw`^\s*(${NUMBER})\s*[,;]\s*(${NUMBER})\s*$`),
];

function dmsToDecimal(
  degrees: string,
  minutes: string,
  seconds: string,
  hemisphere: string,
): number | null {
  const deg = Number(degrees);
  const min = Number(minutes);
  const sec = Number(seconds);
  if (
    !Number.isFinite(deg) ||
    !Number.isFinite(min) ||
    !Number.isFinite(sec) ||
    min >= 60 ||
    sec >= 60
  ) {
    return null;
  }
  const value = deg + min / 60 + sec / 3600;
  return /^[SW]$/i.test(hemisphere) ? -value : value;
}

function parseDms(text: string): ParsedCoordinate | null {
  const match = text.match(DMS_PATTERN);
  if (!match) return null;
  const latitude = dmsToDecimal(match[1], match[2], match[3], match[4]);
  const longitude = dmsToDecimal(match[5], match[6], match[7], match[8]);
  if (
    latitude === null ||
    longitude === null ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180 ||
    (latitude === 0 && longitude === 0)
  ) {
    return null;
  }
  return { latitude, longitude };
}

/**
 * Terima "lat, lng" atau URL Google Maps yang memuat koordinat eksplisit.
 * Link pendek seperti goo.gl/maps/... harus dibuka dulu; koordinatnya tidak
 * bisa ditentukan tanpa mengikuti redirect.
 */
export function parseCoordinateInput(value: string): ParsedCoordinate | null {
  const text = String(value || "").trim();
  if (!text) return null;
  const dms = parseDms(text);
  if (dms) return dms;
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
