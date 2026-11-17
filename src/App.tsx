import { useEffect, useRef, useState } from "react";
import type {
  Company,
  Database,
  PoPinCredential,
  Profile,
  QuoteRecord,
  StoredFile,
  SyncState,
} from "./types";
import {
  emptyDatabase,
  bastEntries,
  commissionOf,
  latestQuoteForCompany,
  lostEntries,
  makeCompany,
  makeQuoteRecord,
  ppnOf,
  profileName,
  quoteFiles,
  todayISO,
  uploadedQuotes,
} from "./lib/data";
import {
  companyFieldsFromLead,
  findCompanyForLead,
  isCorporateLeadAddable,
  pruneIncompleteRobotCompanies,
  scrubRobotCompanyCoordinates,
  syncRobotCompanies,
  type CorporateLead,
} from "./lib/corporate";
import {
  ApiError,
  deletePdf,
  fetchCorporateData,
  fetchSession,
  fetchState,
  pushState,
  type SessionUser,
} from "./lib/api";
import { navigate, useRoute, type Route } from "./lib/useRoute";
import DashboardPage from "./components/DashboardPage";
import DashboardSummaryDialog, {
  type DashboardSummaryKind,
} from "./components/DashboardSummaryDialog";
import QuotesPage from "./components/QuotesPage";
import LostPage from "./components/LostPage";
import CorporatePage from "./components/CorporatePage";
import RobotPage from "./components/RobotPage";
import BastPage from "./components/BastPage";
import CompanyDrawer from "./components/CompanyDrawer";
import CompanyDialog, { type CompanyDraft } from "./components/CompanyDialog";
import QuotePicker from "./components/QuotePicker";
import LoginScreen from "./components/LoginScreen";
import ProfileDialog from "./components/ProfileDialog";
import PoPinDialog, { type PoPinMode } from "./components/PoPinDialog";
import BastDialog, { type BastSaveInput } from "./components/BastDialog";
import QuoteSendDialog, {
  type UploadedQuoteInfo,
} from "./components/QuoteSendDialog";
import QuoteBuilderDialog from "./components/QuoteBuilderDialog";
import {
  LostReasonDialog,
  PoUploadDialog,
  QuoteUploadDialog,
  SignedBastDialog,
  type PoUploadInput,
} from "./components/QuoteDialogs";
import { ConfirmDialog } from "./components/Dialogs";
import {
  AlertIcon,
  BuildingIcon,
  DocumentIcon,
  FileIcon,
  LogOutIcon,
  SparkIcon,
  UploadIcon,
} from "./components/icons";

type Status = "loading" | "signed-out" | "ready" | "error";

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel?: string;
  action: () => void;
}

interface ConflictState {
  data: Database | null;
  revision: number;
  updatedAt: string | null;
}

interface UploadTarget {
  companyId: string;
  existing: QuoteRecord | null;
}

function accountName(user: SessionUser): string {
  return user.name?.trim() || user.email?.trim() || "Akun Freebuff";
}

function BootScreen() {
  return (
    <div className="boot-screen">
      <span className="brand-mark boot-mark">P</span>
      <p>Memuat data akun…</p>
    </div>
  );
}

function BootError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="boot-screen">
      <div className="boot-error">
        <h1>Data belum bisa dimuat</h1>
        <p>
          Periksa koneksi internet Anda, lalu coba lagi. Perubahan yang belum
          tersimpan tidak hilang selama halaman ini terbuka.
        </p>
        <button type="button" className="btn btn-primary" onClick={onRetry}>
          Coba lagi
        </button>
        <form method="post" action="/auth/freebuff/signout" className="boot-signout">
          <input type="hidden" name="returnTo" value="/" />
          <button type="submit" className="link-btn">
            Keluar dari akun
          </button>
        </form>
      </div>
    </div>
  );
}

