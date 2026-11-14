import { useEffect, useRef } from "react";
import type { Company, Quote, SyncState } from "../types";
import {
  autoQuoteNumber,
  displayQuoteNumber,
  formatShortDate,
  quoteFileName,
  romanMonth,
  yearOf,
} from "../lib/data";
import QuoteDocument from "./QuoteDocument";
import {
  ArrowLeftIcon,
  CheckIcon,
  FileIcon,
  PinIcon,
  PrinterIcon,
  TrashIcon,
} from "./icons";

interface Props {
  quote: Quote | null;
  company: Company | null;
  onChange: (quote: Quote) => void;
  onDelete: (quote: Quote) => void;
  onBack: () => void;
  syncState: SyncState;
  lastSyncedAt: string | null;
}

export default function QuoteEditor({
  quote,
  company,
  onChange,
  onDelete,
  onBack,
  syncState,
  lastSyncedAt,
}: Props) {
  const baseTitle = useRef(document.title);
  const filename = quote && company ? quoteFileName(company, quote) : "";

  useEffect(() => {
    if (filename) document.title = filename;
  }, [filename]);

  useEffect(() => {
    const initial = baseTitle.current;
    return () => {
      document.title = initial;
    };
  }, []);

  if (!quote || !company) {
    return (
      <div className="page page-narrow">
        <div className="not-found">
          <FileIcon size={28} />
          <h1>Penawaran tidak ditemukan</h1>
          <p>Draft mungkin sudah dihapus. Kembali ke daftar penawaran untuk membuat yang baru.</p>
          <button type="button" className="btn btn-primary" onClick={onBack}>
            Kembali
          </button>
        </div>
      </div>
    );
  }

  const set = (patch: Partial<Quote>) => onChange({ ...quote, ...patch });
  const auto = autoQuoteNumber(quote.seq, quote.date);
  const syncTime = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleTimeString("id-ID", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const syncLabel =
    syncState === "saving"
      ? "Menyimpan…"
      : syncState === "error"
        ? "Belum tersimpan"
        : syncState === "conflict"
          ? "Perlu sinkron"
          : syncTime
            ? `Tersinkron ${syncTime}`
            : "Tersinkron";
  const syncTone =
    syncState === "error" || syncState === "conflict"
      ? " is-error"
      : syncState === "saving"
        ? " is-pending"
        : "";

  return (
    <div className="editor">
      <header className="editor-topbar">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Kembali">
          <ArrowLeftIcon size={18} />
        </button>
        <div className="editor-crumb">
          <span>Penawaran</span>
          <strong>{displayQuoteNumber(quote)}</strong>
          <span className="editor-crumb-company">{company.name}</span>
        </div>
        <div className="editor-topbar-actions">
          <span className={`saved-chip${syncTone}`} title={syncLabel}>
            {syncState === "saved" || syncState === "idle" ? (
              <CheckIcon size={13} />
            ) : (
              <span className="chip-dot" />
            )}
            <span className="saved-label">{syncLabel}</span>
          </span>
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            <PrinterIcon size={16} /> Simpan PDF
          </button>
        </div>
      </header>

      <div className="editor-body">
        <div className="doc-stage">
          <div className="doc-stage-bar no-print">
            <span className="doc-stage-hint">
              Klik teks mana pun pada draft untuk mengedit langsung.
            </span>
            <span className="doc-stage-page">A4 · 210 × 297 mm</span>
          </div>
          <QuoteDocument quote={quote} company={company} onChange={onChange} />
        </div>

        <aside className="editor-panel">
          <div className="panel-section">
            <div className="panel-title">Perusahaan</div>
            <div className="panel-company">
              <span className="avatar">{company.name.slice(0, 1).toUpperCase()}</span>
              <div>
                <strong>{company.name}</strong>
                <span>
                  <PinIcon size={12} /> {company.location}
                </span>
              </div>
            </div>
            {company.visitDate ? (
              <p className="panel-note">Visit {formatShortDate(company.visitDate)}</p>
            ) : null}
          </div>

          <div className="panel-section">
            <div className="panel-title">Nomor penawaran</div>
            <div className="panel-grid">
              <label className="field">
                <span>Tanggal</span>
                <input
                  type="date"
                  value={quote.date}
                  onChange={(event) => set({ date: event.target.value })}
                />
              </label>
              <label className="field">
                <span>Nomor urut</span>
                <input
                  type="number"
                  min={1}
                  value={quote.seq}
                  onChange={(event) =>
                    set({ seq: Math.max(1, Number(event.target.value) || 1) })
                  }
                />
              </label>
            </div>
            <label className="field">
              <span>Nomor lengkap</span>
              <input
                value={quote.numberOverride || auto}
                onChange={(event) => set({ numberOverride: event.target.value })}
                spellCheck={false}
              />
            </label>
            <div className="panel-hint-row">
              <p className="panel-note">
                Otomatis: <strong>{autoQuoteNumber(quote.seq, quote.date)}</strong>
                <br />
                Bulan {romanMonth(quote.date)} · {yearOf(quote.date)}
              </p>
              {quote.numberOverride ? (
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => set({ numberOverride: "" })}
                >
                  Pakai otomatis
                </button>
              ) : null}
            </div>
          </div>

          <div className="panel-section">
            <div className="panel-title">Tujuan penawaran</div>
            <label className="field">
              <span>Nama kontak person</span>
              <input
                value={quote.contactPerson}
                placeholder="Bapak Syahlan"
                onChange={(event) => set({ contactPerson: event.target.value })}
              />
            </label>
            <div className="panel-grid">
              <label className="field">
                <span>Kota</span>
                <input value={quote.city} onChange={(event) => set({ city: event.target.value })} />
              </label>
              <label className="field">
                <span>Lampiran</span>
                <input
                  value={quote.lampiran}
                  onChange={(event) => set({ lampiran: event.target.value })}
                />
              </label>
            </div>
            <label className="field">
              <span>Hal</span>
              <input value={quote.hal} onChange={(event) => set({ hal: event.target.value })} />
            </label>
          </div>

          <div className="panel-section">
            <div className="panel-title">Penandatangan</div>
            <label className="field">
              <span>Nama</span>
              <input
                value={quote.signerName}
                onChange={(event) => set({ signerName: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Nomor telepon</span>
              <input
                value={quote.signerPhone}
                onChange={(event) => set({ signerPhone: event.target.value })}
              />
            </label>
          </div>

          <div className="panel-section panel-print">
            <div className="panel-title">Simpan sebagai PDF</div>
            <p className="panel-note">
              Tekan <strong>Simpan PDF</strong>, lalu pilih tujuan <strong>“Save as PDF”</strong> pada
              dialog cetak. Draft akan tersimpan sebagai file PDF ukuran A4.
            </p>
            <button type="button" className="btn btn-secondary btn-block" onClick={() => window.print()}>
              <PrinterIcon size={16} /> Cetak draft
            </button>
          </div>

          <div className="panel-section panel-danger">
            <button
              type="button"
              className="btn btn-ghost btn-danger-text btn-block"
              onClick={() => onDelete(quote)}
            >
              <TrashIcon size={15} /> Hapus penawaran
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
