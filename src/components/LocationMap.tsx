import { PinIcon } from "./icons";

interface Props {
  latitude?: number;
  longitude?: number;
  address?: string;
  source?: string;
}

export function googleMapsUrl(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

export default function LocationMap({
  latitude,
  longitude,
  address,
  source,
}: Props) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  const valid =
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat !== 0 &&
    lng !== 0 &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180;

  if (!valid) return null;

  const mapsUrl = googleMapsUrl(lat, lng);
  const label = address?.trim() || `${lat}, ${lng}`;
  const approximate = /^Pusat wilayah\b/i.test(source?.trim() || "");

  return (
    <section className="location-map" aria-label="Lokasi di Google Maps">
      <div className="location-map-head">
        <span className="location-map-icon">
          <PinIcon size={16} />
        </span>
        <div>
          <strong>
            {approximate ? "Lokasi perkiraan wilayah" : "Lokasi terverifikasi"}
          </strong>
          <span>{label}</span>
        </div>
        <a
          className="btn btn-mini btn-secondary"
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
        >
          Buka Google Maps
        </a>
      </div>
      <iframe
        className="location-map-frame"
        src={`https://www.google.com/maps?q=${lat},${lng}&z=16&hl=id&output=embed`}
        title={`Peta ${label}`}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
      />
      <div className="location-map-foot">
        <span className="mono">
          {lat.toFixed(6)}, {lng.toFixed(6)}
        </span>
        {source ? <span>{source}</span> : null}
      </div>
    </section>
  );
}