function Sidebar({
  route,
  companiesCount,
  quotesCount,
  bastCount,
  lostCount,
  onUploadQuote,
  onOpenProfile,
  user,
  username,
  syncState,
  onRetrySave,
}: {
  route: Route;
  companiesCount: number;
  quotesCount: number;
  bastCount: number;
  lostCount: number;
  onUploadQuote: () => void;
  onOpenProfile: () => void;
  user: SessionUser;
  username: string;
  syncState: SyncState;
  onRetrySave: () => void;
}) {
  const brandName = username.trim() || "Pane";
  const name = username.trim() || accountName(user);
  const initial = name.slice(0, 1).toUpperCase();
  const syncLabel =
    syncState === "saving"
      ? "Menyinkronkan…"
      : syncState === "error"
        ? "Gagal menyimpan"
        : syncState === "conflict"
          ? "Data berubah di perangkat lain"
          : "Tersinkron ke akun";

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-mark">{brandName.slice(0, 1).toUpperCase()}</span>
        <div>
          <strong>Hallo {brandName}</strong>
          <span>Prospek &amp; penawaran</span>
        </div>
      </div>

      <button
        type="button"
        className="btn btn-primary btn-block sidebar-cta"
        onClick={onUploadQuote}
      >
        <UploadIcon size={16} /> Upload penawaran
      </button>

      <nav className="sidebar-nav">
        <a href="#/corporate" className={route.name === "corporate" ? "active" : ""}>
          <SparkIcon size={17} />
          <span>Corporate Engine</span>
        </a>
        <a href="#/" className={route.name === "companies" ? "active" : ""}>
          <BuildingIcon size={17} />
          <span>Prospek</span>
          <span className="nav-count">{companiesCount}</span>
        </a>
        <a href="#/penawaran" className={route.name === "quotes" ? "active" : ""}>
          <FileIcon size={17} />
          <span>Penawaran</span>
          <span className="nav-count">{quotesCount}</span>
        </a>
        <a href="#/bast" className={route.name === "bast" ? "active" : ""}>
          <DocumentIcon size={17} />
          <span>BAST</span>
          <span className="nav-count">{bastCount}</span>
        </a>
        <a href="#/cancel" className={route.name === "lost" ? "active" : ""}>
          <AlertIcon size={17} />
          <span>Cancel</span>
          <span className="nav-count">{lostCount}</span>
        </a>
      </nav>

      <div className="sidebar-spacer" />

      <div className="sidebar-card">
        <SparkIcon size={16} />
        <strong>Penawaran dalam bentuk PDF</strong>
        <p>Unggah PDF penawaran Anda; nomornya tercatat otomatis dari file.</p>
      </div>

      <div className="sidebar-user">
        <button
          type="button"
          className="sidebar-user-main"
          onClick={onOpenProfile}
          title="Buka profil"
          aria-label="Buka profil"
        >
          <span className="sidebar-avatar">
            {user.picture ? (
              <img src={user.picture} alt="" referrerPolicy="no-referrer" />
            ) : (
              initial
            )}
          </span>
          <span className="sidebar-user-text">
            <strong>{name}</strong>
            <span>Akun Freebuff</span>
          </span>
        </button>
        <form method="post" action="/auth/freebuff/signout" className="signout-form">
          <input type="hidden" name="returnTo" value="/" />
          <button type="submit" className="icon-btn sidebar-logout" title="Keluar" aria-label="Keluar">
            <LogOutIcon size={16} />
          </button>
        </form>
      </div>

      <div className={`sidebar-sync sync-${syncState}`}>
        <span className="sync-dot" />
        <span>{syncLabel}</span>
        {syncState === "error" ? (
          <button type="button" className="sync-retry" onClick={onRetrySave}>
            Coba lagi
          </button>
        ) : null}
      </div>

      <div className="sidebar-foot">
        <span className="sidebar-foot-sub">PT. Usaha Adi Sanggoro · ASNET Pane</span>
      </div>
    </aside>
  );
}

