import { useEffect, useState } from "react";
import type { Company, PoPinCredential, Profile, QuoteRecord } from "../types";
import {
  commissionPlan,
  formatCompactIDR,
  formatIDR,
  formatMonthYear,
  formatShortDate,
  formatYears,
  type CommissionPlan,
} from "../lib/data";
import type { SessionUser } from "../lib/api";
import { Modal } from "./Dialogs";
import {
  ArrowLeftIcon,
  CalendarIcon,
  KeyIcon,
  LockIcon,
  MailIcon,
  PhoneIcon,
  SparkIcon,
  TrendIcon,
} from "./icons";

interface Props {
  open: boolean;
  user: SessionUser;
  profile: Profile | undefined;
  quotes: QuoteRecord[];
  companies: Company[];
  poPin: PoPinCredential | undefined;
  commissionUnlocked: boolean;
  onClose: () => void;
  onSave: (profile: Profile) => void;
  onCommissionStart: (quoteId: string, start: string) => void;
  onUnlockCommission: (after: () => void) => void;
  onLockCommission: () => void;
  onOpenPoPin: (mode: "setup" | "change" | "forgot") => void;
  onOpenRobot: () => void;
}

type View = "profile" | "commission" | "po-pin";

function accountName(user: SessionUser): string {
  return user.name?.trim() || user.email?.trim() || "Akun Freebuff";
}

function CommissionCard({
  plan,
  onCommissionStart,
}: {
  plan: CommissionPlan;
  onCommissionStart: (quoteId: string, start: string) => void;
}) {
  const { quote } = plan;
  const inputId = `commission-start-${quote.id}`;
  const stateLabel =
    plan.status === "done"
      ? `Selesai · ${formatMonthYear(plan.endDate)}`
      : plan.status === "running"
        ? `Berjalan · bulan ${plan.monthIndex} dari ${plan.months}`
        : plan.status === "upcoming"
          ? `Mulai ${formatShortDate(plan.start)}`
          : "Tanggal mulai belum diisi";

  return (
    <article className="commission-card">
      <div className="commission-card-head">
        <div className="commission-card-title">
          <strong>{plan.company?.name ?? "Perusahaan terhapus"}</strong>
          <span className="mono">{quote.number}</span>
        </div>
        <span className={`chip ${plan.onceOnly ? "chip-warm" : "chip-soft"}`}>
          {plan.onceOnly ? "Sekali bayar" : `${formatYears(quote.poYears)} · ${plan.months} bulan`}
        </span>
      </div>

      <div className="commission-figures">
        <div>
          <span>Besaran PO</span>
          <strong>{formatIDR(quote.poAmount)}</strong>
        </div>
        <div>
          <span>Komisi 10%</span>
          <strong>{formatIDR(plan.total)}</strong>
        </div>
      </div>

      <div className="commission-start">
        <label htmlFor={inputId}>Tanggal mulai komisi</label>
        <input
          id={inputId}
          type="date"
          value={plan.start}
          onChange={(event) => onCommissionStart(quote.id, event.target.value)}
        />
        <span className={`commission-state state-${plan.status}`}>{stateLabel}</span>
        <span className="field-hint">
          {plan.onceOnly
            ? plan.start
              ? `Lama kontrak belum diisi, jadi komisi 10% diterima 1 kali pada ${formatShortDate(plan.start)}.`
              : "Lama kontrak belum diisi, jadi komisi 10% hanya diterima 1 kali."
            : plan.start
              ? `Komisi 10% diterima selama ${plan.months} bulan: ${formatShortDate(plan.start)} – ${formatMonthYear(plan.endDate)}.`
              : `Isi tanggal, bulan, dan tahun mulai komisi diterima (${plan.months} bulan).`}
        </span>
      </div>
    </article>
  );
}

