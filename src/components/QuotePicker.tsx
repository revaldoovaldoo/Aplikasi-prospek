import { useMemo, useState } from "react";
import type { Company, QuoteRecord } from "../types";
import { uploadedQuotes } from "../lib/data";
import { Modal } from "./Dialogs";
import { PinIcon, SearchIcon } from "./icons";

interface Props {
  open: boolean;
  companies: Company[];
  quotes: QuoteRecord[];
  onClose: () => void;
  onPick: (companyId: string) => void;
  onCreateCompany: () => void;
}

export default function QuotePicker({ open, companies, quotes, onClose, onPick, onCreateCompany }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter(
      (company) =>
        company.name.toLowerCase().includes(q) || company.location.toLowerCase().includes(q),
    );
  }, [companies, query]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Upload penawaran"
      subtitle="Pilih perusahaan yang PDF penawarannya ingin diunggah."
      width={540}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Batal
          </button>
          <button type="button" className="btn btn-secondary" onClick={onCreateCompany}>
            + Perusahaan baru
          </button>
        </>
      }
    >
      <div className="picker-search">
        <SearchIcon size={16} />
        <input
          autoFocus
          value={query}
          placeholder="Cari nama perusahaan atau lokasi"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="mini-empty">
          <p>Tidak ada perusahaan yang cocok.</p>
        </div>
      ) : (
        <ul className="picker-list">
          {filtered.map((company) => {
            const quote = uploadedQuotes(quotes).find((item) => item.companyId === company.id);
            return (
              <li key={company.id}>
                <button type="button" onClick={() => onPick(company.id)}>
                  <span className="avatar">{company.name.slice(0, 1).toUpperCase()}</span>
                  <span className="picker-main">
                    <strong>{company.name}</strong>
                    <span>
                      <PinIcon size={12} /> {company.location}
                    </span>
                  </span>
                  <span className="picker-count">
                    {quote
                      ? quote.number
                      : company.lostAt
                        ? "Cancel"
                        : "Belum ada PDF"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}
