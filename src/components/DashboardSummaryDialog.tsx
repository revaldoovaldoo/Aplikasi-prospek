import { useEffect, useMemo, useState } from "react";
import type { Company, QuoteRecord } from "../types";
import {
  MONTHS_ID,
  companyStatus,
  companyStatusOf,
  formatCompactIDR,
  formatShortDate,
  lostEntries,
  uploadedQuotes,
  type CompanyStatus,
} from "../lib/data";
import { Modal } from "./Dialogs";
import StatusBadge from "./StatusBadge";
import { ChevronRightIcon } from "./icons";

export type DashboardSummaryKind = "visit" | "offers" | "po" | "cancel";

interface Props {
  open: boolean;
  initialKind: DashboardSummaryKind;
  companies: Company[];
  quotes: QuoteRecord[];
  onClose: () => void;
  onOpenCompany: (id: string) => void;
}

interface SummaryRow {
  key: string;
  company: Company;
  date: string;
  meta: string;
  status: CompanyStatus;
  reason?: string;
}

interface SummaryGroup {
  key: string;
  label: string;
  rows: SummaryRow[];
}

const TABS: { kind: DashboardSummaryKind; label: string }[] = [
  { kind: "visit", label: "Kunjungan" },
  { kind: "offers", label: "Penawaran" },
  { kind: "po", label: "PO" },
  { kind: "cancel", label: "Cancel" },
];

const EMPTY_TEXT: Record<DashboardSummaryKind, string> = {
  visit: "Belum ada perusahaan yang tercatat dikunjungi.",
  offers: "Belum ada penawaran aktif.",
  po: "Belum ada PO yang diunggah.",
  cancel: "Belum ada perusahaan yang cancel.",
};

function monthLabel(key: string): string {
  if (key === "unknown") return "Tanpa tanggal";
  const [year, month] = key.split("-").map(Number);
  return `${MONTHS_ID[month - 1] ?? "Bulan"} ${year}`;
}

function groupByMonth(rows: SummaryRow[]): SummaryGroup[] {
  const map = new Map<string, SummaryRow[]>();
  for (const row of rows) {
    const key = /^\d{4}-\d{2}/.test(row.date) ? row.date.slice(0, 7) : "unknown";
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }

  return [...map.entries()]
    .sort(([a], [b]) => {
      if (a === "unknown") return 1;
      if (b === "unknown") return -1;
      return b.localeCompare(a);
    })
    .map(([key, list]) => ({ key, label: monthLabel(key), rows: list }));
}

function displayDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return "—";
  return formatShortDate(iso);
}