export default function ProfileDialog({
  open,
  user,
  profile,
  quotes,
  companies,
  poPin,
  commissionUnlocked,
  onClose,
  onSave,
  onCommissionStart,
  onUnlockCommission,
  onLockCommission,
  onOpenPoPin,
  onOpenRobot,
}: Props) {
  const [view, setView] = useState<View>("profile");
  const [username, setUsername] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setView("profile");
    setUsername(profile?.username ?? "");
    setPhone(profile?.phone ?? "");
    setEmail(profile?.email ?? "");
    setError("");
  }, [open, profile?.username, profile?.phone, profile?.email]);

  const displayName = accountName(user);
  const initial = (username.trim() || displayName).slice(0, 1).toUpperCase();

  const companyById = new Map(companies.map((company) => [company.id, company]));
  const plans = quotes
    .filter((quote) => quote.status === "po" && (quote.poCommission || 0) > 0)
    .map((quote) => commissionPlan(quote, companyById.get(quote.companyId) ?? null))
    .sort((a, b) =>
      (b.quote.poAt || b.quote.updatedAt).localeCompare(a.quote.poAt || a.quote.updatedAt),
    );

  const totalCommission = plans.reduce((sum, plan) => sum + plan.total, 0);
  const runningCount = plans.filter((plan) => plan.status === "running").length;
  const unsetCount = plans.filter((plan) => plan.status === "unset").length;
  const poWithoutValue = quotes.filter(
    (quote) => quote.status === "po" && !(quote.poCommission > 0),
  ).length;

  const openCommission = () => {
    onUnlockCommission(() => setView("commission"));
  };

  const backToProfile = () => {
    onLockCommission();
    setView("profile");
  };

  const submit = () => {
    const name = username.trim();
    if (!name) {
      setError("Username wajib diisi.");
      return;
    }
    if (name.length > 40) {
      setError("Username maksimal 40 karakter.");
      return;
    }
    const contactEmail = email.trim();
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      setError("Alamat e-mail belum benar.");
      return;
    }
    onSave({ username: name, phone: phone.trim(), email: contactEmail });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        view === "commission"
          ? "Laporan komisi"
          : view === "po-pin"
            ? "Password PO"
            : "Profil"
      }
      subtitle={
        view === "commission"
          ? "Komisi 10% dari nilai PO beserta masa penerimaannya."
          : view === "po-pin"
            ? "PIN 6 digit untuk membuka nilai komisi PO."
            : "Nama dan kontak yang dipakai di aplikasi."
      }
      width={view === "commission" ? 760 : 540}
      footer={
        view !== "profile" ? (
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Tutup
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Batal
            </button>
            <button type="button" className="btn btn-primary" onClick={submit}>
              Simpan
            </button>
          </>
        )
      }
    >
      {view === "commission" ? (
        <div className="commission-report">
          <button
            type="button"
            className="link-btn commission-back"
            onClick={backToProfile}
          >
            <ArrowLeftIcon size={14} /> Kembali ke profil
          </button>

          <div className="commission-stats">
            <div className="stat">
              <span className="stat-icon tone-green">
                <TrendIcon size={18} />
              </span>
              <div>
                <span className="stat-label">Total komisi</span>
                <strong className="stat-value">
                  {totalCommission > 0 ? formatCompactIDR(totalCommission) : "—"}
                </strong>
                <span className="stat-note">{plans.length} PO dengan komisi</span>
              </div>
            </div>
            <div className="stat">
              <span className="stat-icon tone-blue">
                <TrendIcon size={18} />
              </span>
              <div>
                <span className="stat-label">Sedang berjalan</span>
                <strong className="stat-value">{runningCount}</strong>
                <span className="stat-note">Masa komisi yang aktif</span>
              </div>
            </div>
            <div className="stat">
              <span className="stat-icon tone-amber">
                <CalendarIcon size={18} />
              </span>
              <div>
                <span className="stat-label">Belum dijadwalkan</span>
                <strong className="stat-value">{unsetCount}</strong>
                <span className="stat-note">Isi tanggal mulai komisi</span>
              </div>
            </div>
          </div>

          <p className="commission-note">
            Komisi 10% dihitung dari besaran PO sebelum PPN. Lama kontrak menentukan
            berapa lama komisi diterima; bila lama kontrak tidak diisi, komisi 10%
            diterima 1 kali.
          </p>

          {poWithoutValue > 0 ? (
            <p className="commission-note commission-note-warn">
              {poWithoutValue} PO belum punya nilai komisi. Lengkapi lewat tombol
              “Lengkapi nilai PO” di detail perusahaan.
            </p>
          ) : null}

          {plans.length === 0 ? (
            <div className="mini-empty">
              <p>
                Belum ada komisi. Unggah PO beserta besaran dan lama kontraknya untuk
                melihat laporan di sini.
              </p>
            </div>
          ) : (
            <div className="commission-list">
              {plans.map((plan) => (
                <CommissionCard
                  key={plan.quote.id}
                  plan={plan}
                  onCommissionStart={onCommissionStart}
                />
              ))}
            </div>
          )}
        </div>
      ) : view === "po-pin" ? (
        <div className="po-pin-settings">
          <button
            type="button"
            className="link-btn commission-back"
            onClick={() => setView("profile")}
          >
            <ArrowLeftIcon size={14} /> Kembali ke profil
          </button>

          <div className={`po-pin-status ${poPin ? "is-active" : ""}`}>
            <span className="po-pin-status-icon">
              {poPin ? <LockIcon size={18} /> : <KeyIcon size={18} />}
            </span>
            <div>
              <strong>{poPin ? "PIN Password PO aktif" : "PIN Password PO belum dibuat"}</strong>
              <span>
                {poPin
                  ? "Komisi PO hanya terbuka setelah PIN 6 digit dimasukkan."
                  : "Buat PIN agar jumlah komisi tidak terlihat oleh orang lain."}
              </span>
            </div>
          </div>

          <div className="po-pin-actions">
            <button
              type="button"
              className="po-pin-action"
              onClick={() => onOpenPoPin(poPin ? "change" : "setup")}
            >
              <KeyIcon size={17} />
              <div>
                <strong>Change PIN Password PO</strong>
                <span>Masukkan PIN lama, lalu tentukan PIN baru.</span>
              </div>
            </button>
            <button
              type="button"
              className="po-pin-action"
              onClick={() => onOpenPoPin("forgot")}
            >
              <MailIcon size={17} />
              <div>
                <strong>Forgot PIN Password PO</strong>
                <span>Pulihkan akses dengan e-mail yang tersimpan di profil.</span>
              </div>
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="profile-identity">
            <span className="profile-avatar">
              {user.picture ? (
                <img src={user.picture} alt="" referrerPolicy="no-referrer" />
              ) : (
                initial
              )}
            </span>
            <div>
              <strong>{displayName}</strong>
              <span>{user.email || "Email akun tidak tersedia"}</span>
            </div>
          </div>

          <div className="form-grid">
            <div className="field field-full">
              <label htmlFor="profile-username">
                Username <span className="required-mark">*</span>
              </label>
              <input
                id="profile-username"
                value={username}
                maxLength={40}
                autoFocus
                placeholder="mis. Pane"
                onChange={(event) => {
                  setUsername(event.target.value);
                  setError("");
                }}
              />
              <span className="field-hint">
                Sapaan di aplikasi menjadi “Hallo {username.trim() || "Pane"}”.
              </span>
            </div>

            <div className="field field-full">
              <label htmlFor="profile-account-email">Alamat email akun</label>
              <div className="input-readonly">
                <MailIcon size={15} />
                <input
                  id="profile-account-email"
                  value={user.email || ""}
                  placeholder="Tidak tersedia"
                  readOnly
                />
              </div>
              <span className="field-hint">Mengikuti akun Freebuff dan tidak bisa diubah di sini.</span>
            </div>

            <div className="field field-full">
              <label htmlFor="profile-phone">Nomor WhatsApp atau Telegram</label>
              <div className="input-icon">
                <PhoneIcon size={15} />
                <input
                  id="profile-phone"
                  value={phone}
                  maxLength={40}
                  placeholder="0812 3456 7890 atau @namatelegram"
                  onChange={(event) => setPhone(event.target.value)}
                />
              </div>
            </div>

            <div className="field field-full">
              <label htmlFor="profile-email">Alamat e-mail</label>
              <div className="input-icon">
                <MailIcon size={15} />
                <input
                  id="profile-email"
                  type="email"
                  value={email}
                  maxLength={120}
                  placeholder="nama@perusahaan.com"
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setError("");
                  }}
                />
              </div>
              <span className="field-hint">E-mail kontak untuk korespondensi penawaran dan PO.</span>
            </div>
          </div>

          <div className="profile-pin">
            <div className="profile-pin-head">
              <LockIcon size={15} />
              <strong>Password PO</strong>
            </div>
            <p>
              {poPin
                ? "PIN aktif. Ubah atau pulihkan PIN lewat menu Password PO."
                : "Belum ada PIN. Buat PIN agar jumlah komisi PO terkunci."}
            </p>
            <button
              type="button"
              className="btn btn-secondary profile-pin-btn"
              onClick={() => setView("po-pin")}
            >
              <LockIcon size={15} /> Password PO
            </button>
          </div>

          <div className="profile-pin">
            <div className="profile-pin-head">
              <SparkIcon size={15} />
              <strong>Robot AI</strong>
            </div>
            <p>
              Pantau Finding, Klarifikasi, Publish, hasil lead, dan notifikasi Telegram.
            </p>
            <button
              type="button"
              className="btn btn-primary profile-pin-btn"
              onClick={() => {
                onClose();
                onOpenRobot();
              }}
            >
              <SparkIcon size={15} /> Robot AI
            </button>
          </div>

          <div className="profile-commission">
            <div className="profile-commission-head">
              <TrendIcon size={15} />
              <strong>Laporan komisi</strong>
            </div>
            <div className="profile-commission-total">
              <span>Total komisi dari {plans.length} PO</span>
              <strong>
                {totalCommission > 0
                  ? commissionUnlocked
                    ? formatIDR(totalCommission)
                    : "••••••"
                  : "Belum ada komisi"}
              </strong>
            </div>
            <p>
              {totalCommission > 0
                ? !commissionUnlocked
                  ? "Klik Komisi lalu masukkan PIN untuk membuka laporan."
                  : unsetCount > 0
                    ? `${unsetCount} PO belum diatur tanggal mulai komisinya.`
                    : "Semua PO sudah punya tanggal mulai komisi."
                : "Komisi muncul otomatis setelah nilai PO diisi pada unggahan PO."}
            </p>
            <button
              type="button"
              className="btn btn-secondary profile-commission-btn"
              onClick={openCommission}
            >
              <TrendIcon size={15} /> Komisi
            </button>
          </div>
        </>
      )}

      {view === "profile" && error ? <p className="form-error">{error}</p> : null}
    </Modal>
  );
}
