import { useEffect, useState } from "react";
import type { BastDevice, BastRecord, Company, QuoteRecord, StoredFile } from "../types";
import {
  bastDateParts,
  bastFileName,
  buildBastPdf,
  cleanBast,
  emptyBast,
} from "../lib/bast";
import { formatNumberID, uid } from "../lib/data";
import { uploadPdf } from "../lib/api";
import { renderPdfPages } from "../lib/pdfRender";
import { Modal } from "./Dialogs";
import {
  ArrowLeftIcon,
  DocumentIcon,
  FileIcon,
  PlusIcon,
  TrashIcon,
  UploadIcon,
} from "./icons";

export interface BastSaveInput {
  bast: BastRecord;
  file: StoredFile;
}

interface Props {
  open: boolean;
  company: Company | null;
  quote: QuoteRecord | null;
  onClose: () => void;
  onSave: (input: BastSaveInput) => void;
}

function threeRows(devices: BastDevice[]): BastDevice[] {
  const rows = devices.map((device) => ({ ...device }));
  while (rows.length < 3) {
    rows.push({ id: uid("device"), name: "", quantity: 1 });
  }
  return rows;
}

function validate(form: BastRecord): string {
  if (!form.date) return "Tanggal BAST wajib diisi.";
  if (!form.customerName.trim()) return "Nama perusahaan pelanggan wajib diisi.";
  if (!form.customerAddress.trim()) return "Alamat perusahaan pelanggan wajib diisi.";
  if (!form.customerPic.trim()) return "Nama penanggung jawab wajib diisi.";
  if (!form.customerPhone.trim()) return "Nomor telepon pelanggan wajib diisi.";
  if (!form.customerEmail.trim()) return "Alamat email pelanggan wajib diisi.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.customerEmail.trim())) {
    return "Format alamat email belum benar.";
  }
  if (!form.siteName.trim()) return "Nama perusahaan di lokasi pemasangan wajib diisi.";
  if (!form.siteAddress.trim()) return "Alamat lokasi pemasangan wajib diisi.";
  if (!form.serviceName.trim()) return "Nama layanan wajib diisi.";
  if (!form.bandwidth.trim()) return "Kapasitas bandwidth wajib diisi.";
  if (!form.monthlyFee || form.monthlyFee <= 0) return "Biaya bulanan wajib diisi.";
  if (!form.installationStart || !form.installationEnd) {
    return "Tanggal pemasangan awal dan akhir wajib diisi.";
  }
  if (form.installationStart > form.installationEnd) {
    return "Tanggal pemasangan akhir tidak boleh lebih awal dari tanggal mulai.";
  }
  const devices = form.devices.filter((device) => device.name.trim());
  if (devices.length === 0) return "Isi minimal satu perangkat milik ASNET.";
  if (devices.some((device) => !Number.isFinite(device.quantity) || device.quantity <= 0)) {
    return "Jumlah setiap perangkat harus lebih dari 0.";
  }
  return "";
}

