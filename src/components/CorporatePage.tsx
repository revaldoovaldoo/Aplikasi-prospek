import { useEffect, useMemo, useRef, useState } from "react";
import type { Company } from "../types";
import {
  CORPORATE_CITIES,
  CORPORATE_CITY_LABELS,
  CORPORATE_FOCUS_AREAS,
  CORPORATE_MAX_AGE_MS,
  categoryLabel,
  findCompanyForLead,
  oldestCity,
  screeningHoldMessage,
  screeningReviewRequired,
  websiteHost,
  type CorporateData,
  type CorporateLead,
} from "../lib/corporate";
import {
  enrichCorporateEmails,
  fetchCorporateData,
  refreshCorporateCity,
  searchCorporateLead,
} from "../lib/api";
import { formatLongDate } from "../lib/data";
import StatusBadge from "./StatusBadge";
import CorporateLeadDialog from "./CorporateLeadDialog";
import {
  BuildingIcon,
  GlobeIcon,
  PinIcon,
  RefreshIcon,
  SearchIcon,
  SparkIcon,
  UsersIcon,
} from "./icons";

const PAGE_SIZE = 40;

interface Props {
  companies: Company[];
  onVisitLead: (lead: CorporateLead, manual?: boolean) => string | null;
  onOpenCompany: (id: string) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Terjadi kesalahan.";
}

