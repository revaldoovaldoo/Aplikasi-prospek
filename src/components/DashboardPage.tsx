import { useMemo, useState } from "react";
import type { Company, QuoteRecord } from "../types";
import { coordinateReviewStatus } from "../lib/corporate";
import {
  companyStatusOf,
  formatCompactIDR,
  formatShortDate,
  lostEntries,
  MONTHS_ID,
  uploadedQuotes,
  type CompanyStatus,
} from "../lib/data";
import StatusBadge from "./StatusBadge";
import type { DashboardSummaryKind } from "./DashboardSummaryDialog";
import {
  AlertIcon,
  BuildingIcon,
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  FileIcon,
  MailIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  TrendIcon,
  UploadIcon,
} from "./icons";

interface Props {
  companies: Company[];
  quotes: QuoteRecord[];
  locations: string[];
  onAddCompany: () => void;
  onOpenCompany: (id: string) => void;
  onUploadQuote: (companyId: string) => void;
  commissionUnlocked: boolean;
  onToggleCommission: () => void;
  onOpenSummary: (kind: DashboardSummaryKind) => void;
}

type StatusFilter = "all" | CompanyStatus;

export default function DashboardPage({
  companies,
  quotes,
  locations,
  onAddCompany,
  onOpenCompany,
  onUploadQuote,
  commissionUnlocked,
  onToggleCommission,
  onOpenSummary,
}: Props) {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");

  const quoteByCompany = useMemo(() => {
    const map = new Map<string, QuoteRecord>();
    for (const quote of uploadedQuotes(quotes)) {
      const current = map.get(quote.companyId);
      if (!current || current.updatedAt < quote.updatedAt) {
        map.set(quote.companyId, quote);
      }
    }
    return map;
  }, [quotes]);

  const uploaded = uploadedQuotes(quotes);
  const poCount = uploaded.filter((quote) => quote.status === "po").length;
  const totalCommission = uploaded
    .filter((quote) => quote.status === "po")
    .reduce((sum, quote) => sum + (quote.poCommission || 0), 0);

  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const visitsThisMonth = companies.filter((company) => {
    if (!company.visitDate) return false;
    const [year, month] = company.visitDate.split("-").map(Number);
    return year === now.getFullYear() && month === now.getMonth() + 1;
  }).length;

  const activeOffers = companies.filter((company) => {
    const quote = quoteByCompany.get(company.id);
    return Boolean(quote && quote.status !== "tidak-jadi" && !company.lostAt);
  });
  const offersThisMonth = activeOffers.filter((company) =>
    quoteByCompany.get(company.id)?.date.startsWith(monthKey),
  ).length;

  const lost = lostEntries(companies, quotes);
  const lostCount = lost.length;
  const lostThisMonth = lost.filter((entry) => entry.lostAt.startsWith(monthKey)).length;
  const coordinatesToReview = companies.filter((company) => {
    const status = coordinateReviewStatus({ ...company, city: company.location });
    return (
      status === "review" ||
      (status === "missing" &&
        Boolean(Number(company.latitude)) &&
        Boolean(Number(company.longitude)))
    );
  }).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return companies
      .filter((company) => {
        const quote = quoteByCompany.get(company.id) ?? null;
        const matchQuery =
          !q ||
          company.name.toLowerCase().includes(q) ||
          company.email.toLowerCase().includes(q) ||
          company.picPhone.toLowerCase().includes(q) ||
          company.location.toLowerCase().includes(q) ||
          (company.lostReason?.toLowerCase().includes(q) ?? false) ||
          (quote?.number.toLowerCase().includes(q) ?? false);
        const matchLocation = location === "all" || company.location === location;
        const matchStatus = status === "all" || companyStatusOf(company, quote) === status;
        return matchQuery && matchLocation && matchStatus;
      })
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [companies, query, location, status, quoteByCompany]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Prospek</h1>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-primary" onClick={onAddCompany}>
            <PlusIcon size={16} /> Tambah perusahaan
          </button>
        </div>
      </header>

      {coordinatesToReview > 0 ? (
        <div className="corporate-banner corporate-banner-warn" role="status">
          <AlertIcon size={15} />
          <span>
            {coordinatesToReview} prospek punya titik koordinat yang perlu dicek.
            Buka kartu prospek, lihat peta, lalu pilih <strong>Edit data perusahaan</strong>
            untuk mengonfirmasi titik yang benar.
          </span>
        </div>
      ) : null}

      <div className="stats stats-4">
        <div className="stat stat-clickable">
          <button
            type="button"
            className="stat-hit"
            onClick={() => onOpenSummary("visit")}
            aria-label="Lihat ringkasan kunjungan perusahaan per bulan"
            title="Lihat ringkasan kunjungan per bulan"
          />
          <span className="stat-open" aria-hidden="true">
            <ChevronRightIcon size={14} />
          </span>
          <span className="stat-icon tone-blue">
            <BuildingIcon size={18} />
          </span>
          <div>
            <span className="stat-label">Total perusahaan</span>
            <strong className="stat-value">{companies.length}</strong>
            <span className="stat-note">
              {visitsThisMonth} visit di {MONTHS_ID[now.getMonth()]}
            </span>
          </div>
        </div>
        <div className="stat stat-clickable">
          <button
            type="button"
            className="stat-hit"
            onClick={() => onOpenSummary("offers")}
            aria-label="Lihat ringkasan penawaran per bulan"
            title="Lihat ringkasan penawaran per bulan"
          />
          <span className="stat-open" aria-hidden="true">
            <ChevronRightIcon size={14} />
          </span>
          <span className="stat-icon tone-violet">
            <FileIcon size={18} />
          </span>
          <div>
            <span className="stat-label">Penawaran</span>
            <strong className="stat-value">{activeOffers.length}</strong>
            <span className="stat-note">
              {offersThisMonth} Penawaran di {MONTHS_ID[now.getMonth()]}
            </span>
          </div>
        </div>
        <div className="stat stat-clickable">
          <button
            type="button"
            className="stat-hit"
            onClick={() => onOpenSummary("po")}
            aria-label="Lihat ringkasan PO per bulan"
            title="Lihat ringkasan PO per bulan"
          />
          <span className="stat-open" aria-hidden="true">
            <ChevronRightIcon size={14} />
          </span>
          <span className="stat-icon tone-green">
            <TrendIcon size={18} />
          </span>
          <div>
            <span className="stat-label">PO</span>
            <strong className="stat-value">{poCount}</strong>
            {totalCommission > 0 ? (
              <span className="stat-note stat-note-row">
                <span className={commissionUnlocked ? undefined : "amount-masked"}>
                  {commissionUnlocked
                    ? `Komisi ${formatCompactIDR(totalCommission)}`
                    : "Komisi ••••••"}
                </span>
                <button
                  type="button"
                  className="pin-eye"
                  onClick={onToggleCommission}
                  aria-label={
                    commissionUnlocked
                      ? "Sembunyikan jumlah komisi"
                      : "Tampilkan jumlah komisi dengan PIN"
                  }
                  title={
                    commissionUnlocked
                      ? "Sembunyikan jumlah komisi"
                      : "Tampilkan jumlah komisi"
                  }
                >
                  {commissionUnlocked ? <EyeOffIcon size={13} /> : <EyeIcon size={13} />}
                </button>
              </span>
            ) : (
              <span className="stat-note">Perusahaan yang jadi</span>
            )}
          </div>
        </div>
        <div className="stat stat-clickable">
          <button
            type="button"
            className="stat-hit"
            onClick={() => onOpenSummary("cancel")}
            aria-label="Lihat ringkasan perusahaan cancel per bulan"
            title="Lihat ringkasan cancel per bulan"
          />
          <span className="stat-open" aria-hidden="true">
            <ChevronRightIcon size={14} />
          </span>
          <span className="stat-icon tone-red">
            <AlertIcon size={18} />
          </span>
          <div>
            <span className="stat-label">Cancel</span>
            <strong className="stat-value">{lostCount}</strong>
            <span className="stat-note">
              {lostThisMonth} Cancel di {MONTHS_ID[now.getMonth()]}
            </span>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="filter-bar">
          <div className="search-box">
            <SearchIcon size={16} />
            <input
              value={query}
              placeholder="Cari perusahaan, email, nomor PIC, atau nomor penawaran"
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Cari perusahaan"
            />
          </div>
          <select
            className="select"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            aria-label="Filter lokasi"
          >
            <option value="all">Semua lokasi</option>
            {locations.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>
          <select
            className="select"
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
            aria-label="Filter status"
          >
            <option value="all">Semua status</option>
            <option value="prospek">Prospek</option>
            <option value="penawaran">Penawaran</option>
            <option value="po">PO</option>
            <option value="bast-terkirim">BAST sudah terkirim</option>
            <option value="bast-selesai">BAST Selesai</option>
            <option value="tidak-jadi">Cancel</option>
          </select>
        </div>

        {companies.length === 0 ? (
          <div className="empty">
            <span className="empty-icon">
              <BuildingIcon size={26} />
            </span>
            <h2>Belum ada perusahaan</h2>
            <p>Mulai dengan mencatat perusahaan yang baru Anda kunjungi.</p>
            <button type="button" className="btn btn-primary" onClick={onAddCompany}>
              <PlusIcon size={16} /> Tambah perusahaan pertama
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty empty-sm">
            <h2>Tidak ada hasil</h2>
            <p>Coba ubah kata kunci atau filter lokasi dan status.</p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setQuery("");
                setLocation("all");
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
                    <th>Lokasi</th>
                    <th>Kontak PIC</th>
                    <th>Tanggal visit</th>
                    <th>Status</th>
                    <th aria-label="Aksi" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((company) => {
                    const quote = quoteByCompany.get(company.id) ?? null;
                    const currentStatus = companyStatusOf(company, quote);
                    return (
                      <tr
                        key={company.id}
                        className="row-click"
                        onClick={() => onOpenCompany(company.id)}
                      >
                        <td>
                          <div className="cell-company">
                            <span className="avatar">{company.name.slice(0, 1).toUpperCase()}</span>
                            <div>
                              <strong>{company.name}</strong>
                              <span className="cell-sub">
                                {company.email ? (
                                  <>
                                    <MailIcon size={12} /> {company.email}
                                  </>
                                ) : (
                                  "Email belum diisi"
                                )}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="chip">
                            <PinIcon size={12} /> {company.location}
                          </span>
                        </td>
                        <td>
                          <span className={company.picPhone ? "" : "muted"}>
                            {company.picPhone || "—"}
                          </span>
                        </td>
                        <td>
                          <span className={company.visitDate ? "" : "muted"}>
                            {company.visitDate ? formatShortDate(company.visitDate) : "Belum visit"}
                          </span>
                        </td>
                        <td>
                          <div className="cell-quote">
                            <StatusBadge status={currentStatus} />
                            {quote ? (
                              <span className="cell-sub mono">{quote.number}</span>
                            ) : company.lostAt ? (
                              <span className="cell-sub">Tanpa penawaran</span>
                            ) : (
                              <span className="cell-sub">PDF belum diunggah</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <div className="cell-actions">
                            {quote || company.lostAt ? (
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
                            ) : (
                              <button
                                type="button"
                                className="btn btn-mini btn-secondary"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onUploadQuote(company.id);
                                }}
                              >
                                <UploadIcon size={13} /> Upload PDF
                              </button>
                            )}
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
              Menampilkan {filtered.length} dari {companies.length} perusahaan · Nomor penawaran
              diambil dari PDF yang Anda unggah.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