export default function DashboardSummaryDialog({
  open,
  initialKind,
  companies,
  quotes,
  onClose,
  onOpenCompany,
}: Props) {
  const [kind, setKind] = useState<DashboardSummaryKind>(initialKind);

  useEffect(() => {
    if (open) setKind(initialKind);
  }, [open, initialKind]);

  const latestByCompany = useMemo(() => {
    const map = new Map<string, QuoteRecord>();
    for (const quote of uploadedQuotes(quotes)) {
      const current = map.get(quote.companyId);
      if (!current || current.updatedAt < quote.updatedAt) {
        map.set(quote.companyId, quote);
      }
    }
    return map;
  }, [quotes]);

  const activeOffers = useMemo(
    () =>
      companies.flatMap((company) => {
        const quote = latestByCompany.get(company.id);
        if (!quote || quote.status === "tidak-jadi" || company.lostAt) return [];
        return [{ company, quote }];
      }),
    [companies, latestByCompany],
  );

  const pos = useMemo(
    () =>
      companies.flatMap((company) => {
        const quote = latestByCompany.get(company.id);
        if (!quote || quote.status !== "po") return [];
        return [{ company, quote }];
      }),
    [companies, latestByCompany],
  );

  const lost = useMemo(() => lostEntries(companies, quotes), [companies, quotes]);

  const counts: Record<DashboardSummaryKind, number> = {
    visit: companies.filter((company) => company.visitDate).length,
    offers: activeOffers.length,
    po: pos.length,
    cancel: lost.length,
  };

  const groups = useMemo<Record<DashboardSummaryKind, SummaryGroup[]>>(() => {
    const visitRows: SummaryRow[] = companies
      .filter((company) => company.visitDate)
      .map((company) => ({
        key: company.id,
        company,
        date: company.visitDate,
        meta: company.location || "Tanpa lokasi",
        status: companyStatusOf(company, latestByCompany.get(company.id) ?? null),
      }));

    const unvisitedRows: SummaryRow[] = companies
      .filter((company) => !company.visitDate)
      .map((company) => ({
        key: company.id,
        company,
        date: "",
        meta: company.location || "Tanpa lokasi",
        status: companyStatusOf(company, latestByCompany.get(company.id) ?? null),
      }));

    const visitGroups = groupByMonth(visitRows);
    if (unvisitedRows.length > 0) {
      visitGroups.push({ key: "unvisited", label: "Belum visit", rows: unvisitedRows });
    }

    return {
      visit: visitGroups,
      offers: groupByMonth(
        activeOffers.map(({ company, quote }) => ({
          key: company.id,
          company,
          date: quote.date,
          meta: quote.number,
          status: companyStatus(quote),
        })),
      ),
      po: groupByMonth(
        pos.map(({ company, quote }) => ({
          key: company.id,
          company,
          date: quote.poAt || quote.date,
          meta: `${quote.number} · ${formatCompactIDR(quote.poAmount)}`,
          status: companyStatus(quote),
        })),
      ),
      cancel: groupByMonth(
        lost.map((entry) => ({
          key: entry.key,
          company: entry.company,
          date: entry.lostAt,
          meta: entry.quote?.number || entry.company.location || "Tanpa lokasi",
          status: "tidak-jadi" as const,
          reason: entry.reason,
        })),
      ),
    };
  }, [companies, activeOffers, pos, lost, latestByCompany]);

  const currentGroups = groups[kind];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ringkasan bulanan"
      subtitle="Kunjungan, penawaran, PO, dan cancel dikelompokkan per bulan."
      width={760}
      footer={
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Tutup
        </button>
      }
    >
      <div className="summary-tabs" role="tablist" aria-label="Jenis ringkasan">
        {TABS.map((tab) => (
          <button
            key={tab.kind}
            type="button"
            role="tab"
            aria-selected={kind === tab.kind}
            className={`summary-tab${kind === tab.kind ? " is-active" : ""}`}
            onClick={() => setKind(tab.kind)}
          >
            {tab.label}
            <span>{counts[tab.kind]}</span>
          </button>
        ))}
      </div>

      {currentGroups.length === 0 ? (
        <div className="summary-empty">
          <p>{EMPTY_TEXT[kind]}</p>
        </div>
      ) : (
        <div className="summary-groups">
          {currentGroups.map((group) => (
            <section className="summary-group" key={group.key}>
              <div className="summary-group-head">
                <h3>{group.label}</h3>
                <span>{group.rows.length} perusahaan</span>
              </div>
              <div className="summary-list">
                {group.rows.map((row) => (
                  <button
                    type="button"
                    className="summary-row"
                    key={row.key}
                    onClick={() => onOpenCompany(row.company.id)}
                  >
                    <span className="summary-row-main">
                      <strong>{row.company.name}</strong>
                      <span>{row.meta}</span>
                      {row.reason ? (
                        <span className="summary-reason">Alasan: {row.reason}</span>
                      ) : null}
                    </span>
                    <span className="summary-row-side">
                      <StatusBadge status={row.status} />
                      <span className="summary-date">{displayDate(row.date)}</span>
                      <ChevronRightIcon size={15} />
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Modal>
  );
}
