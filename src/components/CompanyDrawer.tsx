import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Company, QuoteRecord, StoredFile } from "../types";
import {
  companyStatusOf,
  formatFileSize,
  formatIDR,
  formatShortDate,
  formatYears,
  quoteFiles,
  type CompanyStatus,
} from "../lib/data";
import { downloadUrl, pdfUrl } from "../lib/api";
import { websiteHost } from "../lib/corporate";
import LocationMap, { googleMapsUrl } from "./LocationMap";
import StatusBadge from "./StatusBadge";
import PdfPrintDialog from "./PdfPrintDialog";
import {
  AlertIcon,
  CalendarIcon,
  CloseIcon,
  DocumentIcon,
  DownloadIcon,
  FileIcon,
  GlobeIcon,
  MailIcon,
  PencilIcon,
  PhoneIcon,
  PinIcon,
  PrinterIcon,
  TrashIcon,
  UploadIcon,
  UsersIcon,
} from "./icons";

interface Props {
  company: Company | null;
  quote: QuoteRecord | null;
  onClose: () => void;
  onEdit: (company: Company) => void;
  onUploadQuote: (companyId: string) => void;
  onMarkLost: (company: Company) => void;
  onUploadPo: (quote: QuoteRecord) => void;
  onOpenBast: (quote: QuoteRecord) => void;
  onUploadSignedBast: (quote: QuoteRecord) => void;
  onDelete: (company: Company) => void;
  onDeleteQuoteFile: (company: Company, quote: QuoteRecord, file: StoredFile) => void;
  onCreateQuote: (companyId: string) => void;
}

