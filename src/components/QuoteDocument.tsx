import type { Company, Quote } from "../types";
import { displayQuoteNumber, formatLongDate } from "../lib/data";
import Editable from "./Editable";
import { CloseIcon, PlusIcon } from "./icons";

interface Props {
  quote: Quote;
  company: Company;
  onChange: (quote: Quote) => void;
}

type ListKey = "includes" | "notes" | "keterangan" | "terms";

interface EditableListProps {
  items: string[];
  onChange: (items: string[]) => void;
  ordered?: boolean;
  small?: boolean;
  plain?: boolean;
  addLabel?: string;
  placeholder?: string;
  label: string;
}

function EditableList({
  items,
  onChange,
  ordered = false,
  small = false,
  plain = false,
  addLabel = "Tambah baris",
  placeholder = "Tulis di sini…",
  label,
}: EditableListProps) {
  return (
    <div className={`doc-list${small ? " doc-list-small" : ""}`}>
      {items.map((item, index) => (
        <div className="doc-list-row" key={index}>
          {plain ? null : (
            <span className="doc-list-marker">{ordered ? `${index + 1}.` : "•"}</span>
          )}
          <Editable
            value={item}
            onChange={(value) => onChange(items.map((text, i) => (i === index ? value : text)))}
            className="doc-list-text"
            placeholder={placeholder}
            label={`${label} ${index + 1}`}
          />
          <button
            type="button"
            className="doc-row-action no-print"
            aria-label={`Hapus ${label} ${index + 1}`}
            title="Hapus baris"
            onClick={() => onChange(items.filter((_, i) => i !== index))}
          >
            <CloseIcon size={12} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="doc-add-line no-print"
        onClick={() => onChange([...items, ""])}
      >
        <PlusIcon size={12} /> {addLabel}
      </button>
    </div>
  );
}

export default function QuoteDocument({ quote, company, onChange }: Props) {
  const set = (patch: Partial<Quote>) => onChange({ ...quote, ...patch });

  const replaceList = (key: ListKey, items: string[]) => {
    onChange({ ...quote, [key]: items });
  };

  const updateItem = (id: string, patch: Partial<Quote["items"][number]>) => {
    set({
      items: quote.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    });
  };

  const addItem = () => {
    set({
      items: [
        ...quote.items,
        {
          id: `item_${Math.random().toString(36).slice(2, 9)}`,
          service: "",
          bandwidth: "",
          media: "",
          monthly: "",
          installation: "",
        },
      ],
    });
  };

  const removeItem = (id: string) => {
    set({ items: quote.items.filter((item) => item.id !== id) });
  };

  return (
    <article className="doc-sheet" id="quote-sheet">
      <header className="doc-letterhead">
        <div className="doc-logo" aria-hidden="true">
          UAS
        </div>
        <div className="doc-brand">
          <div className="doc-brand-name">PT. USAHA ADI SANGGORO</div>
          <div className="doc-brand-tagline">Internet Broadband · Data Center · Hosting</div>
          <div className="doc-brand-division">Internet Broadband Division</div>
        </div>
      </header>

      <div className="doc-meta">
        <div className="doc-meta-left">
          <div className="doc-meta-row">
            <span className="doc-meta-label">Nomor</span>
            <span className="doc-meta-colon">:</span>
            <strong className="doc-meta-number">{displayQuoteNumber(quote)}</strong>
          </div>
          <div className="doc-meta-row">
            <span className="doc-meta-label">Lampiran</span>
            <span className="doc-meta-colon">:</span>
            <Editable
              value={quote.lampiran}
              onChange={(value) => set({ lampiran: value })}
              singleLine
              className="doc-meta-value"
              label="Lampiran"
            />
          </div>
          <div className="doc-meta-row">
            <span className="doc-meta-label">Hal</span>
            <span className="doc-meta-colon">:</span>
            <Editable
              value={quote.hal}
              onChange={(value) => set({ hal: value })}
              singleLine
              className="doc-meta-value"
              label="Hal"
            />
          </div>
        </div>
        <div className="doc-date">
          {quote.city}, {formatLongDate(quote.date)}
        </div>
      </div>

      <div className="doc-recipient">
        <div>Kepada Yth.</div>
        <Editable
          value={quote.contactPerson}
          onChange={(value) => set({ contactPerson: value })}
          singleLine
          className="doc-recipient-name"
          placeholder="Nama kontak person"
          label="Nama kontak person"
        />
        <div className="doc-recipient-company">{company.name}</div>
        <div>Di tempat.</div>
      </div>

      <p className="doc-salutation">Dengan Hormat,</p>
      <Editable
        value={quote.intro}
        onChange={(value) => set({ intro: value })}
        className="doc-paragraph"
        label="Paragraf pembuka"
      />
      <p className="doc-paragraph">Berikut penawaran harga layanan dari kami :</p>

      <table className="doc-table">
        <thead>
          <tr>
            <th colSpan={5} className="doc-table-banner">
              <Editable
                value={quote.tableTitle}
                onChange={(value) => set({ tableTitle: value })}
                singleLine
                label="Judul tabel"
                className="doc-table-banner-text"
              />
            </th>
          </tr>
          <tr className="doc-table-head">
            <th>Service</th>
            <th>Bandwidth</th>
            <th>Media</th>
            <th>Monthly</th>
            <th>
              Installation <span className="doc-th-note">(**)</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {quote.items.map((item) => (
            <tr key={item.id}>
              <td>
                <Editable
                  value={item.service}
                  onChange={(value) => updateItem(item.id, { service: value })}
                  singleLine
                  placeholder="Service"
                  label="Service"
                />
              </td>
              <td>
                <Editable
                  value={item.bandwidth}
                  onChange={(value) => updateItem(item.id, { bandwidth: value })}
                  singleLine
                  placeholder="Bandwidth"
                  label="Bandwidth"
                />
              </td>
              <td>
                <Editable
                  value={item.media}
                  onChange={(value) => updateItem(item.id, { media: value })}
                  singleLine
                  placeholder="Media"
                  label="Media"
                />
              </td>
              <td>
                <Editable
                  value={item.monthly}
                  onChange={(value) => updateItem(item.id, { monthly: value })}
                  singleLine
                  placeholder="IDR"
                  label="Harga bulanan"
                />
              </td>
              <td>
                <div className="doc-cell-inline">
                  <Editable
                    value={item.installation}
                    onChange={(value) => updateItem(item.id, { installation: value })}
                    singleLine
                    placeholder="FREE"
                    label="Biaya instalasi"
                  />
                  <button
                    type="button"
                    className="doc-row-action no-print"
                    aria-label="Hapus item"
                    title="Hapus item"
                    onClick={() => removeItem(item.id)}
                  >
                    <CloseIcon size={12} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button type="button" className="doc-add-line doc-add-item no-print" onClick={addItem}>
        <PlusIcon size={12} /> Tambah item harga
      </button>

      <EditableList
        items={quote.notes}
        onChange={(items) => replaceList("notes", items)}
        small
        plain
        addLabel="Tambah catatan"
        placeholder="Catatan di bawah tabel"
        label="Catatan"
      />

      <section className="doc-section">
        <h3 className="doc-section-title">Include :</h3>
        <EditableList
          items={quote.includes}
          onChange={(items) => replaceList("includes", items)}
          ordered
          addLabel="Tambah include"
          placeholder="Item include"
          label="Include"
        />
      </section>

      <section className="doc-section">
        <h3 className="doc-section-title">Keterangan :</h3>
        <EditableList
          items={quote.keterangan}
          onChange={(items) => replaceList("keterangan", items)}
          addLabel="Tambah keterangan"
          placeholder="Poin keterangan"
          label="Keterangan"
        />
      </section>

      <section className="doc-section">
        <h3 className="doc-section-title">Ketentuan Berlangganan :</h3>
        <EditableList
          items={quote.terms}
          onChange={(items) => replaceList("terms", items)}
          addLabel="Tambah ketentuan"
          placeholder="Poin ketentuan"
          label="Ketentuan"
        />
      </section>

      <Editable
        value={quote.closing}
        onChange={(value) => set({ closing: value })}
        className="doc-paragraph"
        label="Paragraf penutup"
      />
      <Editable
        value={quote.thanks}
        onChange={(value) => set({ thanks: value })}
        className="doc-paragraph"
        label="Ucapan terima kasih"
      />

      <div className="doc-signature">
        <div>Hormat Kami,</div>
        <div className="doc-signature-company">PT. Usaha Adi Sanggoro</div>
        <div className="doc-signature-space" aria-hidden="true" />
        <Editable
          value={quote.signerName}
          onChange={(value) => set({ signerName: value })}
          singleLine
          className="doc-signature-name"
          placeholder="Nama penandatangan"
          label="Nama penandatangan"
        />
        <Editable
          value={quote.signerPhone}
          onChange={(value) => set({ signerPhone: value })}
          singleLine
          className="doc-signature-phone"
          placeholder="Nomor telepon"
          label="Nomor telepon penandatangan"
        />
      </div>
    </article>
  );
}
