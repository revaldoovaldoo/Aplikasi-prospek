import { useEffect, useMemo, useState } from "react";
import type { Company, QuoteRecord, StoredFile } from "../types";
import { uploadPdf } from "../lib/api";
import { autoQuoteNumber, parseAmount, todayISO, yearOf } from "../lib/data";
import { quoteFilename } from "../lib/send";
import { buildQuotePdf, type QuoteDevice } from "../lib/quotePdf";
import { renderPdfPages } from "../lib/pdfRender";
import { Modal } from "./Dialogs";
import { DownloadIcon, PlusIcon, TrashIcon } from "./icons";

interface Props {
  open: boolean;
  company: Company | null;
  quotes: QuoteRecord[];
  onClose: () => void;
  onRenameCompany: (companyId: string, name: string) => void;
  onSave: (input: {
    companyId: string;
    number: string;
    date: string;
    quoteFile: StoredFile;
  }) => void;
}

interface DeviceRow extends QuoteDevice {
  id: string;
}

function nextSequence(quotes: QuoteRecord[], date: string): number {
  const year = yearOf(date);
  const used = quotes
    .filter((quote) => quote.date.startsWith(`${year}-`))
    .map((quote) => {
      const match = /^(\d{1,3})\//.exec(quote.number);
      return match ? Number(match[1]) : 0;
    });
  return Math.max(0, ...used) + 1;
}

function initialDevices(): DeviceRow[] {
  return Array.from({ length: 3 }, (_, index) => ({
    id: `device_${index}`,
    name: "",
    quantity: 1,
  }));
}

