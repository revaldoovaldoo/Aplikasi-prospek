import { useEffect, useRef, useState } from "react";
import type { Company, QuoteRecord, StoredFile } from "../types";
import {
  autoQuoteNumber,
  commissionOf,
  formatFileSize,
  formatIDR,
  formatShortDate,
  isQuoteSequenceUsed,
  nextAvailableQuoteNumber,
  parseAmount,
  ppnOf,
  quoteFiles,
  quoteSequence,
  todayISO,
  yearOf,
} from "../lib/data";
import { MAX_PDF_BYTES, pdfUrl, uploadPdf } from "../lib/api";
import { extractQuoteNumber } from "../lib/pdf";
import { Modal } from "./Dialogs";
import { AlertIcon, DownloadIcon, FileIcon, TrashIcon, UploadIcon } from "./icons";

function validatePdf(file: File): string | null {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) return "File harus berupa PDF.";
  if (file.size > MAX_PDF_BYTES) return "Ukuran PDF maksimal 15 MB.";
  if (file.size === 0) return "File PDF kosong.";
  return null;
}

function PdfDrop({
  file,
  disabled,
  onPick,
}: {
  file: File | null;
  disabled?: boolean;
  onPick: (file: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className={`pdf-drop${dragging ? " is-dragging" : ""}${file ? " has-file" : ""}`}
      onDragOver={(event) => {
        if (disabled) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        if (disabled) return;
        event.preventDefault();
        setDragging(false);
        const dropped = event.dataTransfer.files?.[0];
        if (dropped) onPick(dropped);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        disabled={disabled}
        onChange={(event) => {
          onPick(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />
      {file ? (
        <div className="pdf-file">
          <span className="pdf-file-icon">
            <FileIcon size={20} />
          </span>
          <div className="pdf-file-main">
            <strong>{file.name}</strong>
            <span>{formatFileSize(file.size)} · PDF</span>
          </div>
          <button
            type="button"
            className="link-btn"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            Ganti
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="pdf-choose"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          <span className="pdf-choose-icon">
            <UploadIcon size={20} />
          </span>
          <strong>Pilih atau tarik file PDF ke sini</strong>
          <span>Hanya PDF, maksimal 15 MB</span>
        </button>
      )}
    </div>
  );
}

interface QuoteUploadProps {
  open: boolean;
  company: Company | null;
  existing: QuoteRecord | null;
  quotes: QuoteRecord[];
  onClose: () => void;
  onSave: (input: {
    companyId: string;
    number: string;
    date: string;
    quoteFile: StoredFile;
  }) => void;
  onDeleteVersion: (file: StoredFile) => void;
}

export function QuoteUploadDialog({
  open,
  company,
  existing,
  quotes,
  onClose,
  onSave,
  onDeleteVersion,
}: QuoteUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(todayISO());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [detected, setDetected] = useState(false);
  const existingFiles = existing ? quoteFiles(existing) : [];

  useEffect(() => {
    if (!open) return;
    const today = todayISO();
    setFile(null);
    setNumber(existing?.number ?? nextAvailableQuoteNumber(quotes, today));
    setDate(existing?.date ?? today);
    setError("");
    setBusy(false);
    setReading(false);
    setDetected(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, company?.id, existing?.id]);

  const pickFile = async (next: File | null) => {
    setError("");
    setDetected(false);
    if (!next) {
      setFile(null);
      return;
    }
    const validation = validatePdf(next);
    if (validation) {
      setError(validation);
      setFile(null);
      return;
    }
    setFile(next);

    if (!existing) {
      setReading(true);
      const found = await extractQuoteNumber(next);
      setReading(false);
      const foundSequence = quoteSequence(found || "");
      const foundYear = Number(/(\d{4})\s*$/.exec(found || "")?.[1] || 0);
      const usable =
        Boolean(found) &&
        foundSequence > 0 &&
        foundYear === yearOf(date) &&
        !isQuoteSequenceUsed(quotes, foundSequence, date);
      if (usable && found) {
        // Pakai nomor urut dari PDF, tetapi bulan/tahun mengikuti tanggal
        // penawaran yang dipilih agar seri tetap konsisten.
        setNumber(autoQuoteNumber(foundSequence, date));
        setDetected(true);
      } else {
        setNumber(nextAvailableQuoteNumber(quotes, date));
      }
    }
  };

  const submit = async () => {
    if (!company) return;
    if (!file) {
      setError("Pilih file PDF penawaran terlebih dahulu.");
      return;
    }
    if (!number.trim()) {
      setError("Nomor penawaran wajib diisi.");
      return;
    }
    if (!date) {
      setError("Tanggal penawaran wajib diisi.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const uploaded = await uploadPdf(file);
      onSave({
        companyId: company.id,
        number: number.trim(),
        date,
        quoteFile: uploaded,
      });
      onClose();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Gagal mengunggah PDF.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={existing ? "Perbarui PDF penawaran" : "Upload penawaran"}
      subtitle={
        company
          ? `${company.name} · cukup unggah PDF penawaran Anda.`
          : "Unggah PDF penawaran Anda."
      }
      width={560}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? "Mengunggah…" : existing ? "Simpan perubahan" : "Simpan penawaran"}
          </button>
        </>
      }
    >
      {existing && existingFiles.length > 0 ? (
        <div className="quote-version-list">
          <div className="quote-version-head">
            <strong>PDF penawaran tersimpan ({existingFiles.length})</strong>
            <span>Nomor <span className="mono">{existing.number}</span> dipakai untuk semua versi; tanggal mengikuti input terbaru.</span>
          </div>
          {existingFiles.map((saved, index) => (
            <div className="quote-version-row" key={saved.id}>
              <a
                className="quote-version-main"
                href={pdfUrl(saved.id)}
                target="_blank"
                rel="noreferrer"
              >
                <FileIcon size={16} />
                <span>
                  <strong>{index === 0 ? "Versi terbaru" : `Versi ${existingFiles.length - index}`} · {saved.name}</strong>
                  <span>{formatFileSize(saved.size)} · {formatShortDate(saved.uploadedAt.slice(0, 10))}</span>
                </span>
              </a>
              <div className="quote-version-actions">
                <a
                  className="drawer-file-action"
                  href={pdfUrl(saved.id)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Buka ${saved.name}`}
                  title="Buka PDF"
                >
                  <DownloadIcon size={15} />
                </a>
                <button
                  type="button"
                  className="drawer-file-action"
                  onClick={() => onDeleteVersion(saved)}
                  aria-label={`Hapus ${saved.name}`}
                  title="Hapus PDF"
                >
                  <TrashIcon size={15} />
                </button>
              </div>
            </div>
          ))}
          <p className="field-hint">
            Unggah PDF baru di bawah untuk menggantikan versi terbaru. Nomor penawaran tetap sama; tanggal dapat Anda sesuaikan. Setelah disimpan, Anda langsung masuk ke proses kirim.
          </p>
        </div>
      ) : null}

      <div className="form-grid">
        <div className="field field-full">
          <label>File PDF penawaran</label>
          <PdfDrop file={file} disabled={busy} onPick={(next) => void pickFile(next)} />
          {file ? (
            <span className="field-hint">
              {reading
                ? "Membaca nomor penawaran dari PDF…"
                : existing
                  ? "PDF ini akan menjadi versi terbaru; PDF sebelumnya tetap tersimpan di riwayat."
                  : detected
                    ? "Nomor terdeteksi otomatis dari PDF. Periksa dan koreksi bila perlu."
                    : "Nomor diisi otomatis dari nomor urut yang masih tersedia."}
            </span>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="quote-number">Nomor penawaran</label>
          <input
            id="quote-number"
            value={number}
            placeholder="001/UAS/QUOT-PANE/VII/2026"
            onChange={(event) => {
              setNumber(event.target.value);
              setDetected(false);
            }}
            disabled={busy || Boolean(existing)}
          />
          {existing ? (
            <span className="field-hint">
              Nomor dikunci agar PDF pengganti tetap memakai seri penawaran yang sama.
            </span>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="quote-date">Tanggal penawaran</label>
          <input
            id="quote-date"
            type="date"
            value={date}
            onChange={(event) => {
              const nextDate = event.target.value;
              setDate(nextDate);
              if (!existing && !detected) {
                setNumber(nextAvailableQuoteNumber(quotes, nextDate));
              }
            }}
            disabled={busy}
          />
          {existing ? (
            <span className="field-hint">
              Tanggal ini dipakai pada penawaran dan proses pengiriman berikutnya.
            </span>
          ) : null}
        </div>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      {busy ? <p className="form-progress">Menyimpan PDF ke akun Anda…</p> : null}
    </Modal>
  );
}

interface LostReasonProps {
  open: boolean;
  company: Company | null;
  quote: QuoteRecord | null;
  onClose: () => void;
  onSave: (reason: string) => void;
}

export function LostReasonDialog({ open, company, quote, onClose, onSave }: LostReasonProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setReason("");
    setError("");
  }, [open, quote?.id]);

  const submit = () => {
    const value = reason.trim();
    if (!value) {
      setError("Alasan wajib diisi supaya bisa dievaluasi nanti.");
      return;
    }
    onSave(value);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tandai cancel"
      subtitle={
        company
          ? quote
            ? `${company.name} tidak melanjutkan penawaran ini.`
            : `${company.name} membatalkan kerja sama.`
          : undefined
      }
      width={520}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Batal
          </button>
          <button type="button" className="btn btn-danger" onClick={submit}>
            Tandai cancel
          </button>
        </>
      }
    >
      {quote ? (
        <div className="dialog-quote-ref">
          <AlertIcon size={16} />
          <span>
            Nomor penawaran <strong>{quote.number}</strong> ·{" "}
            {formatShortDate(quote.date)}
          </span>
        </div>
      ) : null}
      <div className="field field-full">
        <label htmlFor="lost-reason">Alasan cancel</label>
        <textarea
          id="lost-reason"
          autoFocus
          rows={4}
          value={reason}
          placeholder="Contoh: harga masih di atas anggaran, memilih provider lain, proyek ditunda…"
          onChange={(event) => {
            setReason(event.target.value);
            setError("");
          }}
        />
        <span className="field-hint">Alasan ini muncul di dasbor Cancel.</span>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
    </Modal>
  );
}

export interface PoUploadInput {
  /** PDF baru; null berarti pakai PDF PO yang sudah tersimpan. */
  file: StoredFile | null;
  amount: number;
  years: number;
}

interface PoUploadProps {
  open: boolean;
  company: Company | null;
  quote: QuoteRecord | null;
  onClose: () => void;
  onSave: (input: PoUploadInput) => void;
}

export function PoUploadDialog({ open, company, quote, onClose, onSave }: PoUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [amountText, setAmountText] = useState("");
  const [yearsText, setYearsText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const existingPo = quote?.poFile ?? null;
  const amount = parseAmount(amountText);
  const ppn = ppnOf(amount);
  const commission = commissionOf(amount);
  const years = parseAmount(yearsText);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setAmountText(
      quote && quote.poAmount > 0 ? quote.poAmount.toLocaleString("id-ID") : "",
    );
    setYearsText(quote && quote.poYears > 0 ? String(quote.poYears) : "");
    setError("");
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, quote?.id]);

  const pickFile = (next: File | null) => {
    setError("");
    if (!next) {
      setFile(null);
      return;
    }
    const validation = validatePdf(next);
    if (validation) {
      setError(validation);
      setFile(null);
      return;
    }
    setFile(next);
  };

  const submit = async () => {
    if (!file && !existingPo) {
      setError("Pilih file PDF PO dari perusahaan terlebih dahulu.");
      return;
    }
    if (amount <= 0) {
      setError("Besaran PO dalam rupiah wajib diisi.");
      return;
    }
    if (yearsText.trim() && (years <= 0 || years > 99)) {
      setError("Lama kontrak diisi dalam tahun, misalnya 2. Boleh dikosongkan.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const uploaded = file ? await uploadPdf(file) : null;
      onSave({ file: uploaded, amount, years: yearsText.trim() ? years : 0 });
      onClose();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Gagal mengunggah PDF.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={existingPo ? "Perbarui data PO" : "Upload PO"}
      subtitle={
        company
          ? `${company.name} jadi menggunakan penawaran Anda. Unggah PDF PO dan isi nilai PO-nya.`
          : undefined
      }
      width={580}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? "Mengunggah…" : existingPo ? "Simpan perubahan" : "Simpan & jadikan PO"}
          </button>
        </>
      }
    >
      {quote ? (
        <div className="dialog-quote-ref dialog-quote-ref-success">
          <FileIcon size={16} />
          <span>
            Penawaran <strong>{quote.number}</strong> akan berstatus <strong>PO</strong>.
          </span>
        </div>
      ) : null}

      <PdfDrop file={file} disabled={busy} onPick={pickFile} />
      <p className="field-hint">
        {existingPo && !file
          ? `PDF PO tersimpan: ${existingPo.name}. Pilih file baru hanya bila ingin menggantinya.`
          : "PDF PO hanya bisa dibuka dari akun Anda."}
      </p>

      <div className="form-grid po-fields">
        <div className="field">
          <label htmlFor="po-amount">Besaran PO (sebelum PPN)</label>
          <div className="input-prefix">
            <span>Rp</span>
            <input
              id="po-amount"
              inputMode="numeric"
              value={amountText}
              placeholder="mis. 259.459.464"
              onChange={(event) => {
                const digits = event.target.value.replace(/[^\d]/g, "").slice(0, 15);
                setAmountText(digits ? Number(digits).toLocaleString("id-ID") : "");
                setError("");
              }}
              disabled={busy}
            />
          </div>
          <span className="field-hint">Nilai PO dari perusahaan sebelum dikenakan PPN.</span>
        </div>

        <div className="field">
          <label htmlFor="po-years">Lama kontrak (tahun)</label>
          <input
            id="po-years"
            inputMode="numeric"
            value={yearsText}
            placeholder="Tidak wajib diisi"
            onChange={(event) => {
              const digits = event.target.value.replace(/[^\d]/g, "").slice(0, 2);
              setYearsText(digits);
              setError("");
            }}
            disabled={busy}
          />
          <span className="field-hint">Boleh dikosongkan bila belum ditentukan.</span>
        </div>
      </div>

      <div className="po-summary">
        <div className="po-summary-row">
          <span>Besaran PO</span>
          <strong>{formatIDR(amount)}</strong>
        </div>
        <div className="po-summary-row">
          <span>PPN 11%</span>
          <strong>{formatIDR(ppn)}</strong>
        </div>
        <div className="po-summary-row">
          <span>Total PO termasuk PPN</span>
          <strong>{formatIDR(amount + ppn)}</strong>
        </div>
        <div className="po-summary-row po-summary-highlight">
          <span>Komisi 10% (dari PO sebelum PPN)</span>
          <strong>{formatIDR(commission)}</strong>
        </div>
      </div>

      {error ? <p className="form-error">{error}</p> : null}
      {busy ? <p className="form-progress">Menyimpan PDF PO ke akun Anda…</p> : null}
    </Modal>
  );
}

interface SignedBastProps {
  open: boolean;
  company: Company | null;
  quote: QuoteRecord | null;
  onClose: () => void;
  onSave: (file: StoredFile) => void;
}

/** Upload PDF BAST yang sudah ditandatangani pengguna layanan. */
export function SignedBastDialog({ open, company, quote, onClose, onSave }: SignedBastProps) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const existing = quote?.bastSignedFile ?? null;

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setError("");
    setBusy(false);
  }, [open, quote?.id]);

  const pickFile = (next: File | null) => {
    setError("");
    if (!next) {
      setFile(null);
      return;
    }
    const validation = validatePdf(next);
    if (validation) {
      setError(validation);
      setFile(null);
      return;
    }
    setFile(next);
  };

  const submit = async () => {
    if (!file) {
      setError("Pilih file PDF BAST yang sudah ditandatangani perusahaan.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const uploaded = await uploadPdf(file);
      onSave(uploaded);
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
      title="BAST dari Perusahaan"
      subtitle={
        company
          ? `${company.name} · unggah PDF BAST yang sudah ditandatangani pengguna layanan.`
          : undefined
      }
      width={580}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={busy}
          >
            {busy ? "Mengunggah…" : "Simpan BAST dari Perusahaan"}
          </button>
        </>
      }
    >
      <div className="dialog-quote-ref dialog-quote-ref-success">
        <FileIcon size={16} />
        <span>
          Setelah PDF tersimpan, status perusahaan berubah menjadi{" "}
          <strong>BAST Selesai</strong>.
        </span>
      </div>

      <PdfDrop file={file} disabled={busy} onPick={pickFile} />
      <p className="field-hint">
        {existing
          ? `PDF BAST bertanda tangan tersimpan: ${existing.name}. Pilih file baru untuk menggantinya.`
          : "PDF ini disimpan di akun Anda dan bisa dibuka kembali dari detail perusahaan."}
      </p>

      {error ? <p className="form-error">{error}</p> : null}
      {busy ? <p className="form-progress">Menyimpan PDF BAST ke akun Anda…</p> : null}
    </Modal>
  );
}
