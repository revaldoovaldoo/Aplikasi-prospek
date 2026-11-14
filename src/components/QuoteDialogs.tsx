import { useEffect, useRef, useState } from "react";
import type { Company, QuoteRecord, StoredFile } from "../types";
import {
  commissionOf,
  formatFileSize,
  formatIDR,
  formatShortDate,
  parseAmount,
  ppnOf,
  todayISO,
} from "../lib/data";
import { MAX_PDF_BYTES, uploadPdf } from "../lib/api";
import { extractQuoteNumber } from "../lib/pdf";
import { Modal } from "./Dialogs";
import { AlertIcon, FileIcon, UploadIcon } from "./icons";

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
  onClose: () => void;
  onSave: (input: {
    companyId: string;
    number: string;
    date: string;
    quoteFile: StoredFile;
  }) => void;
}

export function QuoteUploadDialog({ open, company, existing, onClose, onSave }: QuoteUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(todayISO());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [detected, setDetected] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setNumber(existing?.number ?? "");
    setDate(existing?.date ?? todayISO());
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

    if (!number.trim()) {
      setReading(true);
      const found = await extractQuoteNumber(next);
      setReading(false);
      if (found) {
        setNumber(found);
        setDetected(true);
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
      <div className="form-grid">
        <div className="field field-full">
          <label>File PDF penawaran</label>
          <PdfDrop file={file} disabled={busy} onPick={(next) => void pickFile(next)} />
          {file ? (
            <span className="field-hint">
              {reading
                ? "Membaca nomor penawaran dari PDF…"
                : detected
                  ? "Nomor terdeteksi otomatis dari PDF. Periksa dan koreksi bila perlu."
                  : "Nomor bisa Anda isi manual di bawah."}
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
            disabled={busy}
          />
        </div>

        <div className="field">
          <label htmlFor="quote-date">Tanggal penawaran</label>
          <input
            id="quote-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            disabled={busy}
          />
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