export default function CorporatePage({ companies, onVisitLead, onOpenCompany }: Props) {
  const [data, setData] = useState<CorporateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [city, setCity] = useState("all");
  const [category, setCategory] = useState("all");
  const [hideProspek, setHideProspek] = useState(true);
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [selected, setSelected] = useState<CorporateLead | null>(null);
  const [leadSearching, setLeadSearching] = useState(false);
  const [leadError, setLeadError] = useState("");
  const autoRefreshRef = useRef(false);

  const load = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const next = await fetchCorporateData();
      setData(next);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runRefresh(targetCity: string, silent = false) {
    if (!targetCity) return;
    setRefreshing(targetCity);
    setRefreshError("");
    if (!silent) setNotice("");
    try {
      const result = await refreshCorporateCity(targetCity);
      setData((previous) =>
        previous
          ? {
              ...previous,
              leads: [
                ...previous.leads.filter((lead) => lead.city !== targetCity),
                ...result.leads,
              ],
              cities: previous.cities.map((item) =>
                item.name === targetCity
                  ? { ...item, updatedAt: result.updatedAt }
                  : item,
              ),
            }
          : previous,
      );
      setNotice(
        result.throttled
          ? `Data ${targetCity} baru saja diperbarui.`
          : `Data ${targetCity} diperbarui: ${result.leads.length} lead.`,
      );
      if (result.failedCategories?.length) {
        setRefreshError("Sebagian kategori gagal diperbarui; data sebelumnya tetap dipakai.");
      }
    } catch (error) {
      setRefreshError(errorMessage(error));
    } finally {
      setRefreshing(null);
    }
  }

  useEffect(() => {
    if (!data || autoRefreshRef.current) return;
    autoRefreshRef.current = true;

    const stale = [...data.cities]
      .filter((item) => Date.now() - Date.parse(item.updatedAt) >= CORPORATE_MAX_AGE_MS)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .slice(0, 2);

    void (async () => {
      for (const item of stale) {
        await runRefresh(item.name, true);
      }
      try {
        const result = await enrichCorporateEmails();
        if (result.updated.length > 0) {
          setData((previous) =>
            previous
              ? {
                  ...previous,
                  leads: previous.leads.map((lead) => {
                    const hit = result.updated.find((item) => item.id === lead.id);
                    return hit
                      ? {
                          ...lead,
                          email: hit.email || lead.email,
                          phone: hit.phone || lead.phone,
                          contactName: hit.contactName || lead.contactName,
                          contactRole: hit.contactRole || lead.contactRole,
                          contactUrl: hit.contactUrl || lead.contactUrl,
                          contactSource: hit.contactSource || lead.contactSource,
                        }
                      : lead;
                  }),
                }
              : previous,
          );
        }
        if (result.found > 0) {
          setNotice(
            `Robot menemukan ${result.found} kontak baru (e-mail/nomor/kontak IT) dari situs perusahaan` +
              (result.remaining > 0 ? `, ${result.remaining} lagi menyusul.` : "."),
          );
        }
      } catch {
        /* pencarian email berjalan diam-diam; dicoba lagi pada kunjungan berikutnya */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    setPage(1);
  }, [query, city, category]);

  const counts = useMemo(() => {
    const result = { hotel: 0, school: 0, company: 0 };
    for (const lead of data?.leads ?? []) {
      if (lead.category in result) result[lead.category] += 1;
    }
    return result;
  }, [data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.leads ?? []).filter((lead) => {
      if (city !== "all" && lead.city !== city) return false;
      if (category !== "all" && lead.category !== category) return false;
      if (hideProspek && findCompanyForLead(lead, companies)) return false;
      if (!q) return true;
      return [
        lead.name,
        lead.city,
        lead.area,
        lead.email,
        lead.phone,
        lead.website,
        lead.contactName,
        lead.contactRole,
      ].some((value) => (value ?? "").toLowerCase().includes(q));
    });
  }, [data, query, city, category, hideProspek, companies]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const rows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const rangeStart = filtered.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(filtered.length, currentPage * PAGE_SIZE);

  const refreshTarget =
    city === "all" ? oldestCity(data?.cities ?? [])?.name ?? "" : city;

  async function runLeadSearch(lead: CorporateLead) {
    setLeadSearching(true);
    setLeadError("");
    try {
      const result = await searchCorporateLead(lead.id);
      const next = result.lead;
      const merge = (item: CorporateLead): CorporateLead => ({
        ...item,
        website: next.website || item.website,
        email: next.email || item.email,
        phone: next.phone || item.phone,
        contactName: next.contactName || item.contactName,
        contactRole: next.contactRole || item.contactRole,
        contactUrl: next.contactUrl || item.contactUrl,
        contactSource: next.contactSource || item.contactSource,
        latitude: next.latitude ?? item.latitude,
        longitude: next.longitude ?? item.longitude,
        coordinateAddress: next.coordinateAddress || item.coordinateAddress,
        coordinateSource: next.coordinateSource || item.coordinateSource,
        validationStatus: next.validationStatus || item.validationStatus,
        validationEvidence: next.validationEvidence || item.validationEvidence,
        validatedAt: next.validatedAt || item.validatedAt,
        aiConfidence: next.aiConfidence ?? item.aiConfidence,
      });
      setData((previous) =>
        previous
          ? {
              ...previous,
              leads: previous.leads.map((item) => (item.id === next.id ? merge(item) : item)),
            }
          : previous,
      );
      setSelected((previous) =>
        previous && previous.id === next.id ? merge(previous) : previous,
      );
      if (!result.found) {
        if (result.webSearch && !result.webSearch.enabled) {
          setLeadError(
            "Kontak IT belum ditemukan di website. Pencarian LinkedIn dan sumber publik belum aktif; tambahkan EXA_API_KEY pada secret Worker agar robot bisa mencarinya.",
          );
        } else if (result.webSearch?.error) {
          setLeadError(`Kontak IT belum ditemukan. ${result.webSearch.error}`);
        } else {
          setLeadError(
            "Robot belum menemukan nama atau jabatan kontak IT dari website maupun sumber publik.",
          );
        }
      }
    } catch (error) {
      setLeadError(errorMessage(error));
    } finally {
      setLeadSearching(false);
    }
  }

  const openLead = (lead: CorporateLead) => {
    setSelected(lead);
    setLeadError("");
    if (!lead.email || !lead.phone || !lead.contactName) void runLeadSearch(lead);
  };

  const visitSelected = () => {
    if (!selected) return;
    const existing = findCompanyForLead(selected, companies);
    const id = onVisitLead(selected, true);
    setNotice(
      id
        ? existing
          ? `${selected.name} diperbarui di Prospek.`
          : `${selected.name} masuk ke daftar Prospek.`
        : screeningReviewRequired(selected)
          ? `${selected.name}: ${screeningHoldMessage(selected)} Konfirmasi tersedia di Robot AI; Prospek tidak diubah.`
          : `${selected.name} belum lengkap; Prospek tidak diubah.`,
    );
    setSelected(null);
    if (id) onOpenCompany(id);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Data perusahaan publik</p>
          <h1>Corporate Engine</h1>
          <p className="page-sub">
            Perusahaan, hotel, dan sekolah di seluruh DKI Jakarta, Kota Bogor, Kab. Bogor,
            Kota Sukabumi, Kab. Sukabumi, Kota Depok, seluruh area Tangerang, Bekasi,
            Serang, dan Subang.
            Seluruh area di dalam wilayah tersebut ikut dicari. Klik nama perusahaan untuk
            melihat website, e-mail, nomor PIC, dan kontak IT. Tekan Prospek untuk
            memasukkannya secara manual ke Prospek.
          </p>
        </div>
        <div className="page-head-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void runRefresh(refreshTarget)}
            disabled={Boolean(refreshing) || !data}
            title={
              refreshTarget
                ? `Tarik data terbaru untuk ${refreshTarget}`
                : "Tarik data terbaru"
            }
          >
            <RefreshIcon size={16} /> {refreshing ? "Memperbarui…" : "Perbarui data"}
          </button>
        </div>
      </header>

      <div className="corporate-focus" aria-label="Fokus wilayah pencarian">
        <span className="corporate-focus-label">Fokus area</span>
        <button
          type="button"
          className={`corporate-focus-chip ${city === "all" && !query ? "active" : ""}`}
          onClick={() => {
            setCity("all");
            setQuery("");
            setPage(1);
          }}
        >
          Semua area
        </button>
        <button
          type="button"
          className={`corporate-focus-chip ${hideProspek ? "active" : ""}`}
          onClick={() => {
            setHideProspek((value) => !value);
            setPage(1);
          }}
          title="Lead yang sudah masuk Prospek tidak perlu tampil lagi"
        >
          {hideProspek ? "Belum prospek" : "Semua lead"}
        </button>
        {CORPORATE_FOCUS_AREAS.map((area) => {
          const active = city === area.city && !query;
          return (
            <button
              key={area.label}
              type="button"
              className={`corporate-focus-chip ${active ? "active" : ""}`}
              onClick={() => {
                setCity(area.city);
                setQuery("");
                setPage(1);
                const hasArea = (data?.leads ?? []).some(
                  (lead) => lead.city === area.city && Boolean(lead.area),
                );
                if (!hasArea) void runRefresh(area.city);
              }}
            >
              {area.label}
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="panel">
          <div className="corporate-loading">
            <span className="spinner" />
            <div>
              <strong>Menarik data Corporate Engine…</strong>
              <p>Menyiapkan daftar perusahaan, hotel, dan sekolah.</p>
            </div>
          </div>
        </div>
      ) : loadError ? (
        <div className="panel">
          <div className="empty">
            <span className="empty-icon">
              <GlobeIcon size={26} />
            </span>
            <h2>Data belum bisa dimuat</h2>
            <p>{loadError}</p>
            <button type="button" className="btn btn-primary" onClick={() => void load()}>
              Coba lagi
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="stats">
            <div className="stat">
              <span className="stat-icon tone-blue">
                <SparkIcon size={18} />
              </span>
              <div>
                <span className="stat-label">Total lead</span>
                <strong className="stat-value">{data?.leads.length ?? 0}</strong>
                <span className="stat-note">{data?.cities.length ?? CORPORATE_CITIES.length} wilayah awal</span>
              </div>
            </div>
            <div className="stat">
              <span className="stat-icon tone-violet">
                <BuildingIcon size={18} />
              </span>
              <div>
                <span className="stat-label">Hotel</span>
                <strong className="stat-value">{counts.hotel}</strong>
                <span className="stat-note">Hotel &amp; penginapan</span>
              </div>
            </div>
            <div className="stat">
              <span className="stat-icon tone-green">
                <UsersIcon size={18} />
              </span>
              <div>
                <span className="stat-label">Sekolah</span>
                <strong className="stat-value">{counts.school}</strong>
                <span className="stat-note">Sekolah &amp; kampus</span>
              </div>
            </div>
            <div className="stat">
              <span className="stat-icon tone-amber">
                <PinIcon size={18} />
              </span>
              <div>
                <span className="stat-label">Perusahaan</span>
                <strong className="stat-value">{counts.company}</strong>
                <span className="stat-note">Kantor &amp; usaha</span>
              </div>
            </div>
          </div>

          {notice ? (
            <div className="corporate-banner" role="status">
              <SparkIcon size={15} />
              <span>{notice}</span>
              <button
                type="button"
                className="link-btn corporate-banner-close"
                onClick={() => setNotice("")}
              >
                Tutup
              </button>
            </div>
          ) : null}
          {refreshError ? (
            <div className="corporate-banner corporate-banner-warn" role="alert">
              <RefreshIcon size={15} />
              <span>{refreshError}</span>
              <button
                type="button"
                className="link-btn corporate-banner-close"
                onClick={() => setRefreshError("")}
              >
                Tutup
              </button>
            </div>
          ) : null}

          <div className="panel">
            <div className="filter-bar">
              <div className="search-box">
                <SearchIcon size={16} />
                <input
                  value={query}
                  placeholder="Cari nama, email, telepon, kontak IT, atau website"
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="Cari lead Corporate Engine"
                />
              </div>
              <select
                className="select"
                value={city}
                onChange={(event) => setCity(event.target.value)}
                aria-label="Filter wilayah"
              >
                <option value="all">Semua wilayah</option>
                {CORPORATE_CITIES.map((name) => (
                  <option key={name} value={name}>
                    {CORPORATE_CITY_LABELS[name] ?? name}
                  </option>
                ))}
              </select>
              <select
                className="select"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                aria-label="Filter kategori"
              >
                <option value="all">Semua kategori</option>
                <option value="company">Perusahaan</option>
                <option value="hotel">Hotel</option>
                <option value="school">Sekolah</option>
              </select>
              <span className="filter-count">{filtered.length} lead</span>
            </div>

            {filtered.length === 0 ? (
              <div className="empty empty-sm">
                <h2>Tidak ada lead yang cocok</h2>
                <p>Coba kata kunci atau filter wilayah lain.</p>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setQuery("");
                    setCity("all");
                    setCategory("all");
                  }}
                >
                  Reset filter
                </button>
              </div>
            ) : (
              <>
                <div className="table-wrap">
                  <table className="data-table corporate-table">
                    <thead>
                      <tr>
                        <th>Perusahaan</th>
                        <th>Lokasi</th>
                        <th>Email</th>
                        <th>No. PIC</th>
                        <th>Kontak IT</th>
                        <th>Website</th>
                        <th>Status</th>
                        <th aria-label="Aksi" />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((lead) => {
                        const existing = findCompanyForLead(lead, companies);
                        return (
                          <tr
                            key={lead.id}
                            className="row-click"
                            onClick={() => openLead(lead)}
                            title="Lihat kontak perusahaan"
                          >
                            <td>
                              <div className="cell-company">
                                <span className="avatar">
                                  {lead.name.slice(0, 1).toUpperCase()}
                                </span>
                                <div>
                                  <strong>{lead.name}</strong>
                                  <span className="cell-sub">{categoryLabel(lead.category)}</span>
                                </div>
                              </div>
                            </td>
                            <td>
                              <span className="chip">
                                <PinIcon size={12} /> {lead.area ? `${lead.area}, ` : ""}
                                {CORPORATE_CITY_LABELS[lead.city] ?? lead.city}
                              </span>
                            </td>
                            <td className={lead.email ? undefined : "cell-empty"}>
                              {lead.email ? (
                                <a
                                  className="file-link"
                                  href={`mailto:${lead.email}`}
                                  title={lead.email}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  {lead.email}
                                </a>
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                            <td className={lead.phone ? undefined : "cell-empty"}>
                              {lead.phone ? (
                                <span className="mono">{lead.phone}</span>
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                            <td className={lead.contactName ? undefined : "cell-empty"}>
                              {lead.contactName ? (
                                <div className="cell-contact">
                                  {lead.contactUrl ? (
                                    <a
                                      className="file-link"
                                      href={lead.contactUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      onClick={(event) => event.stopPropagation()}
                                      title={lead.contactSource || lead.contactUrl}
                                    >
                                      {lead.contactName}
                                    </a>
                                  ) : (
                                    <strong>{lead.contactName}</strong>
                                  )}
                                  <span>{lead.contactRole || "Tim IT"}</span>
                                  {lead.contactSource ? (
                                    <span className="cell-sub">{lead.contactSource}</span>
                                  ) : null}
                                </div>
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                            <td className={lead.website ? undefined : "cell-empty"}>
                              {lead.website ? (
                                <a
                                  className="file-link corporate-site"
                                  href={lead.website}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(event) => event.stopPropagation()}
                                  title={lead.website}
                                >
                                  <GlobeIcon size={13} /> {websiteHost(lead.website)}
                                </a>
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                            <td>
                              <div className="cell-quote">
                                {existing ? (
                                  <>
                                    <StatusBadge status="prospek" />
                                    <span className="cell-sub">Sudah prospek</span>
                                  </>
                                ) : (
                                  <span className="cell-sub">Belum prospek</span>
                                )}
                              </div>
                            </td>
                            <td>
                              <div className="cell-actions">
                                <button
                                  type="button"
                                  className="btn btn-mini btn-secondary"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openLead(lead);
                                  }}
                                >
                                  Lihat
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="corporate-foot">
                  <span>
                    Menampilkan {rangeStart}–{rangeEnd} dari {filtered.length} lead
                    {hideProspek ? " · yang sudah masuk Prospek disembunyikan" : ""}
                  </span>
                  <div className="corporate-pager">
                    <button
                      type="button"
                      className="btn btn-mini btn-secondary"
                      disabled={currentPage <= 1}
                      onClick={() => setPage((value) => Math.max(1, value - 1))}
                    >
                      Sebelumnya
                    </button>
                    <span className="corporate-page-no">
                      {currentPage} / {totalPages}
                    </span>
                    <button
                      type="button"
                      className="btn btn-mini btn-secondary"
                      disabled={currentPage >= totalPages}
                      onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                    >
                      Berikutnya
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          <p className="corporate-source">
            Sumber data publik:{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noreferrer"
            >
              © OpenStreetMap contributors
            </a>
            . Data awal {data?.seedAt ? formatLongDate(data.seedAt.slice(0, 10)) : "-"}.
            Corporate Engine menarik data wilayah yang paling lama, mencari email serta
            nama/jabatan kontak IT dari situs perusahaan, lalu menyimpannya. Bila kunci Exa
            aktif, pencarian satu lead juga menelusuri LinkedIn dan direktori publik. Tombol
            Perbarui memaksa penarikan wilayah tertentu. Pengaturan robot ada di Profil →
            Robot AI.
          </p>
        </>
      )}

      <CorporateLeadDialog
        lead={selected}
        searching={leadSearching}
        error={leadError}
        visitLabel="Prospek"
        onClose={() => setSelected(null)}
        onVisit={visitSelected}
      />
    </div>
  );
}
