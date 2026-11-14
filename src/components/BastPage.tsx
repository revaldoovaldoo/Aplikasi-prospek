import { useMemo, useState } from "react";
import type { Company, QuoteRecord } from "../types";
import {
  bastEntries,
  formatShortDate,
  type BastStatus,
} from "../lib/data";
import { pdfUrl } from "../lib/api";
import StatusBadge from "./StatusBadge";
import {
  BuildingIcon,
  CheckIcon,
  ChevronRightIcon,
  DocumentIcon,
  FileIcon,
  SearchIcon,
} from "./icons";

interface Props {
  quotes: QuoteRecord[];
  companies: Company[];
  onOpenCompany: (id: string) => void;
}

type StatusFilter = "all" | BastStatus;

export default function BastPage({ quotes, companies, onOpenCompany }: Props) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const entries = useMemo(() => bastEntries(companies, quotes), [companies, quotes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((entry) => {
      const matchStatus = status === "all" || entry.status === status;
      const matchQuery =
        !q ||
        entry.company.name.toLowerCase().includes(q) ||
        entry.quote.number.toLowerCase().includes(q) ||
        (entry.quote.bast?.customerPic ?? "").toLowerCase().includes(q);
      return matchStatus && matchQuery;
    });
  }, [entries, query, status]);

  const completed = entries.filter((entry) => entry.status === "bast-selesai").length;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Laporan</p>
          <h1>BAST</h1>
          <p className="page-sub">
            Perusahaan yang sudah melakukan Berita Acara Serah Terima, lengkap dengan
            dokumen BAST dan tanda tangan perusahaan.
          </p>
        </div>
      </header>

      <div className="stats stats-2">
        <div className="stat">
          <span className="stat-icon tone-blue">
            <DocumentIcon size={18} />
          </span>
          <div>
            <span className="stat-label">Total BAST</span>
            <strong className="stat-value">{entries.length}</strong>
            <span className="stat-note">Perusahaan dengan dokumen BAST</span>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon tone-green">
            <CheckIcon size={18} />
          </span>
          <div>
            <span className="stat-label">BAST Selesai</span>
            <strong className="stat-value">{completed}</strong>
            <span className="stat-note">Dokumen bertanda tangan sudah diterima</span>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="filter-bar">
          <div className="search-box">
            <SearchIcon size={16} />
            <input
              value={query}
              placeholder="Cari perusahaan, nomor penawaran, atau PIC"
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Cari BAST"
            />
          </div>
          <select
            className="select"
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
            aria-label="Filter status BAST"
          >
            <option value="all">Semua status</option>
            <option value="bast-terkirim">BAST sudah terkirim</option>
            <option value="bast-selesai">BAST Selesai</option>
          </select>
          <span className="filter-count">{filtered.length} BAST</span>
        </div>

        {entries.length === 0 ? (
          <div className="empty">
            <span className="empty-icon">
              <DocumentIcon size={26} />
            </span>
            <h2>Belum ada BAST</h2>
            <p>
              BAST muncul setelah Anda membuat dokumen BAST dari penawaran yang sudah
              memiliki PO. Buka detail perusahaan untuk membuatnya.
            </p>
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
                    <th>Perusahaan</th>
                    <th>Nomor penawaran</th>
                    <th>Tanggal BAST</th>
                    <th>PIC</th>
                    <th>Status</th>
                    <th>Dokumen</th>
                    <th aria-label="Aksi" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((entry) => {
                    const { company, quote } = entry;
                    return (
                      <tr
                        key={entry.key}
                        className="row-click"
                        onClick={() => onOpenCompany(company.id)}
                      >
                        <td>
                          <div className="cell-company">
                            <span className="avatar avatar-doc">
                              <DocumentIcon size={15} />
                            </span>
                            <div>
                              <strong>{company.name}</strong>
                              <span className="cell-sub">
                                <BuildingIcon size={12} /> {company.location}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <strong className="mono">{quote.number}</strong>
                        </td>
                        <td>{formatShortDate(entry.date)}</td>
                        <td>
                          {quote.bast?.customerPic ? (
                            <div className="cell-contact">
                              <strong>{quote.bast.customerPic}</strong>
                              {quote.bast.customerPhone ? (
                                <span className="cell-sub">{quote.bast.customerPhone}</span>
                              ) : null}
                            </div>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td>
                          <StatusBadge status={entry.status} />
                        </td>
                        <td>
                          <div className="cell-docs">
                            {quote.bastFile ? (
                              <a
                                className="file-link"
                                href={pdfUrl(quote.bastFile.id)}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <FileIcon size={14} /> BAST
                              </a>
                            ) : null}
                            {quote.bastSignedFile ? (
                              <a
                                className="file-link"
                                href={pdfUrl(quote.bastSignedFile.id)}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <CheckIcon size={14} /> Tanda tangan
                              </a>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <div className="cell-actions">
                            <button
                              type="button"
                              className="btn btn-mini btn-secondary"
                              onClick={(event) => {
                                event.stopPropagation();
                                onOpenCompany(company.id);
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
              {filtered.length} BAST · {completed} sudah bertanda tangan.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
