import { useEffect, useState } from "react";
import type { Company } from "../types";
import {
  formatCoordinateInput,
  parseCoordinateInput,
} from "../lib/coordinates";
import { todayISO } from "../lib/data";
import { Modal } from "./Dialogs";

export type CompanyDraft = Omit<Company, "id" | "createdAt">;

interface Props {
  open: boolean;
  initial: Company | null;
  locations: string[];
  onClose: () => void;
  onAddLocation: (name: string) => void;
  onSave: (draft: CompanyDraft) => void;
}

export default function CompanyDialog({
  open,
  initial,
  locations,
  onClose,
  onAddLocation,
  onSave,
}: Props) {
  const [form, setForm] = useState<CompanyDraft>({
    name: "",
    location: locations[0] ?? "",
    email: "",
    picPhone: "",
    website: "",
    visitDate: todayISO(),
  });
  const [errors, setErrors] = useState<{ name?: string; location?: string }>({});
  const [addingLocation, setAddingLocation] = useState(false);
  const [newLocation, setNewLocation] = useState("");
  const [coordinateInput, setCoordinateInput] = useState("");
  const [coordinateConfirmed, setCoordinateConfirmed] = useState(false);
  const [coordinateError, setCoordinateError] = useState("");

  useEffect(() => {
    if (!open) return;
    setForm(
      initial
        ? {
            name: initial.name,
            location: initial.location,
            email: initial.email,
            picPhone: initial.picPhone,
            website: initial.website ?? "",
            visitDate: initial.visitDate,
          }
        : {
            name: "",
            location: locations[0] ?? "",
            email: "",
            picPhone: "",
            website: "",
            visitDate: todayISO(),
          },
    );
    setErrors({});
    setAddingLocation(false);
    setNewLocation("");
    setCoordinateInput(
      formatCoordinateInput(initial?.latitude, initial?.longitude),
    );
    setCoordinateConfirmed(
      /^Dikonfirmasi manual\b/i.test(initial?.coordinateSource || ""),
    );
    setCoordinateError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.id]);

  const update = (key: keyof CompanyDraft, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const addLocation = () => {
    const name = newLocation.trim();
    if (!name) return;
    const existing = locations.find((loc) => loc.toLowerCase() === name.toLowerCase());
    if (existing) {
      update("location", existing);
    } else {
      onAddLocation(name);
      update("location", name);
    }
    setNewLocation("");
    setAddingLocation(false);
  };

  const submit = () => {
    const nextErrors: { name?: string; location?: string } = {};
    if (!form.name.trim()) nextErrors.name = "Nama perusahaan wajib diisi.";
    if (!form.location.trim()) nextErrors.location = "Pilih lokasi perusahaan.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const website = form.website?.trim() ?? "";
    const coordinateText = coordinateInput.trim();
    const coordinate = coordinateText ? parseCoordinateInput(coordinateText) : null;
    if (coordinateText && !coordinate) {
      setCoordinateError(
        "Koordinat tidak valid. Salin angka seperti -6.356989, 106.780201 dari Google Maps.",
      );
      return;
    }
    const originalCoordinate = formatCoordinateInput(
      initial?.latitude,
      initial?.longitude,
    );
    const coordinateChanged = coordinateText !== originalCoordinate;
    if (coordinate && (coordinateChanged || coordinateConfirmed) && !coordinateConfirmed) {
      setCoordinateError(
        "Centang konfirmasi setelah mencocokkan titik di Google Maps.",
      );
      return;
    }
    onSave({
      name: form.name.trim(),
      location: form.location,
      email: form.email.trim(),
      picPhone: form.picPhone.trim(),
      website: website && !/^https?:\/\//i.test(website) ? `https://${website}` : website,
      visitDate: form.visitDate,
      ...(coordinate && coordinateConfirmed
        ? {
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
            coordinateSource: "Dikonfirmasi manual",
            coordinateAddress:
              initial?.coordinateAddress?.trim() || form.location,
          }
        : {}),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? "Edit data perusahaan" : "Tambah perusahaan"}
      subtitle="Data ini dipakai otomatis pada draft penawaran."
      width={580}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Batal
          </button>
          <button type="button" className="btn btn-primary" onClick={submit}>
            {initial ? "Simpan perubahan" : "Simpan perusahaan"}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="field field-full">
          <label htmlFor="company-name">Nama perusahaan</label>
          <input
            id="company-name"
            autoFocus
            value={form.name}
            placeholder="Contoh: PT. Trivinity Teknologi Indonesia"
            onChange={(e) => update("name", e.target.value)}
          />
          {errors.name ? <span className="field-error">{errors.name}</span> : null}
        </div>

        <div className="field">
          <label htmlFor="company-location">Lokasi</label>
          <select
            id="company-location"
            value={form.location}
            onChange={(e) => update("location", e.target.value)}
          >
            <option value="" disabled>
              Pilih lokasi
            </option>
            {locations.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>
          {errors.location ? <span className="field-error">{errors.location}</span> : null}
          {addingLocation ? (
            <div className="inline-add">
              <input
                autoFocus
                value={newLocation}
                placeholder="Nama lokasi baru"
                onChange={(e) => setNewLocation(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addLocation();
                  }
                  if (e.key === "Escape") setAddingLocation(false);
                }}
              />
              <button type="button" className="btn btn-mini btn-primary" onClick={addLocation}>
                Tambah
              </button>
              <button
                type="button"
                className="btn btn-mini btn-ghost"
                onClick={() => setAddingLocation(false)}
              >
                Batal
              </button>
            </div>
          ) : (
            <button type="button" className="link-btn" onClick={() => setAddingLocation(true)}>
              + Tambah lokasi baru
            </button>
          )}
        </div>

        <div className="field">
          <label htmlFor="company-visit">
            Tanggal visit <span className="optional">(opsional)</span>
          </label>
          <input
            id="company-visit"
            type="date"
            value={form.visitDate}
            onChange={(e) => update("visitDate", e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="company-email">
            Email <span className="optional">(opsional)</span>
          </label>
          <input
            id="company-email"
            type="email"
            value={form.email}
            placeholder="nama@perusahaan.com"
            onChange={(e) => update("email", e.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="company-phone">
            No. PIC <span className="optional">(opsional)</span>
          </label>
          <input
            id="company-phone"
            type="tel"
            value={form.picPhone}
            placeholder="0812 3456 7890"
            onChange={(e) => update("picPhone", e.target.value)}
          />
        </div>

        <div className="field field-full">
          <label htmlFor="company-website">
            Website <span className="optional">(opsional)</span>
          </label>
          <input
            id="company-website"
            type="text"
            value={form.website ?? ""}
            placeholder="https://perusahaan.com"
            onChange={(e) => update("website", e.target.value)}
          />
        </div>

        <div className="field field-full">
          <label htmlFor="company-coordinate">
            Titik koordinat <span className="optional">(opsional)</span>
          </label>
          <input
            id="company-coordinate"
            type="text"
            value={coordinateInput}
            placeholder="-6.356989, 106.780201"
            onChange={(e) => {
              setCoordinateInput(e.target.value);
              setCoordinateConfirmed(false);
              setCoordinateError("");
            }}
          />
          <span className="field-hint">
            Buka lokasi di Google Maps, salin angka koordinatnya (bukan link pendek),
            lalu tempel di sini. Titik ini dipakai untuk tombol lokasi di Prospek.
          </span>
          {coordinateInput.trim() ? (
            <label className="coordinate-confirm">
              <input
                type="checkbox"
                checked={coordinateConfirmed}
                onChange={(e) => {
                  setCoordinateConfirmed(e.target.checked);
                  setCoordinateError("");
                }}
              />
              Saya sudah mencocokkan titik ini dengan lokasi sebenarnya.
            </label>
          ) : null}
          {coordinateError ? (
            <span className="field-error">{coordinateError}</span>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