export default function BastDialog({
  open,
  company,
  quote,
  onClose,
  onSave,
}: Props) {
  const [form, setForm] = useState<BastRecord | null>(null);
  const [step, setStep] = useState<"form" | "preview">("form");
  const [pages, setPages] = useState<string[]>([]);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !company || !quote) return;
    const initial = quote.bast
      ? {
          ...quote.bast,
          devices: threeRows(quote.bast.devices),
        }
      : emptyBast(company, quote);
    setForm(initial);
    setStep("form");
    setPages([]);
    setPdfBlob(null);
    setError("");
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, quote?.id, company?.id]);

  const update = <K extends keyof BastRecord>(key: K, value: BastRecord[K]) => {
    setForm((previous) => (previous ? { ...previous, [key]: value } : previous));
    setError("");
  };

  const updateDevice = (id: string, patch: Partial<BastDevice>) => {
    setForm((previous) =>
      previous
        ? {
            ...previous,
            devices: previous.devices.map((device) =>
              device.id === id ? { ...device, ...patch } : device,
            ),
          }
        : previous,
    );
    setError("");
  };

  const addDevice = () => {
    setForm((previous) =>
      previous
        ? {
            ...previous,
            devices: [...previous.devices, { id: uid("device"), name: "", quantity: 1 }],
          }
        : previous,
    );
  };

  const removeDevice = (id: string) => {
    setForm((previous) =>
      previous && previous.devices.length > 1
        ? { ...previous, devices: previous.devices.filter((device) => device.id !== id) }
        : previous,
    );
  };

  const makePreview = async () => {
    if (!company || !quote || !form) return;
    const validation = validate(form);
    if (validation) {
      setError(validation);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const cleaned = cleanBast(form);
      const blob = buildBastPdf(cleaned, company, quote);
      const rendered = await renderPdfPages(blob, 1.45);
      setForm(cleaned);
      setPdfBlob(blob);
      setPages(rendered);
      setStep("preview");
    } catch {
      setError("PDF BAST belum bisa dibuat. Periksa isian lalu coba lagi.");
    } finally {
      setBusy(false);
    }
  };

  const upload = async () => {
    if (!company || !quote || !form || !pdfBlob) return;
    setBusy(true);
    setError("");
    try {
      const file = new File([pdfBlob], bastFileName(company, quote), {
        type: "application/pdf",
      });
      const uploaded = await uploadPdf(file);
      onSave({ bast: { ...form, updatedAt: new Date().toISOString() }, file: uploaded });
      onClose();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "Gagal mengunggah PDF BAST.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={
        step === "form" ? (quote?.bastFile ? "Perbarui BAST" : "Buat BAST") : "Pratinjau BAST"
      }
      subtitle={
        company
          ? `${company.name} · isi kelengkapan serah terima sebelum PDF dibuat.`
          : undefined
      }
      width={860}
      footer={
        step === "form" ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Batal
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void makePreview()}
              disabled={busy}
            >
              <FileIcon size={15} />
              {busy ? "Membuat PDF…" : "Pratinjau PDF"}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setStep("form");
                setError("");
              }}
              disabled={busy}
            >
              <ArrowLeftIcon size={15} /> Kembali edit
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void upload()}
              disabled={busy}
            >
              <UploadIcon size={15} /> {busy ? "Mengunggah…" : "Upload BAST"}
            </button>
          </>
        )
      }
    >
      {step === "form" ? (
        <div className="bast-form">
          <div className="bast-section-title">
            <span>1</span>
            <div>
              <strong>Tanggal BAST</strong>
              <p>Hari dan huruf terbilang dibuat otomatis dari tanggal.</p>
            </div>
          </div>
          <div className="form-grid">
            <div className="field field-full">
              <label htmlFor="bast-date">Tanggal aktivasi / serah terima</label>
              <input
                id="bast-date"
                type="date"
                value={form?.date ?? ""}
                onChange={(event) => update("date", event.target.value)}
                disabled={busy}
              />
              {form?.date ? (
                <span className="bast-date-words">{bastDateParts(form.date)}</span>
              ) : null}
            </div>
          </div>

          <div className="bast-section-title">
            <span>2</span>
            <div>
              <strong>Nama pelanggan</strong>
              <p>Data perusahaan yang menerima layanan.</p>
            </div>
          </div>
          <div className="form-grid">
            <div className="field field-full">
              <label htmlFor="bast-customer-name">Nama perusahaan</label>
              <input
                id="bast-customer-name"
                value={form?.customerName ?? ""}
                onChange={(event) => update("customerName", event.target.value)}
                disabled={busy}
              />
            </div>
            <div className="field field-full">
              <label htmlFor="bast-customer-address">Alamat perusahaan</label>
              <textarea
                id="bast-customer-address"
                rows={2}
                value={form?.customerAddress ?? ""}
                onChange={(event) => update("customerAddress", event.target.value)}
                disabled={busy}
              />
            </div>
            <div className="field">
              <label htmlFor="bast-customer-pic">Penanggung jawab</label>
              <input
                id="bast-customer-pic"
                value={form?.customerPic ?? ""}
                onChange={(event) => update("customerPic", event.target.value)}
                disabled={busy}
              />
            </div>
            <div className="field">
              <label htmlFor="bast-customer-phone">Nomor telepon</label>
              <input
                id="bast-customer-phone"
                type="tel"
                value={form?.customerPhone ?? ""}
                onChange={(event) => update("customerPhone", event.target.value)}
                disabled={busy}
              />
            </div>
            <div className="field field-full">
              <label htmlFor="bast-customer-email">Alamat email</label>
              <input
                id="bast-customer-email"
                type="email"
                value={form?.customerEmail ?? ""}
                onChange={(event) => update("customerEmail", event.target.value)}
                disabled={busy}
              />
            </div>
          </div>

          <div className="bast-section-title">
            <span>3</span>
            <div>
              <strong>Lokasi pemasangan</strong>
              <p>Layanan yang dipasang beserta biaya dan tanggal instalasi.</p>
            </div>
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="bast-site-name">Nama perusahaan</label>
              <input
                id="bast-site-name"
                value={form?.siteName ?? ""}
                onChange={(event) => update("siteName", event.target.value)}
                disabled={busy}
              />
            </div>
            <div className="field">
              <label htmlFor="bast-site-address">Alamat perusahaan</label>
              <input
                id="bast-site-address"
                value={form?.siteAddress ?? ""}
                onChange={(event) => update("siteAddress", event.target.value)}
                disabled={busy}
              />
            </div>
            <div className="field">
              <label htmlFor="bast-service">Nama layanan</label>
              <input
                id="bast-service"
                value={form?.serviceName ?? ""}
                onChange={(event) => update("serviceName", event.target.value)}
                disabled={busy}
              />
            </div>
            <div className="field">
              <label htmlFor="bast-bandwidth">Kapasitas bandwidth</label>
              <input
                id="bast-bandwidth"
                value={form?.bandwidth ?? ""}
                placeholder="Contoh: 100 Mbps"
                onChange={(event) => update("bandwidth", event.target.value)}
                disabled={busy}
              />
            </div>
            <div className="field">
              <label htmlFor="bast-monthly">Biaya bulanan (sebelum PPN)</label>
              <div className="input-prefix">
                <span>Rp</span>
                <input
                  id="bast-monthly"
                  inputMode="numeric"
                  value={form?.monthlyFee ? formatNumberID(form.monthlyFee) : ""}
                  placeholder="mis. 2.500.000"
                  onChange={(event) => {
                    const digits = event.target.value.replace(/[^\d]/g, "").slice(0, 15);
                    update("monthlyFee", digits ? Number(digits) : 0);
                  }}
                  disabled={busy}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="bast-registration">
                Biaya registrasi <span className="optional">(opsional)</span>
              </label>
              <div className="input-prefix">
                <span>Rp</span>
                <input
                  id="bast-registration"
                  inputMode="numeric"
                  value={form?.registrationFee ? formatNumberID(form.registrationFee) : ""}
                  placeholder="Boleh dikosongkan"
                  onChange={(event) => {
                    const digits = event.target.value.replace(/[^\d]/g, "").slice(0, 15);
                    update("registrationFee", digits ? Number(digits) : 0);
                  }}
                  disabled={busy}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="bast-install-start">Tanggal pemasangan mulai</label>
              <input
                id="bast-install-start"
                type="date"
                value={form?.installationStart ?? ""}
                onChange={(event) => update("installationStart", event.target.value)}
                disabled={busy}
              />
            </div>
            <div className="field">
              <label htmlFor="bast-install-end">Tanggal pemasangan selesai</label>
              <input
                id="bast-install-end"
                type="date"
                value={form?.installationEnd ?? ""}
                onChange={(event) => update("installationEnd", event.target.value)}
                disabled={busy}
              />
            </div>
          </div>

          <div className="bast-section-title">
            <span>4</span>
            <div>
              <strong>Perangkat milik ASNET</strong>
              <p>Isi nama barang dan jumlahnya. Tiga baris pertama sudah disiapkan.</p>
            </div>
          </div>
          <div className="bast-devices">
            {form?.devices.map((device, index) => (
              <div className="bast-device-row" key={device.id}>
                <span className="bast-device-no">{index + 1}</span>
                <input
                  aria-label={`Nama perangkat ${index + 1}`}
                  placeholder="Nama perangkat"
                  value={device.name}
                  onChange={(event) => updateDevice(device.id, { name: event.target.value })}
                  disabled={busy}
                />
                <input
                  aria-label={`Jumlah perangkat ${index + 1}`}
                  className="bast-device-qty"
                  type="number"
                  min={1}
                  max={999}
                  value={device.quantity}
                  onChange={(event) =>
                    updateDevice(device.id, {
                      quantity: Math.max(1, Number(event.target.value) || 1),
                    })
                  }
                  disabled={busy}
                />
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Hapus perangkat ${index + 1}`}
                  title="Hapus perangkat"
                  onClick={() => removeDevice(device.id)}
                  disabled={busy || (form?.devices.length ?? 0) <= 1}
                >
                  <TrashIcon size={15} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="link-btn bast-add-device"
              onClick={addDevice}
              disabled={busy}
            >
              <PlusIcon size={14} /> Tambah perangkat
            </button>
          </div>

          {error ? <p className="form-error">{error}</p> : null}
        </div>
      ) : (
        <div className="bast-preview">
          <div className="bast-preview-note">
            <DocumentIcon size={17} />
            <span>
              PDF A4 siap. Periksa tampilan di bawah, lalu tekan <strong>Upload BAST</strong>.
            </span>
          </div>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="bast-preview-pages">
            {pages.map((page, index) => (
              <img key={index} src={page} alt={`Pratinjau BAST halaman ${index + 1}`} />
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
