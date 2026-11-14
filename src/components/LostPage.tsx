import { useMemo, useState } from "react";
import type { Company, QuoteRecord } from "../types";
import { formatShortDate, lostEntries } from "../lib/data";
import { pdfUrl } from "../lib/api";
import StatusBadge from "./StatusBadge";
import {
  AlertIcon,
  ChevronRightIcon,
  FileIcon,
  MailIcon,
  PhoneIcon,
  SearchIcon,
} from "./icons";

interface Props {
  quotes: QuoteRecord[];
  companies: Company[];
  onOpenCompany: (id: string) => void;
}

export default function LostPage({ quotes, companies, onOpenCompany }: Props) {
  const [query, setQuery] = useState("");

  const lost = useMemo(() => lostEntries(companies, quotes), [companies, quotes]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return lost;
    return lost.filter((entry) => {
      const { company, quote } = entry;
      return (
        company.name.toLowerCase().includes(q) ||
        company.email.toLowerCase().includes(q) ||
        entry.reason.toLowerCase().includes(q) ||
        (quote?.number.toLowerCase().includes(q) ?? false)
      );
    });
  }, [lost, query]);

  const thisMonth = lost.filter((entry) => {
    if (!entry.lostAt) return false;
    const date = new Date(`${entry.lostAt}T00:00:00`);
    const now = new Date();
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  }).length;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Laporan</p>
          <h1>Cancel</h1>
          <p className="page-sub">
            Perusahaan yang membatalkan kerja sama, lengkap dengan alasannya.
          </p>
        </div>
      </header>

      <div className="stats stats-2">
        <div className="stat">
          <span className="stat-icon tone-red">
            <AlertIcon size={18} />
          </span>
          <div>
            <span className="stat-label">Total cancel</span>
            <strong className="stat-value">{lost.length}</strong>
            <span className="stat-note">Perusahaan yang dibatalkan</span>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon tone-amber">
            <FileIcon size={18} />
          </span>
          <div>
            <span className="stat-label">Bulan ini</span>
            <strong className="stat-value">{thisMonth}</strong>
            <span className="stat-note">Keputusan cancel</span>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="filter-bar">
          <div className="search-box">
            <SearchIcon size={16} />
            <input
              value={query}
              placeholder="Cari perusahaan, nomor penawaran, atau alasan"
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Cari perusahaan cancel"
            />
          </div>
          <span className="filter-count">{filtered.length} perusahaan</span>
        </div>

        {lost.length === 0 ? (
          <div className="empty">
            <span className="empty-icon">
              <AlertIcon size={26} />
            </span>
            <h2>Belum ada yang cancel</h2>
            <p>
              Saat perusahaan menolak penawaran atau membatalkan kerja sama, tandai dari
              detail perusahaan beserta alasannya.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty empty-sm">
            <h2>Tidak ada hasil</h2>
            <p>Coba kata kunci lain.</p>
            <button type="button" className="btn btn-secondary" onClick={() => setQuery("")}>
              Reset pencarian
            </button>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data-table lost-table">
                <thead>
                  <tr>
                    <th>Perusahaan</th>
                    <th>Nomor penawaran</th>
                    <th>Alasan cancel</th>
                    <th>Tanggal</th>
                    <th>PDF</th>
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
                            <span className="avatar">
                              {company.name.slice(0, 1).toUpperCase()}
                            </span>
                            <div>
                              <strong>{company.name}</strong>
                              <span className="cell-sub">
                                {company.picPhone ? (
                                  <>
                                    <PhoneIcon size={12} /> {company.picPhone}
                                  </>
                                ) : company.email ? (
                                  <>
                                    <MailIcon size={12} /> {company.email}
                                  </>
                                ) : (
                                  "Kontak belum diisi"
                                )}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>
                          {quote ? (
                            <>
                              <strong className="mono">{quote.number}</strong>
                              <div className="cell-sub">
                                <StatusBadge status="tidak-jadi" />
                              </div>
                            </>
                          ) : (
                            <span className="muted">Belum ada penawaran</span>
                          )}
                        </td>
                        <td className="reason-cell">{entry.reason || "Tanpa alasan"}</td>
                        <td>
                          {entry.lostAt ? formatShortDate(entry.lostAt) : "—"}
                        </td>
                        <td>
                          {quote ? (
                            <a
                              className="file-link"
                              href={pdfUrl(quote.quoteFile.id)}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <FileIcon size={14} /> Lihat
                            </a>
                          ) : (
                            <span className="muted">—</span>
                          )}
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
              Alasan dicatat agar bisa dievaluasi. Klik baris untuk membuka detail perusahaan.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