export default function App() {
  const [status, setStatus] = useState<Status>("loading");
  const [bootAttempt, setBootAttempt] = useState(0);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [db, setDb] = useState<Database | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const route = useRoute();

  const [companyDialog, setCompanyDialog] = useState<{ open: boolean; initial: Company | null }>({
    open: false,
    initial: null,
  });
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [quoteBuilderId, setQuoteBuilderId] = useState<string | null>(null);
  const [uploadTarget, setUploadTarget] = useState<UploadTarget | null>(null);
  const [sendTarget, setSendTarget] = useState<UploadedQuoteInfo | null>(null);
  const [lostTarget, setLostTarget] = useState<Company | null>(null);
  const [poTarget, setPoTarget] = useState<QuoteRecord | null>(null);
  const [bastTarget, setBastTarget] = useState<QuoteRecord | null>(null);
  const [signedBastTarget, setSignedBastTarget] = useState<QuoteRecord | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [commissionUnlocked, setCommissionUnlocked] = useState(false);
  const [pinDialog, setPinDialog] = useState<{ mode: PoPinMode } | null>(null);
  const [summaryKind, setSummaryKind] = useState<DashboardSummaryKind | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const pinAfterRef = useRef<(() => void) | null>(null);

  const dbRef = useRef<Database | null>(null);
  const revisionRef = useRef(0);
  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const conflictRef = useRef(false);
  const skipSaveRef = useRef(true);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const pendingFileDeletesRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (status !== "ready" || !db) return;
    document.title = `Hallo ${profileName(db.profile)} — Prospek & Penawaran`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, db?.profile?.username]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");

    (async () => {
      try {
        const currentUser = await fetchSession();
        if (cancelled) return;
        setUser(currentUser);

        if (!currentUser) {
          setStatus("signed-out");
          return;
        }

        const snapshot = await fetchState();
        if (cancelled) return;

        const initial = snapshot.data ?? emptyDatabase();
        // Sinkronkan dulu data lead terbaru, baru buang record robot yang tetap tidak lengkap.
        let cleaned = initial;
        try {
          const corporate = await fetchCorporateData();
          cleaned = syncRobotCompanies(cleaned, corporate.leads);
        } catch {
          // Sinkronisasi data robot bersifat pelengkap; Prospek tetap bisa dibuka.
        }
        cleaned = pruneIncompleteRobotCompanies(cleaned);
        cleaned = scrubRobotCompanyCoordinates(cleaned);
        revisionRef.current = snapshot.revision;
        dbRef.current = cleaned;
        conflictRef.current = false;
        // Bila ada record robot lama yang belum lengkap atau berubah, simpan.
        skipSaveRef.current = cleaned === initial;
        setConflict(null);
        setDb(cleaned);
        setSyncState(snapshot.updatedAt ? "saved" : "idle");
        setStatus("ready");
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          setUser(null);
          setStatus("signed-out");
          return;
        }
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bootAttempt]);

  useEffect(() => {
    if (status !== "ready" || !db) return;
    dbRef.current = db;
    if (skipSaveRef.current) {
      skipSaveRef.current = false;
      return;
    }
    if (conflictRef.current) return;
    scheduleSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, status]);

  function scheduleSave() {
    if (conflictRef.current) return;
    setSyncState("saving");
    window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void flushSave();
    }, 700);
  }

  async function flushSave() {
    if (!dbRef.current) return;
    if (savingRef.current) {
      pendingRef.current = true;
      return;
    }

    window.clearTimeout(saveTimerRef.current);
    savingRef.current = true;
    pendingRef.current = false;
    setSyncState("saving");

    try {
      const result = await pushState(dbRef.current, revisionRef.current);

      if (result.conflict) {
        if (!mountedRef.current) return;
        conflictRef.current = true;
        // Jangan hapus objek R2 saat state lokal belum berhasil disimpan;
        // versi server bisa jadi masih mereferensikan file tersebut.
        pendingFileDeletesRef.current.clear();
        setConflict({ data: result.data, revision: result.revision, updatedAt: result.updatedAt });
        setSyncState("conflict");
        return;
      }

      revisionRef.current = result.revision;
      if (mountedRef.current) setSyncState("saved");
      // Objek R2 baru dihapus setelah referensinya benar-benar tersimpan di
      // D1. Jika penyimpanan gagal, file tetap ada dan tidak menjadi tautan
      // mati pada state lama. Proses ini tetap berjalan walau komponen sudah
      // unmount karena state server sudah committed.
      const pendingDeletes = Array.from(pendingFileDeletesRef.current);
      pendingFileDeletesRef.current.clear();
      for (const fileId of pendingDeletes) {
        void deletePdf(fileId).catch((error) => {
          pendingFileDeletesRef.current.add(fileId);
          console.error("delete_pdf_error", error);
        });
      }
    } catch (error) {
      if (!mountedRef.current) return;
      if (error instanceof ApiError && error.status === 401) {
        setUser(null);
        setStatus("signed-out");
        return;
      }
      setSyncState("error");
    } finally {
      savingRef.current = false;
      if (pendingRef.current && !conflictRef.current && mountedRef.current) {
        pendingRef.current = false;
        scheduleSave();
      }
    }
  }

  const updateDb = (updater: (previous: Database) => Database) => {
    setDb((previous) => (previous ? updater(previous) : previous));
  };

  const addLocation = (name: string) => {
    updateDb((previous) =>
      previous.locations.some((location) => location.toLowerCase() === name.toLowerCase())
        ? previous
        : { ...previous, locations: [...previous.locations, name] },
    );
  };

  const openNewCompany = () => setCompanyDialog({ open: true, initial: null });

  const openEditCompany = (company: Company) => {
    setDrawerId(null);
    setCompanyDialog({ open: true, initial: company });
  };

  const saveCompany = (draft: CompanyDraft) => {
    const editing = companyDialog.initial;
    updateDb((previous) => ({
      ...previous,
      companies: editing
        ? previous.companies.map((company) =>
            company.id === editing.id ? { ...company, ...draft } : company,
          )
        : [makeCompany(draft), ...previous.companies],
    }));
    setCompanyDialog({ open: false, initial: null });
  };

  const openUploadForCompany = (companyId: string) => {
    if (!db) return;
    const company = db.companies.find((item) => item.id === companyId);
    if (!company) return;
    const existing = latestQuoteForCompany(db.quotes, companyId);
    const cancelled = existing?.status === "tidak-jadi" || (!existing && Boolean(company.lostAt));
    if (cancelled) {
      setPickerOpen(false);
      setDrawerId(companyId);
      return;
    }
    setPickerOpen(false);
    setDrawerId(null);
    setUploadTarget({ companyId, existing });
  };

  const saveUploadedQuote = (input: {
    companyId: string;
    number: string;
    date: string;
    quoteFile: StoredFile;
  }) => {
    const now = new Date().toISOString();
    let saved = input;
    updateDb((previous) => {
      const existing = latestQuoteForCompany(previous.quotes, input.companyId);
      if (existing) {
        // Satu perusahaan memakai satu seri nomor. Mengganti PDF tidak boleh
        // mengubah nomor, tetapi tanggal penawaran mengikuti input terbaru.
        // Riwayat PDF lama tetap disimpan.
        const number = existing.number;
        const date = input.date || existing.date;
        const sameFile = existing.quoteFile?.id === input.quoteFile.id;
        const history = sameFile
          ? existing.quoteHistory ?? []
          : [...(existing.quoteHistory ?? []), existing.quoteFile];
        saved = { ...input, number, date };
        return {
          ...previous,
          companies: previous.companies.map((company) =>
            company.id === input.companyId
              ? { ...company, lostReason: "", lostAt: "" }
              : company,
          ),
          quotes: previous.quotes.map((quote) =>
            quote.id === existing.id
              ? {
                  ...quote,
                  date,
                  quoteFile: input.quoteFile,
                  quoteHistory: history,
                  updatedAt: now,
                }
              : quote,
          ),
        };
      }
      return {
        ...previous,
        companies: previous.companies.map((company) =>
          company.id === input.companyId
            ? { ...company, lostReason: "", lostAt: "" }
            : company,
        ),
        quotes: [makeQuoteRecord(input), ...previous.quotes],
      };
    });
    setUploadTarget(null);
    setSendTarget(saved);
  };

  const requestDeleteQuoteFile = (
    company: Company,
    quote: QuoteRecord,
    file: StoredFile,
  ) => {
    const remaining = quoteFiles(quote).filter((item) => item.id !== file.id);
    const deletingCurrent = quote.quoteFile.id === file.id;
    setConfirmState({
      title: "Hapus PDF penawaran?",
      message:
        deletingCurrent && remaining.length === 0
          ? `PDF ${file.name} akan dihapus. Record penawaran ${quote.number} juga dihapus karena tidak ada PDF lain.`
          : deletingCurrent
            ? `PDF ${file.name} akan dihapus. PDF versi sebelumnya akan menjadi PDF penawaran aktif dengan nomor ${quote.number}.`
            : `PDF ${file.name} akan dihapus dari riwayat ${company.name}. Nomor penawaran tidak berubah.`,
      confirmLabel: "Hapus PDF",
      action: () => {
        pendingFileDeletesRef.current.add(file.id);
        updateDb((previous) => {
          const target = previous.quotes.find((item) => item.id === quote.id);
          if (!target) return previous;
          const files = quoteFiles(target);
          const nextFiles = files.filter((item) => item.id !== file.id);
          if (target.quoteFile.id === file.id && nextFiles.length === 0) {
            return {
              ...previous,
              quotes: previous.quotes.filter((item) => item.id !== target.id),
            };
          }
          if (target.quoteFile.id !== file.id) {
            return {
              ...previous,
              quotes: previous.quotes.map((item) =>
                item.id === target.id
                  ? {
                      ...item,
                      quoteHistory: (item.quoteHistory ?? []).filter(
                        (version) => version.id !== file.id,
                      ),
                      updatedAt: new Date().toISOString(),
                    }
                  : item,
              ),
            };
          }
          // PDF aktif dihapus: promosikan versi sebelumnya yang paling baru.
          const [nextCurrent, ...rest] = nextFiles;
          return {
            ...previous,
            quotes: previous.quotes.map((item) =>
              item.id === target.id
                ? {
                    ...item,
                    quoteFile: nextCurrent,
                    quoteHistory: rest.slice().reverse(),
                    updatedAt: new Date().toISOString(),
                  }
                : item,
            ),
          };
        });
        if (deletingCurrent && remaining.length === 0) setUploadTarget(null);
      },
    });
  };

  const markLost = (companyId: string, reason: string) => {
    const now = new Date().toISOString();
    const lostAt = todayISO();
    updateDb((previous) => {
      const quote = latestQuoteForCompany(previous.quotes, companyId);
      if (quote?.status === "po") return previous;
      return {
        ...previous,
        companies: previous.companies.map((company) =>
          company.id === companyId ? { ...company, lostReason: reason, lostAt } : company,
        ),
        quotes: quote
          ? previous.quotes.map((item) =>
              item.id === quote.id
                ? {
                    ...item,
                    status: "tidak-jadi",
                    lostReason: reason,
                    lostAt,
                    updatedAt: now,
                  }
                : item,
            )
          : previous.quotes,
      };
    });
  };

  const savePo = (quote: QuoteRecord, input: PoUploadInput) => {
    const now = new Date().toISOString();
    updateDb((previous) => ({
      ...previous,
      quotes: previous.quotes.map((item) =>
        item.id === quote.id
          ? {
              ...item,
              status: "po",
              poFile: input.file ?? item.poFile,
              poAt: item.poAt || todayISO(),
              poAmount: input.amount,
              poPpn: ppnOf(input.amount),
              poYears: input.years,
              poCommission: commissionOf(input.amount),
              updatedAt: now,
            }
          : item,
      ),
    }));
  };

  const saveBast = (quote: QuoteRecord, input: BastSaveInput) => {
    const now = new Date().toISOString();
    updateDb((previous) => ({
      ...previous,
      quotes: previous.quotes.map((item) =>
        item.id === quote.id
          ? { ...item, bast: input.bast, bastFile: input.file, updatedAt: now }
          : item,
      ),
    }));
    setBastTarget(null);
    setDrawerId(quote.companyId);
  };

  const saveSignedBast = (quote: QuoteRecord, file: StoredFile) => {
    const now = new Date().toISOString();
    updateDb((previous) => ({
      ...previous,
      quotes: previous.quotes.map((item) =>
        item.id === quote.id
          ? {
              ...item,
              bastSignedFile: file,
              bastSignedAt: todayISO(),
              updatedAt: now,
            }
          : item,
      ),
    }));
    setSignedBastTarget(null);
    setDrawerId(quote.companyId);
  };

  const saveProfile = (profile: Profile) => {
    updateDb((previous) => ({
      ...previous,
      profile: {
        ...(previous.profile ?? { username: "", phone: "", email: "" }),
        ...profile,
      },
    }));
  };

  const savePoPin = (poPin: PoPinCredential) => {
    updateDb((previous) => ({
      ...previous,
      profile: {
        ...(previous.profile ?? { username: "", phone: "", email: "" }),
        poPin,
      },
    }));
  };

  const closePoPin = () => {
    pinAfterRef.current = null;
    setPinDialog(null);
  };

  const finishPoPin = () => {
    setCommissionUnlocked(true);
    setPinDialog(null);
    const after = pinAfterRef.current;
    pinAfterRef.current = null;
    after?.();
  };

  const requestCommissionAccess = (after: () => void) => {
    if (commissionUnlocked) {
      after();
      return;
    }
    pinAfterRef.current = after;
    setPinDialog({ mode: db?.profile?.poPin ? "unlock" : "setup" });
  };

  const toggleCommission = () => {
    if (commissionUnlocked) {
      setCommissionUnlocked(false);
      return;
    }
    requestCommissionAccess(() => setCommissionUnlocked(true));
  };

  const openPoPin = (mode: "setup" | "change" | "forgot") => {
    pinAfterRef.current = null;
    setPinDialog({ mode });
  };

  const addCorporateLead = (lead: CorporateLead, manual = false): string | null => {
    const current = dbRef.current;
    const existing = current ? findCompanyForLead(lead, current.companies) : null;
    // Gate yang sama juga berlaku untuk tombol manual di Corporate Engine.
    // Review OpenSanctions yang belum dikonfirmasi dan titik pusat wilayah
    // tidak boleh masuk Prospek lewat jalur mana pun.
    if (!isCorporateLeadAddable(lead, manual)) {
      return existing ? existing.id : null;
    }
    const fields = companyFieldsFromLead(lead, existing ?? undefined, {
      verifiedCoordinateOnly: true,
    });
    if (manual) {
      // Tambahan manual tidak boleh ikut dibersihkan oleh prune robot yang
      // hanya menyimpan lead tervalidasi. Tetap tanpa sourceLeadId agar tidak
      // dianggap sebagai hasil publish otomatis.
      fields.source = "Corporate Engine · Manual";
      fields.sourceLeadId = "";
    }

    if (existing) {
      const location = fields.location || existing.location;
      updateDb((previous) => {
        const target = previous.companies.find((company) => company.id === existing.id);
        if (!target) return previous;
        return {
          ...previous,
          companies: previous.companies.map((company) =>
            company.id === existing.id
              ? {
                  ...company,
                  ...fields,
                  id: company.id,
                  createdAt: company.createdAt,
                  visitDate: company.visitDate,
                  lostReason: company.lostReason,
                  lostAt: company.lostAt,
                }
              : company,
          ),
          locations:
            location && !previous.locations.includes(location)
              ? [...previous.locations, location]
              : previous.locations,
        };
      });
      return existing.id;
    }

    const location = fields.location || current?.locations[0] || "Jakarta";
    const company = makeCompany({
      ...fields,
      name: lead.name,
      location,
      source: "Corporate Engine",
    });

    updateDb((previous) => {
      const duplicate = findCompanyForLead(lead, previous.companies);
      if (duplicate) {
        return {
          ...previous,
          companies: previous.companies.map((item) =>
            item.id === duplicate.id
              ? {
                  ...item,
                  ...fields,
                  id: item.id,
                  createdAt: item.createdAt,
                  visitDate: item.visitDate,
                  lostReason: item.lostReason,
                  lostAt: item.lostAt,
                }
              : item,
          ),
          locations:
            location && !previous.locations.includes(location)
              ? [...previous.locations, location]
              : previous.locations,
        };
      }
      return {
        ...previous,
        companies: [company, ...previous.companies],
        locations: previous.locations.includes(location)
          ? previous.locations
          : [...previous.locations, location],
      };
    });
    return company.id;
  };

  const renameCompany = (companyId: string, name: string) => {
    const next = name.trim();
    if (!next) return;
    updateDb((previous) => ({
      ...previous,
      companies: previous.companies.map((company) =>
        company.id === companyId ? { ...company, name: next } : company,
      ),
    }));
  };

  const saveCommissionStart = (quoteId: string, start: string) => {
    const now = new Date().toISOString();
    updateDb((previous) => ({
      ...previous,
      quotes: previous.quotes.map((quote) =>
        quote.id === quoteId
          ? { ...quote, commissionStart: start, updatedAt: now }
          : quote,
      ),
    }));
  };

  const requestDeleteCompany = (company: Company) => {
    const count =
      db?.quotes.filter((quote) => quote.companyId === company.id && quote.quoteFile).length ?? 0;
    setConfirmState({
      title: "Hapus perusahaan?",
      message: `${company.name}${count > 0 ? ` beserta ${count} penawarannya` : ""} akan dihapus permanen.`,
      action: () => {
        updateDb((previous) => ({
          ...previous,
          companies: previous.companies.filter((item) => item.id !== company.id),
          quotes: previous.quotes.filter((quote) => quote.companyId !== company.id),
        }));
        setDrawerId(null);
      },
    });
  };

  const keepLocalVersion = () => {
    if (!conflict) return;
    revisionRef.current = conflict.revision;
    conflictRef.current = false;
    setConflict(null);
    setSyncState("saving");
    void flushSave();
  };

  const loadServerVersion = () => {
    if (!conflict) return;
    const latest = conflict.data ?? emptyDatabase();
    revisionRef.current = conflict.revision;
    conflictRef.current = false;
    pendingFileDeletesRef.current.clear();
    setConflict(null);
    skipSaveRef.current = true;
    dbRef.current = latest;
    setDb(latest);
    setSyncState("saved");
  };

  if (status === "loading") return <BootScreen />;
  if (status === "signed-out") return <LoginScreen />;
  if (status === "error") {
    return <BootError onRetry={() => setBootAttempt((attempt) => attempt + 1)} />;
  }
  if (!db || !user) return <BootScreen />;

  const drawerCompany = db.companies.find((company) => company.id === drawerId) ?? null;
  const quoteBuilderCompany =
    db.companies.find((company) => company.id === quoteBuilderId) ?? null;
  const drawerQuote = drawerCompany
    ? latestQuoteForCompany(db.quotes, drawerCompany.id)
    : null;
  const uploadCompany = uploadTarget
    ? db.companies.find((company) => company.id === uploadTarget.companyId) ?? null
    : null;
  const uploadQuote = uploadTarget?.existing
    ? db.quotes.find((quote) => quote.id === uploadTarget.existing?.id) ?? null
    : null;
  const lostCompany = lostTarget
    ? db.companies.find((company) => company.id === lostTarget.id) ?? null
    : null;
  const lostQuote = lostCompany
    ? latestQuoteForCompany(db.quotes, lostCompany.id)
    : null;
  const poCompany = poTarget
    ? db.companies.find((company) => company.id === poTarget.companyId) ?? null
    : null;
  const bastCompany = bastTarget
    ? db.companies.find((company) => company.id === bastTarget.companyId) ?? null
    : null;
  const signedBastCompany = signedBastTarget
    ? db.companies.find((company) => company.id === signedBastTarget.companyId) ?? null
    : null;
  const sendCompany = sendTarget
    ? db.companies.find((company) => company.id === sendTarget.companyId) ?? null
    : null;
  const quotesCount = uploadedQuotes(db.quotes).length;
  const bastCount = bastEntries(db.companies, db.quotes).length;
  const lostCount = lostEntries(db.companies, db.quotes).length;
  const username = db.profile?.username ?? "";

  return (
    <div className="app">
      <Sidebar
        route={route}
        companiesCount={db.companies.length}
        quotesCount={quotesCount}
        bastCount={bastCount}
        lostCount={lostCount}
        onUploadQuote={() => setPickerOpen(true)}
        onOpenProfile={() => setProfileOpen(true)}
        user={user}
        username={username}
        syncState={syncState}
        onRetrySave={() => void flushSave()}
      />

      <main className="app-main">
        {route.name === "companies" ? (
          <DashboardPage
            companies={db.companies}
            quotes={db.quotes}
            locations={db.locations}
            onAddCompany={openNewCompany}
            onOpenCompany={setDrawerId}
            onUploadQuote={openUploadForCompany}
            commissionUnlocked={commissionUnlocked}
            onToggleCommission={toggleCommission}
            onOpenSummary={setSummaryKind}
          />
        ) : null}

        {route.name === "corporate" ? (
          <CorporatePage
            companies={db.companies}
            onVisitLead={addCorporateLead}
            onOpenCompany={setDrawerId}
          />
        ) : null}

        {route.name === "robot" ? (
          <RobotPage
            companies={db.companies}
            onVisitLead={addCorporateLead}
            onOpenCompany={setDrawerId}
            onOpenProfile={() => setProfileOpen(true)}
          />
        ) : null}

        {route.name === "quotes" ? (
          <QuotesPage
            quotes={db.quotes}
            companies={db.companies}
            onUploadQuote={() => setPickerOpen(true)}
            onOpenCompany={setDrawerId}
          />
        ) : null}

        {route.name === "bast" ? (
          <BastPage
            quotes={db.quotes}
            companies={db.companies}
            onOpenCompany={setDrawerId}
          />
        ) : null}

        {route.name === "lost" ? (
          <LostPage
            quotes={db.quotes}
            companies={db.companies}
            onOpenCompany={setDrawerId}
          />
        ) : null}
      </main>

      <DashboardSummaryDialog
        key={summaryKind ?? "closed"}
        open={summaryKind !== null}
        initialKind={summaryKind ?? "visit"}
        companies={db.companies}
        quotes={db.quotes}
        onClose={() => setSummaryKind(null)}
        onOpenCompany={(id) => {
          setSummaryKind(null);
          setDrawerId(id);
        }}
      />

      <CompanyDialog
        open={companyDialog.open}
        initial={companyDialog.initial}
        locations={db.locations}
        onClose={() => setCompanyDialog({ open: false, initial: null })}
        onAddLocation={addLocation}
        onSave={saveCompany}
      />

      <CompanyDrawer
        company={drawerCompany}
        quote={drawerQuote}
        onClose={() => setDrawerId(null)}
        onEdit={openEditCompany}
        onUploadQuote={openUploadForCompany}
        onMarkLost={(company) => {
          setDrawerId(null);
          setLostTarget(company);
        }}
        onUploadPo={(quote) => {
          setDrawerId(null);
          setPoTarget(quote);
        }}
        onOpenBast={(quote) => {
          setDrawerId(null);
          setBastTarget(quote);
        }}
        onUploadSignedBast={(quote) => {
          setDrawerId(null);
          setSignedBastTarget(quote);
        }}
        onDelete={requestDeleteCompany}
        onDeleteQuoteFile={requestDeleteQuoteFile}
        onCreateQuote={(companyId) => setQuoteBuilderId(companyId)}
      />

      <QuotePicker
        open={pickerOpen}
        companies={db.companies}
        quotes={db.quotes}
        onClose={() => setPickerOpen(false)}
        onPick={openUploadForCompany}
        onCreateCompany={() => {
          setPickerOpen(false);
          openNewCompany();
        }}
      />

      <QuoteUploadDialog
        open={Boolean(uploadTarget)}
        company={uploadCompany}
        existing={uploadQuote}
        quotes={db.quotes}
        onClose={() => setUploadTarget(null)}
        onSave={saveUploadedQuote}
        onDeleteVersion={(file) => {
          if (uploadCompany && uploadQuote) {
            requestDeleteQuoteFile(uploadCompany, uploadQuote, file);
          }
        }}
        onOpenBuilder={() => {
          if (!uploadCompany) return;
          const companyId = uploadCompany.id;
          setUploadTarget(null);
          setDrawerId(null);
          setQuoteBuilderId(companyId);
        }}
      />

      <QuoteBuilderDialog
        open={Boolean(quoteBuilderCompany)}
        company={quoteBuilderCompany}
        existing={
          quoteBuilderCompany
            ? latestQuoteForCompany(db.quotes, quoteBuilderCompany.id)
            : null
        }
        quotes={db.quotes}
        onClose={() => setQuoteBuilderId(null)}
        onRenameCompany={renameCompany}
        onSave={saveUploadedQuote}
      />

      <QuoteSendDialog
        open={Boolean(sendTarget)}
        company={sendCompany}
        quote={sendTarget}
        profile={db.profile ?? { username: "", phone: "", email: "" }}
        senderName={username.trim() || accountName(user)}
        onClose={() => setSendTarget(null)}
      />

      <LostReasonDialog
        open={Boolean(lostTarget)}
        company={lostCompany}
        quote={lostQuote}
        onClose={() => setLostTarget(null)}
        onSave={(reason) => {
          if (lostCompany) markLost(lostCompany.id, reason);
        }}
      />

      <PoUploadDialog
        open={Boolean(poTarget)}
        company={poCompany}
        quote={poTarget}
        onClose={() => setPoTarget(null)}
        onSave={(input) => {
          if (poTarget) savePo(poTarget, input);
        }}
      />

      <BastDialog
        open={Boolean(bastTarget)}
        company={bastCompany}
        quote={bastTarget}
        onClose={() => setBastTarget(null)}
        onSave={(input) => {
          if (bastTarget) saveBast(bastTarget, input);
        }}
      />

      <SignedBastDialog
        open={Boolean(signedBastTarget)}
        company={signedBastCompany}
        quote={signedBastTarget}
        onClose={() => setSignedBastTarget(null)}
        onSave={(file) => {
          if (signedBastTarget) saveSignedBast(signedBastTarget, file);
        }}
      />

      <ProfileDialog
        open={profileOpen}
        user={user}
        profile={db.profile}
        quotes={db.quotes}
        companies={db.companies}
        poPin={db.profile?.poPin}
        commissionUnlocked={commissionUnlocked}
        onClose={() => setProfileOpen(false)}
        onSave={saveProfile}
        onCommissionStart={saveCommissionStart}
        onUnlockCommission={requestCommissionAccess}
        onLockCommission={() => setCommissionUnlocked(false)}
        onOpenPoPin={openPoPin}
        onOpenRobot={() => {
          setProfileOpen(false);
          navigate("robot");
        }}
      />

      <PoPinDialog
        open={Boolean(pinDialog)}
        mode={pinDialog?.mode ?? "unlock"}
        credential={db.profile?.poPin}
        profileEmail={db.profile?.email ?? ""}
        accountEmail={user.email ?? ""}
        onClose={closePoPin}
        onSave={savePoPin}
        onUnlocked={finishPoPin}
      />

      <ConfirmDialog
        open={Boolean(confirmState)}
        title={confirmState?.title ?? ""}
        message={confirmState?.message ?? ""}
        confirmLabel={confirmState?.confirmLabel}
        onClose={() => setConfirmState(null)}
        onConfirm={() => {
          confirmState?.action();
          setConfirmState(null);
        }}
      />

      {conflict ? (
        <div className="conflict-bar" role="alert">
          <div>
            <strong>Data ini sudah diperbarui di perangkat lain.</strong>
            <span>
              Pilih versi yang ingin dipakai. Perubahan yang belum tersimpan ada di
              halaman ini.
            </span>
          </div>
          <div className="conflict-actions">
            <button type="button" className="btn btn-mini btn-secondary" onClick={loadServerVersion}>
              Muat versi terbaru
            </button>
            <button type="button" className="btn btn-mini btn-primary" onClick={keepLocalVersion}>
              Simpan versi saya
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
