import { useMemo, useState } from "react";
import type { Company, QuoteRecord } from "../types";
import {
  companyStatus,
  formatCompactIDR,
  formatIDR,
  formatShortDate,
  uploadedQuotes,
  type CompanyStatus,
} from "../lib/data";
import { pdfUrl } from "../lib/api";
import StatusBadge from "./StatusBadge";
import {
  BuildingIcon,
  ChevronRightIcon,
  DocumentIcon,
  FileIcon,
  PlusIcon,
  SearchIcon,
  UploadIcon,
} from "./icons";

interface Props {
  quotes: QuoteRecord[];
  companies: Company[];
  onUploadQuote: () => void;
  onOpenCompany: (id: string) => void;
}

type StatusFilter = "all" | CompanyStatus;

export default function QuotesPage({ quotes, companies, onUploadQuote, onOpenCompany }: Props) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const companyById = useMemo(() => {
    const map = new Map<string, Company>();
    for (const company of companies) map.set(company.id, company);
    return map;
  }, [companies]);

  const uploaded = uploadedQuotes(quotes);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return uploaded
      .filter((quote) => {
        const company = companyById.get(quote.companyId);
        const matchQuery =
          !q ||
          quote.number.toLowerCase().includes(q) ||
          (company?.name.toLowerCase().includes(q) ?? false);
        const matchStatus = status === "all" || companyStatus(quote) === status;
        return matchQuery && matchStatus;
      })
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }, [uploaded, query, status, companyById]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Laporan</p>
          <h1>Penawaran</h1>
          <p className="page-sub">
            Report penawaran berisi nomor dari PDF yang Anda unggah, beserta statusnya.
          </p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-primary" onClick={onUploadQuote}>
            <PlusIcon size={16} /> Upload penawaran
          </button>
        </div>
      </header>

      <div className="panel">
        <div className="filter-bar">
          <div className="search-box">
            <SearchIcon size={16} />
            <input
              value={query}
              placeholder="Cari nomor penawaran atau perusahaan"
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Cari penawaran"
            />
          </div>
          <select
            className="select"
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
            aria-label="Filter status"
          >
            <option value="all">Semua status</option>
            <option value="penawaran">Penawaran</option>
            <option value="po">PO</option>
            <option value="bast-terkirim">BAST sudah terkirim</option>
            <option value="bast-selesai">BAST Selesai</option>
            <option value="tidak-jadi">Cancel</option>
          </select>
          <span className="filter-count">{filtered.length} penawaran</span>
        </div>

        {uploaded.length === 0 ? (
          <div className="empty">
            <span className="empty-icon">
              <FileIcon size={26} />
            </span>
            <h2>Belum ada penawaran</h2>
            <p>Unggah PDF penawaran yang sudah Anda kirim ke perusahaan.</p>
            <button type="button" className="btn btn-primary" onClick={onUploadQuote}>
              <UploadIcon size={16} /> Upload penawaran
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty empty-sm">
            <h2>Tidak ada hasil</h2>
            <p>Coba kata kunci atau status lain.</p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setQuery("");
                setStatus("all");
              }}
            >
              Reset filter
            </button>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Nomor penawaran</th>
                    <th>Perusahaan</th>
                    <th>Tanggal</th>
                    <th>Status</th>
                    <th>PDF</th>
                    <th aria-label="Aksi" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((quote) => {
                    const company = companyById.get(quote.companyId);
                    return (
                      <tr
                        key={quote.id}
                        className="row-click"
                        onClick={() => onOpenCompany(quote.companyId)}
                      >
                        <td>
                          <div className="cell-company">
                            <span className="avatar avatar-doc">
                              <DocumentIcon size={15} />
                            </span>
                            <div>
                              <strong className="mono">{quote.number}</strong>
                              <span className="cell-sub">
                                Diunggah {formatShortDate(quote.createdAt.slice(0, 10))}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <div className="cell-company cell-company-plain">
                            <div>
                              <strong>{company?.name ?? "Perusahaan dihapus"}</strong>
                              <span className="cell-sub">
                                {company ? (
                                  <>
                                    <BuildingIcon size={12} /> {company.location}
                                  </>
                                ) : (
                                  "—"
                                )}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>{formatShortDate(quote.date)}</td>
                        <td>
                          <div className="cell-quote">
                            <StatusBadge status={companyStatus(quote)} />
                            {quote.poAmount > 0 ? (
                              <>
                                <span className="cell-sub" title={formatIDR(quote.poAmount)}>
                                  PO {formatCompactIDR(quote.poAmount)}
                                </span>
                                <span className="cell-sub">
                                  Komisi {formatCompactIDR(quote.poCommission)}
                                </span>
                              </>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <a
                            className="file-link"
                            href={pdfUrl(quote.quoteFile.id)}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <FileIcon size={14} /> Lihat PDF
                          </a>
                        </td>
                        <td>
                          <div className="cell-actions">
                            <button
                              type="button"
                              className="btn btn-mini btn-secondary"
                              onClick={(event) => {
                                event.stopPropagation();
                                onOpenCompany(quote.companyId);
                              }}
                            >
                              Detail
                            </button>
                            <ChevronRightIcon size={16} className="row-chevron" />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="table-foot">
              {filtered.length} penawaran · Hanya nomor dari PDF yang diunggah yang masuk laporan.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