export default function QuoteBuilderDialog({
  open,
  company,
  quotes,
  onClose,
  onRenameCompany,
  onSave,
}: Props) {
  const [step, setStep] = useState<"form" | "preview">("form");
  const [companyName, setCompanyName] = useState("");
  const [date, setDate] = useState(todayISO());
  const [city, setCity] = useState("Bogor");
  const [contactName, setContactName] = useState("");
  const [bandwidthMode, setBandwidthMode] = useState("Dedicated");
  const [bandwidthAmount, setBandwidthAmount] = useState("300");
  const [bandwidthUnit, setBandwidthUnit] = useState("Mbps");
  const [monthly, setMonthly] = useState("");
  const [otcMode, setOtcMode] = useState<"free" | "amount">("free");
  const [otcAmount, setOtcAmount] = useState("");
  const [devices, setDevices] = useState<DeviceRow[]>(initialDevices);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pdfUrl, setPdfUrl] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [previewPages, setPreviewPages] = useState<string[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const sequence = useMemo(() => nextSequence(quotes, date), [quotes, date]);
  const number = autoQuoteNumber(sequence, date);

  useEffect(() => {
    if (!open) return;
    setStep("form");
    setCompanyName(company?.name || "");
    setDate(todayISO());
    setCity("Bogor");
    setContactName(company?.contactName || "");
    setBandwidthMode("Dedicated");
    setBandwidthAmount("300");
    setBandwidthUnit("Mbps");
    setMonthly("");
    setOtcMode("free");
    setOtcAmount("");
    setDevices(initialDevices());
    setError("");
    setBusy(false);
    setPdfUrl("");
    setPdfFile(null);
    setPreviewPages([]);
    setPreviewLoading(false);
    setPreviewError("");
  }, [open, company?.id]);

  useEffect(
    () => () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    },
    [pdfUrl],
  );

  if (!company) return null;

  const commitCompanyName = () => {
    const next = companyName.trim();
    if (!next || !company || next === company.name) return company?.name || "";
    onRenameCompany(company.id, next);
    return next;
  };

  const resetPreview = () => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl("");
    setPdfFile(null);
    setPreviewPages([]);
    setPreviewLoading(false);
    setPreviewError("");
    setStep("form");
    setError("");
  };

  const makePreview = async () => {
    const monthlyValue = parseAmount(monthly);
    const otcValue = otcMode === "free" ? 0 : parseAmount(otcAmount);
    if (!contactName.trim()) {
      setError("Nama PIC yang dituju wajib diisi.");
      return;
    }
    if (!date) {
      setError("Tanggal penawaran wajib diisi.");
      return;
    }
    if (!bandwidthAmount.trim()) {
      setError("Besaran bandwidth wajib diisi.");
      return;
    }
    if (!monthlyValue) {
      setError("Harga bulanan wajib diisi.");
      return;
    }
    if (otcMode === "amount" && !otcValue) {
      setError("Isi nominal OTC atau pilih Free.");
      return;
    }

    const payloadDevices: QuoteDevice[] = devices
      .filter((device) => device.name.trim())
      .map((device) => ({
        name: device.name.trim(),
        quantity: Math.max(1, Number(device.quantity) || 1),
      }));
    const finalCompanyName = commitCompanyName();
    const blob = buildQuotePdf({
      number,
      date,
      city: city.trim() || "Bogor",
      contactName: contactName.trim(),
      companyName: finalCompanyName,
      bandwidth: `${bandwidthMode} ${bandwidthAmount.trim()} ${bandwidthUnit}`,
      monthly: monthlyValue,
      otc: otcMode === "free" ? "FREE" : otcValue,
      devices: payloadDevices,
    });
    const file = new File([blob], quoteFilename(number), { type: "application/pdf" });
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(URL.createObjectURL(blob));
    setPdfFile(file);
    setPreviewPages([]);
    setPreviewLoading(true);
    setPreviewError("");
    setError("");
    setStep("preview");
    try {
      setPreviewPages(await renderPdfPages(blob, 1.55));
    } catch (previewFailure) {
      setPreviewError(
        previewFailure instanceof Error
          ? `Pratinjau gambar gagal dimuat: ${previewFailure.message}`
          : "Pratinjau gambar gagal dimuat.",
      );
    } finally {
      setPreviewLoading(false);
    }
  };

  const upload = async () => {
    if (!pdfFile) {
      setError("PDF belum dibuat. Kembali dan buat pratinjau lagi.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const uploaded = await uploadPdf(pdfFile);
      onSave({
        companyId: company.id,
        number,
        date,
        quoteFile: uploaded,
      });
      onClose();
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "Gagal mengunggah PDF.",
      );
    } finally {
      setBusy(false);
    }
  };

  const updateDevice = (id: string, patch: Partial<DeviceRow>) => {
    setDevices((previous) =>
      previous.map((device) => (device.id === id ? { ...device, ...patch } : device)),
    );
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={step === "form" ? "Buat penawaran" : "Pratinjau penawaran"}
      subtitle={`${companyName.trim() || company.name} · ${number}`}
      width={step === "preview" ? 980 : 760}
      footer={
        step === "form" ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
              Batal
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void makePreview()}>
              Tampilkan PDF
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={resetPreview} disabled={busy}>
              Kembali edit
            </button>
            <a
              className="btn btn-secondary"
              href={pdfUrl}
              download={quoteFilename(number)}
            >
              <DownloadIcon size={15} /> Unduh PDF
            </a>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void upload()}
              disabled={busy || !pdfFile}
            >
              {busy ? "Mengunggah…" : "Setujui & Upload"}
            </button>
          </>
        )
      }
    >
      {step === "form" ? (
        <div className="quote-builder">
          <div className="quote-builder-meta">
            <span>Nomor otomatis</span>
            <strong>{number}</strong>
          </div>

          <div className="form-grid">
            <label className="field">
              <span>Tanggal penawaran</span>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Kota</span>
              <input value={city} onChange={(event) => setCity(event.target.value)} />
            </label>
            <label className="field">
              <span>Nama PIC yang dituju</span>
              <input
                value={contactName}
                onChange={(event) => setContactName(event.target.value)}
                placeholder="Nama Bapak/Ibu"
              />
            </label>
            <label className="field">
              <span>Perusahaan</span>
              <input
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                onBlur={() => {
                  if (companyName.trim()) commitCompanyName();
                }}
                placeholder="Nama perusahaan/sekolah/hotel"
              />
              <span className="field-hint">
                Mengubah nama di sini juga mengganti profil perusahaan di aplikasi.
              </span>
            </label>
          </div>

          <div className="quote-builder-section">
            <h3>Bandwidth</h3>
            <div className="form-grid quote-bandwidth-grid">
              <label className="field">
                <span>Tipe</span>
                <select
                  value={bandwidthMode}
                  onChange={(event) => setBandwidthMode(event.target.value)}
                >
                  <option value="Dedicated">Dedicated</option>
                  <option value="UpTo">UpTo</option>
                </select>
              </label>
              <label className="field">
                <span>Besaran</span>
                <input
                  value={bandwidthAmount}
                  inputMode="decimal"
                  onChange={(event) => setBandwidthAmount(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Satuan</span>
                <select
                  value={bandwidthUnit}
                  onChange={(event) => setBandwidthUnit(event.target.value)}
                >
                  <option value="Mbps">Mbps</option>
                  <option value="Gbps">Gbps</option>
                </select>
              </label>
            </div>
            <p className="quote-builder-hint">
              Tampil sebagai <strong>{`${bandwidthMode} ${bandwidthAmount || "…"} ${bandwidthUnit}`}</strong>
            </p>
          </div>

          <div className="quote-builder-section">
            <h3>Harga</h3>
            <div className="form-grid quote-price-grid">
              <label className="field">
                <span>Monthly (*)</span>
                <div className="quote-money-input">
                  <span>Rp</span>
                  <input
                    value={monthly}
                    inputMode="numeric"
                    placeholder="1.000.000"
                    onChange={(event) => setMonthly(event.target.value)}
                  />
                </div>
              </label>
              <label className="field">
                <span>OTC (**)</span>
                <select
                  value={otcMode}
                  onChange={(event) =>
                    setOtcMode(event.target.value === "amount" ? "amount" : "free")
                  }
                >
                  <option value="free">Free</option>
                  <option value="amount">Nominal</option>
                </select>
              </label>
              {otcMode === "amount" ? (
                <label className="field">
                  <span>Nominal OTC</span>
                  <div className="quote-money-input">
                    <span>Rp</span>
                    <input
                      value={otcAmount}
                      inputMode="numeric"
                      placeholder="1.000.000"
                      onChange={(event) => setOtcAmount(event.target.value)}
                    />
                  </div>
                </label>
              ) : null}
            </div>
          </div>

          <div className="quote-builder-section">
            <div className="quote-builder-section-head">
              <div>
                <h3>Alat yang termasuk</h3>
                <p>Kosongkan baris yang tidak dipakai. Baris kosong otomatis hilang.</p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-mini"
                onClick={() =>
                  setDevices((previous) => [
                    ...previous,
                    {
                      id: `device_${Date.now()}_${previous.length}`,
                      name: "",
                      quantity: 1,
                    },
                  ])
                }
              >
                <PlusIcon size={14} /> Tambah
              </button>
            </div>

            <div className="quote-device-list">
              {devices.map((device, index) => (
                <div className="quote-device-row" key={device.id}>
                  <label className="field">
                    <span>Nama alat {index + 1}</span>
                    <input
                      value={device.name}
                      onChange={(event) =>
                        updateDevice(device.id, { name: event.target.value })
                      }
                      placeholder="Contoh: Router"
                    />
                  </label>
                  <label className="field quote-device-qty">
                    <span>Jumlah</span>
                    <input
                      type="number"
                      min={1}
                      value={device.quantity}
                      onChange={(event) =>
                        updateDevice(device.id, {
                          quantity: Math.max(1, Number(event.target.value) || 1),
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="icon-btn quote-device-remove"
                    aria-label={`Hapus alat ${index + 1}`}
                    onClick={() =>
                      setDevices((previous) =>
                        previous.filter((item) => item.id !== device.id),
                      )
                    }
                  >
                    <TrashIcon size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {error ? <p className="form-error">{error}</p> : null}
        </div>
      ) : (
        <div className="quote-builder-preview">
          {previewLoading ? (
            <div className="quote-builder-preview-loading" role="status">
              Menyiapkan pratinjau halaman PDF…
            </div>
          ) : null}
          {previewError ? <p className="form-error">{previewError}</p> : null}
          {previewPages.length > 0 ? (
            <div className="quote-builder-preview-pages">
              {previewPages.map((page, index) => (
                <img
                  key={index}
                  src={page}
                  alt={`Halaman ${index + 1} penawaran ${number}`}
                  className="quote-builder-preview-page"
                />
              ))}
            </div>
          ) : !previewLoading && !previewError ? (
            <div className="quote-builder-preview-loading">
              Pratinjau belum tersedia. Gunakan tombol Unduh PDF.
            </div>
          ) : null}
          {pdfUrl ? (
            <a
              className="link-btn quote-builder-open-pdf"
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
            >
              Buka PDF di tab baru
            </a>
          ) : null}
          {error ? <p className="form-error">{error}</p> : null}
        </div>
      )}
    </Modal>
  );
}
