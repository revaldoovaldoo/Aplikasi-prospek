import { useEffect, useState } from "react";
import type { Company } from "../types";
import {
  categoryLabel,
  findCompanyForLead,
  type CorporateLead,
  type CorporateRobotJob,
  type CorporateRobotStatus,
} from "../lib/corporate";
import {
  detectCorporateRobotTelegram,
  fetchCorporateRobot,
  retryCorporateRobotTelegram,
  saveCorporateRobotSettings,
  searchCorporateLead,
  testCorporateRobotTelegram,
} from "../lib/api";
import CorporateLeadDialog from "./CorporateLeadDialog";
import { CheckIcon, SearchIcon, SparkIcon } from "./icons";

function robotTime(value: string | undefined): string {
  if (!value) return "belum pernah";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function robotStageLabel(stage: string): string {
  if (stage === "finding") return "Mencari kebutuhan";
  if (stage === "clarification") return "Klarifikasi kontak";
  if (stage === "publish") return "Siap diterbitkan";
  if (stage === "publish_telegram") return "Siap kirim Telegram";
  if (stage === "publish_prospect") return "Siap masuk Prospek";
  if (stage === "done") return "Terbit";
  return "Menunggu";
}

function robotContactLabel(job: CorporateRobotJob): string {
  if (job.contactStatus === "verified") return "Terverifikasi publik";
  if (job.contactStatus === "partial") return "Perlu dicek";
  if (job.contactStatus === "missing") return "Belum ada kontak";
  return robotStageLabel(job.stage);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Terjadi kesalahan.";
}

function RobotJobRow({
  job,
  onOpenLead,
}: {
  job: CorporateRobotJob;
  onOpenLead: (lead: CorporateLead, evidence?: string[]) => void;
}) {
  const lead = job.lead;
  return (
    <button
      type="button"
      className="robot-job"
      onClick={() => onOpenLead(lead, job.needEvidence)}
      title={job.lastError || "Buka detail lead dan jejak agen"}
    >
      <span
        className={`robot-score ${
          job.needScore >= 58 ? "high" : job.needScore >= 42 ? "mid" : "low"
        }`}
      >
        {job.needScore}
      </span>
      <span className="robot-job-main">
        <strong>{lead.name}</strong>
        <small>
          {categoryLabel(lead.category)} · {lead.area ? `${lead.area}, ` : ""}
          {lead.city} · {robotStageLabel(job.stage)}
        </small>
      </span>
      <span className="robot-job-contact">
        {lead.contactName || lead.email || "Kontak belum ada"}
      </span>
      <span className={`robot-pill ${job.contactStatus}`}>
        {robotContactLabel(job)}
      </span>
    </button>
  );
}

interface RobotPanelProps {
  companies: Company[];
  status: CorporateRobotStatus | null;
  loading: boolean;
  busy: string;
  error: string;
  notice: string;
  chatId: string;
  onChatIdChange: (value: string) => void;
  onSaveChatId: () => void;
  onDetectChatId: () => void;
  onTestTelegram: () => void;
  onRetryTelegram: () => void;
  onOpenLead: (lead: CorporateLead, evidence?: string[]) => void;
}

function RobotPanel({
  companies,
  status,
  loading,
  busy,
  error,
  notice,
  chatId,
  onChatIdChange,
  onSaveChatId,
  onDetectChatId,
  onTestTelegram,
  onRetryTelegram,
  onOpenLead,
}: RobotPanelProps) {
  const stats = status?.stats;
  const allJobs = status?.jobs ?? [];
  // Lead yang sudah masuk Prospek tidak perlu memenuhi daftar pekerjaan robot.
  const jobs = allJobs.filter((job) => !findCompanyForLead(job.lead, companies));
  const hiddenJobCount = allJobs.length - jobs.length;
  const jobTeams = [
    {
      key: "finding",
      label: "Finding",
      empty: "Belum ada perusahaan yang sedang diproses Finding.",
      jobs: jobs.filter((job) => job.stage === "finding"),
    },
    {
      key: "clarification",
      label: "Klarifikasi",
      empty: "Belum ada perusahaan yang sedang diproses Klarifikasi.",
      jobs: jobs.filter(
        (job) => job.stage === "clarification" || job.stage === "paused",
      ),
    },
    {
      key: "publish",
      label: "Publish",
      empty: "Belum ada perusahaan yang sedang diproses Publish.",
      jobs: jobs.filter(
        (job) =>
          job.stage === "publish" ||
          job.stage === "publish_telegram" ||
          job.stage === "publish_prospect",
      ),
    },
  ];
  const enabled = Boolean(status?.enabled);
  const activeCount =
    stats?.active ??
    (stats?.finding ?? 0) + (stats?.clarification ?? 0) + (stats?.publish ?? 0);

  return (
    <section className={`panel robot-panel ${enabled ? "robot-on" : ""}`}>
      <div className="robot-head">
        <div className="robot-title">
          <span className="robot-orbit">
            <SparkIcon size={19} />
          </span>
          <div>
            <p className="eyebrow">Autopilot Corporate</p>
            <h2>
              Robot 24/7{" "}
              <span className={`robot-live ${enabled ? "on" : ""}`}>
                {enabled ? "AKTIF" : "DIJEDA"}
              </span>
            </h2>
            <p>
              Finding → Klarifikasi → Validasi → Publish. Robot berjalan sendiri
              setiap 15 menit tanpa perlu membuka halaman atau menekan tombol.
            </p>
          </div>
        </div>
        <div className="robot-actions robot-actions-auto">
          <span className="robot-auto-badge">
            <CheckIcon size={14} /> Otomatis 24/7
          </span>
        </div>
      </div>

      <div className="robot-leader">
        <span className="robot-leader-badge">AI Leader</span>
        <div>
          <strong>AI Leader memantau Finding, Klarifikasi, dan Publish</strong>
          <span>
            Tanyakan progress tim, jumlah prospek, atau status penawaran lewat
            pesan Telegram ke bot ini. Ketik <code>kirim ulang pesan macet</code>{" "}
            untuk mengirim ulang pesan failed/needs_review yang aman. Pesan
            uncertain tidak disertakan agar tidak terjadi duplikat.
          </span>
        </div>
      </div>

      <div className="robot-results-head">
        <h3>Progress per tim</h3>
        <span className="robot-auto-publish">
          <CheckIcon size={14} /> Finding → Klarifikasi → Publish
        </span>
      </div>
      <div className="robot-stages robot-team-progress">
        <div className="robot-stage">
          <span className="robot-stage-index">1</span>
          <div>
            <strong>Finding · 3 agen</strong>
            <span>
              {stats?.searches ?? 0} pencarian Corporate Engine ·{" "}
              {stats?.finding ?? 0} sedang diproses.
            </span>
          </div>
          <b>{stats?.searches ?? 0}</b>
        </div>
        <div className="robot-stage">
          <span className="robot-stage-index">2</span>
          <div>
            <strong>Klarifikasi · 4 agen</strong>
            <span>
              Scout, Contact Finder, Verifier, OpenOSINT ·{" "}
              {stats?.clarification ?? 0} sedang diklarifikasi.
            </span>
          </div>
          <b>{stats?.clarification ?? 0}</b>
        </div>
        <div className="robot-stage">
          <span className="robot-stage-index">3</span>
          <div>
            <strong>Publish · Telegram</strong>
            <span>
              Kurir Telegram · {stats?.notified ?? 0} terkirim ·{" "}
              {stats?.publishTelegram ?? 0} antre.
            </span>
          </div>
          <b>{stats?.notified ?? 0}</b>
        </div>
        <div className="robot-stage">
          <span className="robot-stage-index">4</span>
          <div>
            <strong>Publish · WhatsApp</strong>
            <span>
              Agen WhatsApp · {stats?.whatsappSent ?? 0} terkirim ·{" "}
              {status?.whatsappOutbox?.pending ?? 0} antre.
            </span>
          </div>
          <b>{stats?.whatsappSent ?? 0}</b>
        </div>
        <div className="robot-stage">
          <span className="robot-stage-index">5</span>
          <div>
            <strong>Publish · Prospek</strong>
            <span>
              Penulis Prospek · {stats?.published ?? 0} masuk ·{" "}
              {stats?.publishProspect ?? 0} antre.
            </span>
          </div>
          <b>{stats?.published ?? 0}</b>
        </div>
      </div>

      <p className="robot-queue-summary">
        <strong>{stats?.total ?? 0}</strong> lead total ·{" "}
        <strong>{activeCount}</strong> masih diproses ·{" "}
        <strong>{stats?.paused ?? 0}</strong> perlu perhatian ·{" "}
        <strong>{stats?.published ?? 0}</strong> sudah terbit
      </p>

      {status?.agents ? (
        <div className="robot-agent-structure">
          {([
            ["finding", "Finding"],
            ["clarification", "Klarifikasi"],
            ["publish", "Publish"],
          ] as const).map(([key, label]) => (
            <div className="robot-agent-group" key={key}>
              <div className="robot-agent-title">
                <strong>{label}</strong>
                <span>{status.agents[key].length} agen</span>
              </div>
              <div className="robot-agent-list">
                {status.agents[key].map((agent) => (
                  <span
                    key={agent.id}
                    className={`robot-agent ${agent.active ? "on" : "off"}`}
                    title={`${agent.role} · ${agent.provider}`}
                  >
                    <b>{agent.name}</b>
                    <small>{agent.draft ? "Draft · " : ""}{agent.provider}</small>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {!status?.exaConfigured ? (
        <p className="robot-note">
          Exa belum aktif. Buat API key di{" "}
          <a
            href="https://dashboard.exa.ai/api-keys"
            target="_blank"
            rel="noreferrer"
          >
            dashboard.exa.ai/api-keys
          </a>
          , lalu simpan sebagai <code>EXA_API_KEY</code> di Sites → Secrets.
        </p>
      ) : null}

      <div className="robot-meta">
        <span className={`robot-chip ${status?.exaConfigured ? "ok" : "warn"}`}>
          <SearchIcon size={13} /> Exa {status?.exaConfigured ? "aktif" : "belum aktif"}
        </span>
        <span className={`robot-chip ${status?.openosintConfigured ? "ok" : "warn"}`}>
          <SearchIcon size={13} /> OpenOSINT{" "}
          {status?.openosintConfigured ? "aktif" : "belum aktif"}
        </span>
        <span className={`robot-chip ${status?.telegramConfigured ? "ok" : "warn"}`}>
          <SparkIcon size={13} /> Telegram{" "}
          {status?.telegramConfigured ? "aktif" : "belum aktif"}
        </span>
        <span className={`robot-chip ${status?.whatsappConfigured ? "ok" : "warn"}`}>
          <SparkIcon size={13} /> WhatsApp{" "}
          {status?.whatsappConfigured ? "aktif" : "belum aktif"}
        </span>
        <span className="robot-chip">
          Auto Prospek {status?.autoPublish ? "aktif" : "nonaktif"}
        </span>
        <span className={`robot-chip ${status?.cronConfigured ? "ok" : "warn"}`}>
          Scheduler {status?.cronConfigured ? "siap" : "belum aktif"}
        </span>
        <span className="robot-chip">
          Terakhir: {loading ? "memuat…" : robotTime(status?.lastRunAt)}
        </span>
        <span className="robot-chip">
          Terbit: {stats?.published ?? 0} · Telegram: {stats?.notified ?? 0}
        </span>
      </div>

      {notice ? (
        <div className="robot-banner" role="status">
          <CheckIcon size={15} /> {notice}
        </div>
      ) : null}
      {error ? (
        <div className="robot-banner robot-banner-error" role="alert">
          {error}
        </div>
      ) : null}
      {(status?.outbox?.attention ?? 0) > 0 ? (
        <div className="robot-banner robot-banner-warning" role="status">
          <span>
            Telegram: {status?.outbox?.failed ?? 0} gagal,{" "}
            {status?.outbox?.uncertain ?? 0} tidak pasti,{" "}
            {status?.outbox?.needsReview ?? 0} perlu dicek.{" "}
            Pesan gagal dicoba ulang otomatis. Pesan tidak pasti tidak dikirim
            ulang otomatis agar tidak dobel; pesan yang aman dapat dikirim ulang
            manual.
          </span>
          {(status?.outbox?.retryable ?? 0) > 0 ? (
            <button
              type="button"
              className="link-btn"
              onClick={onRetryTelegram}
              disabled={busy === "telegram"}
            >
              {busy === "telegram" ? "Mengirim…" : "Kirim ulang"}
            </button>
          ) : null}
        </div>
      ) : null}

      {!status?.telegramConfigured ? (
        <div className="robot-setup">
          <div>
            <strong>Notifikasi Telegram</strong>
            <p>
              Target: {status?.telegramTarget || "+6285156590261"}.{" "}
              {status?.telegramTokenSet
                ? "Token bot sudah terpasang. Kirim /start ke bot Anda, lalu deteksi chat ID."
                : "Token bot belum terpasang. Tanpa token, robot tetap menerbitkan lead ke aplikasi."}
            </p>
            <ol className="robot-steps">
              <li>Buka <strong>@BotFather</strong> di Telegram, kirim <code>/newbot</code>, lalu salin token bot.</li>
              <li>Simpan token itu di <strong>Sites → Secrets</strong> sebagai <code>TELEGRAM_BOT_TOKEN</code>.</li>
              <li>Buka bot baru Anda, tekan <strong>Start</strong> atau kirim <code>/start</code>, lalu tekan <strong>Deteksi chat ID</strong>.</li>
            </ol>
          </div>
          <div className="robot-setup-row">
            <input
              className="robot-chat-input"
              value={chatId}
              onChange={(event) => onChatIdChange(event.target.value)}
              placeholder="Chat ID Telegram"
              aria-label="Chat ID Telegram"
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onSaveChatId}
              disabled={!chatId.trim() || busy === "telegram"}
            >
              Simpan
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onDetectChatId}
              disabled={busy === "telegram" || !status?.telegramTokenSet}
            >
              {busy === "telegram" ? "Memeriksa…" : "Deteksi chat ID"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onTestTelegram}
              disabled={busy === "telegram" || !status?.telegramChatIdSet}
            >
              {busy === "telegram" ? "Mengirim…" : "Tes"}
            </button>
          </div>
        </div>
      ) : (
        <div className="robot-setup robot-setup-ok">
          <CheckIcon size={15} />
          <span>
            Telegram aktif. Chat ID sudah tersimpan.{" "}
            <button
              type="button"
              className="link-btn"
              onClick={onTestTelegram}
              disabled={busy === "telegram"}
            >
              {busy === "telegram" ? "Mengirim…" : "Kirim tes"}
            </button>
            {" · "}
            <button
              type="button"
              className="link-btn"
              onClick={onDetectChatId}
              disabled={busy === "telegram" || !status.telegramTokenSet}
            >
              {busy === "telegram" ? "Memeriksa…" : "Deteksi ulang"}
            </button>
          </span>
        </div>
      )}

      {!status?.whatsappConfigured ? (
        <div className="robot-note">
          Agen WhatsApp belum aktif. Isi <code>WHATSAPP_ACCESS_TOKEN</code>,{" "}
          <code>WHATSAPP_PHONE_NUMBER_ID</code>, <code>WHATSAPP_OUTREACH_TEMPLATE</code>,{" "}
          <code>WHATSAPP_OUTREACH_LANGUAGE=id</code>, dan{" "}
          <code>WHATSAPP_OUTREACH_ENABLED=true</code> di Sites → Secrets. Template
          harus disetujui Meta dengan body <code>{"{{1}}"}</code> nama PIC dan{" "}
          <code>{"{{2}}"}</code> nama perusahaan/sekolah/hotel.
        </div>
      ) : null}

      <div className="robot-setup robot-setup-ok">
        <CheckIcon size={15} />
        <span>
          Scheduler 24/7 aktif melalui GitHub Actions OIDC. Robot berjalan setiap 15
          menit tanpa membuka halaman ini. Tidak ada tombol jeda atau jalankan manual.
        </span>
      </div>

      <div className="robot-results-head">
        <h3>Pekerjaan robot</h3>
        <span className="robot-auto-publish">
          <CheckIcon size={14} /> Nama perusahaan/sekolah/hotel per tim
        </span>
      </div>

      {jobs.length === 0 ? (
        <div className="robot-empty">
          <SparkIcon size={16} />
          <span>
            {hiddenJobCount > 0
              ? "Semua lead di daftar ini sudah masuk Prospek. Robot tetap memproses antrean berikutnya secara otomatis."
              : "Robot akan memproses antrean otomatis pada jadwal berikutnya. Tidak perlu menekan tombol apa pun."}
          </span>
        </div>
      ) : (
        <div className="robot-job-teams">
          {jobTeams.map((team) => (
            <section className={`robot-job-team robot-job-team-${team.key}`} key={team.key}>
              <div className="robot-job-team-head">
                <h4>{team.label}</h4>
                <span>{team.jobs.length} nama</span>
              </div>
              {team.jobs.length === 0 ? (
                <p className="robot-job-team-empty">{team.empty}</p>
              ) : (
                <div className="robot-jobs robot-jobs-team">
                  {team.jobs.map((job) => (
                    <RobotJobRow
                      key={job.lead.id}
                      job={job}
                      onOpenLead={onOpenLead}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      <p className="robot-note">
        Struktur 10 agen: 3 Finding memakai website publik gratis dan Exa Search;
        4 Klarifikasi memakai Exa Scout, Contact Finder, Verifier, serta OpenOSINT pasif
        untuk DNS/RDAP domain; 3 Publish bekerja terpisah — Kurir Telegram mengirim pesan,
        Agen WhatsApp menghubungi PIC, Penulis Prospek menulis daftar Prospek. Telegram hanya mewajibkan nama PIC dan
        minimal satu nomor PIC valid; hingga dua nomor (kontak perusahaan dan nomor PIC)
        ditampilkan pada baris Nomor PIC. E-mail atau website yang kosong memakai
        placeholder. Koordinat selalu diisi dari titik entitas; bila belum ditemukan,
        dipakai pusat wilayah lead. Lead baru masuk Prospek jika nama PIC,
        nomor PIC, website resmi, e-mail PIC, dan koordinat cocok dengan sumber publik.
        Telegram dikirim satu kali setelah Klarifikasi menerima lead, tanpa perlu membuka
        aplikasi. Isinya selalu tujuh baris lengkap. Lead yang sudah masuk Prospek tidak
        ditampilkan lagi di daftar ini. Robot tidak mengakses CCTV, kamera, akun sosial media
        pribadi, atau area berlogin.
      </p>
    </section>
  );
}

interface Props {
  companies: Company[];
  onVisitLead: (lead: CorporateLead, manual?: boolean) => string | null;
  onOpenCompany: (id: string) => void;
  onOpenProfile: () => void;
}

export default function RobotPage({
  companies,
  onVisitLead,
  onOpenCompany,
  onOpenProfile,
}: Props) {
  const [status, setStatus] = useState<CorporateRobotStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [chatId, setChatId] = useState("");
  const [selected, setSelected] = useState<CorporateLead | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<string[]>([]);
  const [leadSearching, setLeadSearching] = useState(false);
  const [leadError, setLeadError] = useState("");

  async function loadRobot() {
    try {
      const next = await fetchCorporateRobot();
      setStatus(next);
      setError("");
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRobot();
    const timer = window.setInterval(() => {
      if (!document.hidden) void loadRobot();
    }, 60_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveRobotChatId() {
    if (!chatId.trim()) return;
    setBusy("telegram");
    setError("");
    try {
      const next = await saveCorporateRobotSettings({
        telegramChatId: chatId.trim(),
      });
      setStatus(next);
      setChatId("");
      setNotice("Chat ID Telegram disimpan.");
    } catch (settingsError) {
      setError(errorMessage(settingsError));
    } finally {
      setBusy("");
    }
  }

  async function detectRobotChatId() {
    setBusy("telegram");
    setError("");
    setNotice("");
    try {
      const result = await detectCorporateRobotTelegram();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      await loadRobot();
      setNotice(result.message);
    } catch (detectError) {
      setError(errorMessage(detectError));
    } finally {
      setBusy("");
    }
  }

  async function testRobotTelegram() {
    setBusy("telegram");
    setError("");
    try {
      const result = await testCorporateRobotTelegram();
      if (result.ok) setNotice(result.message);
      else setError(result.message);
    } catch (telegramError) {
      setError(errorMessage(telegramError));
    } finally {
      setBusy("");
    }
  }

  async function retryRobotTelegram() {
    setBusy("telegram");
    setError("");
    setNotice("");
    try {
      const result = await retryCorporateRobotTelegram();
      if (result.ok) setNotice(result.message);
      else setError(result.message);
      await loadRobot();
    } catch (telegramError) {
      setError(errorMessage(telegramError));
    } finally {
      setBusy("");
    }
  }

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
    } catch (searchError) {
      setLeadError(errorMessage(searchError));
    } finally {
      setLeadSearching(false);
    }
  }

  const openLead = (lead: CorporateLead, evidence: string[] = []) => {
    setSelected(lead);
    setSelectedEvidence(evidence);
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
        : `${selected.name} gagal masuk Prospek. Coba lagi.`,
    );
    setSelected(null);
    if (id) onOpenCompany(id);
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="eyebrow">Profil · Autopilot</p>
          <h1>Robot AI</h1>
          <p className="page-sub">
            Pantau pekerjaan Finding, Klarifikasi, Validasi, dan Publish. Robot berjalan
            otomatis 24/7, menyimpan hanya lead yang tervalidasi ke Prospek, dan
            mengirim lokasi serta kontak PIC ke Telegram.
          </p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn btn-secondary" onClick={onOpenProfile}>
            Profil
          </button>
        </div>
      </header>

              <RobotPanel
          companies={companies}
          status={status}
        loading={loading}
        busy={busy}
        error={error}
        notice={notice}
        chatId={chatId}
        onChatIdChange={setChatId}
        onSaveChatId={() => void saveRobotChatId()}
        onDetectChatId={() => void detectRobotChatId()}
        onTestTelegram={() => void testRobotTelegram()}
        onRetryTelegram={() => void retryRobotTelegram()}
        onOpenLead={openLead}
      />

      <CorporateLeadDialog
        lead={selected}
        searching={leadSearching}
        error={leadError}
        agentEvidence={selectedEvidence}
        visitLabel="Masuk Prospek"
        onClose={() => {
          setSelected(null);
          setSelectedEvidence([]);
        }}
        onVisit={visitSelected}
      />
    </div>
  );
}