function FileRow({
  label,
  file,
  onPrint,
  onDelete,
}: {
  label: string;
  file: StoredFile;
  onPrint: (file: StoredFile, label: string) => void;
  onDelete?: () => void;
}) {
  return (
    <div className="drawer-file">
      <a className="drawer-file-open" href={pdfUrl(file.id)} target="_blank" rel="noreferrer">
        <span className="drawer-file-icon">
          <FileIcon size={17} />
        </span>
        <span className="drawer-file-main">
          <strong>{label}</strong>
          <span>
            {file.name} · {formatFileSize(file.size)}
          </span>
        </span>
      </a>
      <div className="drawer-file-actions">
        <a
          className="drawer-file-action"
          href={downloadUrl(file.id)}
          download={file.name}
          aria-label={`Unduh ${label}`}
          title="Unduh PDF"
        >
          <DownloadIcon size={16} />
        </a>
        <button
          type="button"
          className="drawer-file-action"
          onClick={() => onPrint(file, label)}
          aria-label={`Cetak ${label}`}
          title="Cetak PDF"
        >
          <PrinterIcon size={16} />
        </button>
        {onDelete ? (
          <button
            type="button"
            className="drawer-file-action drawer-file-delete"
            onClick={onDelete}
            aria-label={`Hapus ${label}`}
            title="Hapus PDF"
          >
            <TrashIcon size={16} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default function CompanyDrawer({
  company,
  quote,
  onClose,
  onEdit,
  onUploadQuote,
  onMarkLost,
  onUploadPo,
  onOpenBast,
  onUploadSignedBast,
  onDelete,
  onDeleteQuoteFile,
  onCreateQuote,
}: Props) {
  const [printTarget, setPrintTarget] = useState<{ file: StoredFile; label: string } | null>(null);

  useEffect(() => {
    if (!company) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [company, onClose]);

  useEffect(() => {
    setPrintTarget(null);
  }, [company?.id]);

  if (!company) return null;

  const status: CompanyStatus = companyStatusOf(company, quote);
  const mapLatitude = Number(company.latitude);
  const mapLongitude = Number(company.longitude);
  const hasMapCoordinate =
    Number.isFinite(mapLatitude) &&
    mapLatitude !== 0 &&
    Number.isFinite(mapLongitude) &&
    mapLongitude !== 0;
  const mapsHref = hasMapCoordinate
    ? googleMapsUrl(mapLatitude, mapLongitude)
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        `${company.name}, ${company.location}`,
      )}`;

  const poStage =
    status === "po" || status === "bast-terkirim" || status === "bast-selesai";
  const quotePdfs = quote ? quoteFiles(quote) : [];

  return createPortal(
    <>
      <div className="overlay overlay-right" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <aside className="drawer" role="dialog" aria-modal="true" aria-label={company.name}>
        <div className="drawer-head">
          <span className="avatar avatar-lg">{company.name.slice(0, 1).toUpperCase()}</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Tutup">
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="drawer-title">
          <h2>{company.name}</h2>
          <a
            className="chip chip-location"
            href={mapsHref}
            target="_blank"
            rel="noreferrer"
            title={
              hasMapCoordinate
                ? "Buka titik koordinat perusahaan di Google Maps"
                : "Buka wilayah perusahaan di Google Maps"
            }
          >
            <PinIcon size={13} /> {company.location}
          </a>
        </div>

        <div className="drawer-body">
          <div className="info-grid">
            <div className="info-row">
              <MailIcon size={16} />
              <div>
                <span>Email</span>
                {company.email ? (
                  <a href={`mailto:${company.email}`}>{company.email}</a>
                ) : (
                  <strong className="muted">Belum diisi</strong>
                )}
              </div>
            </div>
            <div className="info-row">
              <UsersIcon size={16} />
              <div>
                <span>PIC</span>
                {company.contactName ? (
                  <>
                    <strong>{company.contactName}</strong>
                    {company.contactRole ? (
                      <span className="company-contact-role">{company.contactRole}</span>
                    ) : null}
                    {company.contactSource ? (
                      <span className="company-contact-source">{company.contactSource}</span>
                    ) : null}
                  </>
                ) : (
                  <strong className="muted">Belum diisi</strong>
                )}
              </div>
            </div>
            <div className="info-row">
              <GlobeIcon size={16} />
              <div>
                <span>Website</span>
                {company.website ? (
                  <a
                    href={company.website}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {websiteHost(company.website)}
                  </a>
                ) : (
                  <strong className="muted">Belum diisi</strong>
                )}
              </div>
            </div>
            <div className="info-row">
              <PhoneIcon size={16} />
              <div>
                <span>No. PIC</span>
                {company.picPhone ? (
                  <strong>{company.picPhone}</strong>
                ) : (
                  <strong className="muted">Belum diisi</strong>
                )}
              </div>
            </div>
            <div className="info-row">
              <CalendarIcon size={16} />
              <div>
                <span>Tanggal visit</span>
                <strong>{company.visitDate ? formatShortDate(company.visitDate) : "Belum visit"}</strong>
              </div>
            </div>
          </div>

          <LocationMap
            latitude={company.latitude}
            longitude={company.longitude}
            address={company.coordinateAddress}
            source={company.coordinateSource}
          />

          {company.validationStatus === "verified" ? (
            <div className="lead-validation-ok">
              <span className="lead-validation-dot" />
              Terverifikasi robot: website, e-mail PIC, telepon PIC, dan koordinat.
            </div>
          ) : null}

          {company.sourceLeadId && company.validationStatus !== "verified" ? (
            <div className="lead-validation-warn">
              Data disalin dari Robot AI, tetapi validasi website, e-mail PIC, telepon
              PIC, atau koordinat belum lengkap.
            </div>
          ) : null}

          <div className="drawer-section-head">
            <h3>Penawaran</h3>
            {quote || company.lostAt ? <StatusBadge status={status} /> : null}
          </div>

          {!quote ? (
            status === "tidak-jadi" ? (
              <div className="reason-box">
                <span className="reason-box-head">
                  <AlertIcon size={15} /> Alasan cancel
                </span>
                <p>{company.lostReason || "Tanpa alasan"}</p>
                {company.lostAt ? (
                  <span className="reason-box-date">
                    Dicatat {formatShortDate(company.lostAt)}
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="quote-empty">
                <span className="quote-empty-icon">
                  <UploadIcon size={20} />
                </span>
                <div>
                  <strong>Belum ada PDF penawaran</strong>
                  <p>Unggah PDF yang sudah Anda kirim, atau tandai cancel bila perusahaan menolak.</p>
                </div>
                <div className="quote-actions quote-empty-actions">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onCreateQuote(company.id)}
                  >
                    <FileIcon size={15} /> Buat penawaran
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => onUploadQuote(company.id)}
                  >
                    <UploadIcon size={15} /> Upload PDF
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-danger-outline"
                    onClick={() => onMarkLost(company)}
                  >
                    <AlertIcon size={15} /> Cancel
                  </button>
                </div>
              </div>
            )
          ) : (
            <div className="quote-card">
              <div className="quote-card-head">
                <div>
                  <span className="quote-card-label">Nomor penawaran</span>
                  <strong className="mono quote-card-number">{quote.number}</strong>
                </div>
                <span className="quote-card-date">{formatShortDate(quote.date)}</span>
              </div>

              <div className="quote-file-list">
                <div className="quote-file-list-head">
                  <span>Semua PDF penawaran</span>
                  <strong>{quotePdfs.length} file</strong>
                </div>
                {quotePdfs.map((saved, index) => (
                  <FileRow
                    key={saved.id}
                    label={
                      index === 0
                        ? "PDF penawaran terbaru"
                        : `PDF penawaran versi ${quotePdfs.length - index}`
                    }
                    file={saved}
                    onPrint={(file, label) => setPrintTarget({ file, label })}
                    onDelete={() => onDeleteQuoteFile(company, quote, saved)}
                  />
                ))}
              </div>

              <div className="quote-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onCreateQuote(company.id)}
                >
                  <FileIcon size={15} /> Buat ulang PDF penawaran
                </button>
                {status !== "tidak-jadi" ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => onUploadQuote(company.id)}
                  >
                    <UploadIcon size={15} /> Perbarui PDF penawaran
                  </button>
                ) : null}
              </div>

              {status === "tidak-jadi" ? (
                <div className="reason-box">
                  <span className="reason-box-head">
                    <AlertIcon size={15} /> Alasan cancel
                  </span>
                  <p>{quote.lostReason || "Tanpa alasan"}</p>
                  {quote.lostAt ? (
                    <span className="reason-box-date">
                      Dicatat {formatShortDate(quote.lostAt)}
                    </span>
                  ) : null}
                </div>
              ) : null}

              {poStage && quote.poFile ? (
                <div className="po-box">
                  <span className="po-box-head">
                    <FileIcon size={15} /> PO dari Perusahaan
                  </span>
                  <FileRow
                    label="PDF PO"
                    file={quote.poFile}
                    onPrint={(file, label) => setPrintTarget({ file, label })}
                  />
                  {quote.poAmount > 0 ? (
                    <div className="po-values">
                      <div className="po-value-row">
                        <span>Besaran PO</span>
                        <strong>{formatIDR(quote.poAmount)}</strong>
                      </div>
                      <div className="po-value-row">
                        <span>PPN 11%</span>
                        <strong>{formatIDR(quote.poPpn)}</strong>
                      </div>
                      <div className="po-value-row">
                        <span>Total termasuk PPN</span>
                        <strong>{formatIDR(quote.poAmount + quote.poPpn)}</strong>
                      </div>
                      <div className="po-value-row">
                        <span>Lama kontrak</span>
                        <strong>{formatYears(quote.poYears)}</strong>
                      </div>
                      <div className="po-value-row po-value-commission">
                        <span>Komisi 10%</span>
                        <strong>{formatIDR(quote.poCommission)}</strong>
                      </div>
                    </div>
                  ) : (
                    <span className="reason-box-date">Nilai PO belum diisi.</span>
                  )}
                  {quote.poAt ? (
                    <span className="reason-box-date">Diterima {formatShortDate(quote.poAt)}</span>
                  ) : null}
                  <div className="quote-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => onUploadPo(quote)}
                    >
                      <PencilIcon size={15} />
                      {quote.poAmount > 0 ? " Perbarui data PO" : " Lengkapi nilai PO"}
                    </button>
                  </div>
                </div>
              ) : null}

              {poStage && quote.poFile ? (
                <div className="bast-box">
                  <span className="bast-box-head">
                    <DocumentIcon size={15} /> BAST
                  </span>
                  {quote.bastFile ? (
                    <FileRow
                      label="PDF BAST"
                      file={quote.bastFile}
                      onPrint={(file, label) => setPrintTarget({ file, label })}
                    />
                  ) : (
                    <p className="bast-empty-copy">
                      Buat berita acara serah terima setelah PO diterima.
                    </p>
                  )}
                  <div className="quote-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => onOpenBast(quote)}
                    >
                      <DocumentIcon size={15} />
                      {quote.bastFile ? " Perbarui BAST" : " Buat BAST"}
                    </button>
                  </div>

                  {quote.bastFile ? (
                    <div className="bast-company">
                      <span className="bast-company-head">
                        <UploadIcon size={14} /> BAST dari Perusahaan
                      </span>
                      {quote.bastSignedFile ? (
                        <>
                          <FileRow
                            label="PDF BAST bertanda tangan"
                            file={quote.bastSignedFile}
                            onPrint={(file, label) => setPrintTarget({ file, label })}
                          />
                          {quote.bastSignedAt ? (
                            <span className="bast-company-date">
                              Diterima {formatShortDate(quote.bastSignedAt)}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <p className="bast-empty-copy">
                          Unggah PDF BAST yang sudah ditandatangani pengguna layanan.
                        </p>
                      )}
                      <div className="quote-actions">
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={() => onUploadSignedBast(quote)}
                        >
                          <UploadIcon size={15} /> BAST dari Perusahaan
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="quote-actions">
                {status === "penawaran" ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onUploadPo(quote)}
                  >
                    <UploadIcon size={15} /> Upload PO
                  </button>
                ) : null}
                {status === "penawaran" ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-danger-outline"
                    onClick={() => onMarkLost(company)}
                  >
                    <AlertIcon size={15} /> Cancel
                  </button>
                ) : null}

              </div>
            </div>
          )}

          <div className="drawer-actions">
            <button type="button" className="btn btn-secondary" onClick={() => onEdit(company)}>
              <PencilIcon size={15} /> Edit data perusahaan
            </button>
          </div>
        </div>

        <div className="drawer-foot">
          <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => onDelete(company)}>
            <TrashIcon size={15} /> Hapus perusahaan
          </button>
        </div>
        </aside>
      </div>
      <PdfPrintDialog
        open={Boolean(printTarget)}
        file={printTarget?.file ?? null}
        label={printTarget?.label ?? "PDF"}
        onClose={() => setPrintTarget(null)}
      />
    </>,
    document.body,
  );
}
