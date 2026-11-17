import {
  coordinateReviewStatus,
  isApproximateCoordinate,
  websiteHost,
  type CorporateLead,
} from "../lib/corporate";
import { Modal } from "./Dialogs";
import LocationMap from "./LocationMap";
import {
  CheckIcon,
  GlobeIcon,
  MailIcon,
  PhoneIcon,
  SparkIcon,
  UsersIcon,
} from "./icons";

interface Props {
  lead: CorporateLead | null;
  searching: boolean;
  error: string;
  agentEvidence?: string[];
  visitLabel?: string;
  onClose: () => void;
  onVisit: () => void;
}

export default function CorporateLeadDialog({
  lead,
  searching,
  error,
  agentEvidence = [],
  visitLabel = "Masuk Prospek",
  onClose,
  onVisit,
}: Props) {
  const hasContact = Boolean(lead?.email || lead?.phone || lead?.contactName);
  const approximateCoordinate = Boolean(lead && isApproximateCoordinate(lead));
  const coordinateStatus = lead ? coordinateReviewStatus(lead) : "missing";

  return (
    <Modal
      open={Boolean(lead)}
      onClose={onClose}
      title={lead?.name ?? ""}
      subtitle="Kontak perusahaan"
      width={540}
      footer={
        lead ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Tutup
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={onVisit}
              disabled={approximateCoordinate}
              style={
                approximateCoordinate
                  ? { opacity: 0.55, cursor: "not-allowed" }
                  : undefined
              }
              title={
                approximateCoordinate
                  ? "Koordinat masih perkiraan wilayah. Lead belum bisa masuk Prospek sampai koordinat entitas tervalidasi."
                  : "Masukkan perusahaan ini ke Prospek meskipun informasinya belum lengkap"
              }
            >
              <CheckIcon size={15} /> {visitLabel}
            </button>
          </>
        ) : null
      }
    >
      {lead ? (
        <div className="lead-detail">
          {approximateCoordinate ? (
            <p className="robot-note">
              Koordinat yang tersedia masih pusat wilayah, bukan koordinat entitas.
              Lead ini belum dapat masuk Prospek sampai koordinat asli atau koordinat
              yang tervalidasi wilayah tersedia.
            </p>
          ) : null}

          {coordinateStatus === "review" ? (
            <p className="robot-note">
              Titik ini berasal dari pencarian alamat dan belum tentu lokasi entitas.
              Setelah masuk Prospek, buka <strong>Edit data perusahaan</strong> dan
              masukkan koordinat yang benar dari Google Maps. Lead dengan titik
              berstatus perlu dicek tidak akan dikirim ke Telegram.
            </p>
          ) : null}
          <div className="lead-detail-row">
            <span className="lead-detail-icon">
              <GlobeIcon size={17} />
            </span>
            <div>
              <span>Alamat website</span>
              {lead.website ? (
                <a href={lead.website} target="_blank" rel="noreferrer">
                  {websiteHost(lead.website)}
                </a>
              ) : (
                <strong className="muted">Belum tercatat</strong>
              )}
            </div>
          </div>

          <div className="lead-detail-row">
            <span className="lead-detail-icon">
              <UsersIcon size={17} />
            </span>
            <div>
              <span>Kontak IT</span>
              {lead.contactName ? (
                <>
                  <strong>{lead.contactName}</strong>
                  {lead.contactRole ? (
                    <span className="lead-contact-role">{lead.contactRole}</span>
                  ) : null}
                  {lead.contactSource ? (
                    <span className="lead-contact-source">
                      {lead.contactSource}
                      {lead.contactUrl ? (
                        <>
                          {" · "}
                          <a href={lead.contactUrl} target="_blank" rel="noreferrer">
                            Lihat sumber
                          </a>
                        </>
                      ) : null}
                    </span>
                  ) : null}
                </>
              ) : (
                <strong className="muted">Belum ditemukan</strong>
              )}
            </div>
          </div>

          <div className="lead-detail-row">
            <span className="lead-detail-icon">
              <MailIcon size={17} />
            </span>
            <div>
              <span>Alamat e-mail</span>
              {lead.email ? (
                <a href={`mailto:${lead.email}`}>{lead.email}</a>
              ) : (
                <strong className="muted">Belum ditemukan</strong>
              )}
            </div>
          </div>

          <div className="lead-detail-row">
            <span className="lead-detail-icon">
              <PhoneIcon size={17} />
            </span>
            <div>
              <span>Nomor PIC</span>
              {lead.phone ? (
                <strong className="mono lead-detail-phone">{lead.phone}</strong>
              ) : (
                <strong className="muted">Belum ditemukan</strong>
              )}
            </div>
          </div>

          <LocationMap
            latitude={lead.latitude}
            longitude={lead.longitude}
            address={lead.coordinateAddress}
            source={lead.coordinateSource}
          />

          {agentEvidence.length > 0 ? (
            <div className="lead-agent-trace">
              <strong>Jejak 3 agen Finding</strong>
              <ul>
                {agentEvidence.map((item, index) => (
                  <li key={`${index}-${item.slice(0, 24)}`}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {lead.validationEvidence?.length ? (
            <div className="lead-agent-trace">
              <strong>Jejak agen Klarifikasi</strong>
              <ul>
                {lead.validationEvidence.slice(0, 8).map((item, index) => (
                  <li key={`${index}-${item.slice(0, 24)}`}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {lead.validationStatus === "verified" ? (
            <div className="lead-validation-ok">
              <CheckIcon size={15} /> Website, e-mail PIC, telepon PIC, dan koordinat
              sudah tervalidasi.
              {lead.aiConfidence ? ` Keyakinan panel AI ${lead.aiConfidence}/100.` : ""}
            </div>
          ) : null}

          <p className="lead-sync-warning">
            Anda tetap dapat memasukkan lead ini ke Prospek secara manual. Data yang
            belum terverifikasi akan disimpan apa adanya dan dapat dilengkapi nanti.
          </p>

          {searching ? (
            <div className="lead-search-status" role="status">
              <span className="spinner" />
              <p>
                Robot sedang menelusuri website, halaman tim, data terstruktur, LinkedIn,
                dan sumber publik untuk menemukan nama serta jabatan kontak IT.
              </p>
            </div>
          ) : null}

          {error ? (
            <p className="lead-search-error" role="alert">
              {error}
            </p>
          ) : null}

          {!searching && !hasContact ? (
            <p className="lead-search-hint">
              <SparkIcon size={14} /> Kontak IT belum terbaca dari website maupun sumber
              publik. Anda tetap dapat memasukkannya ke Prospek lalu melengkapi
              kontaknya secara manual.
            </p>
          ) : null}

          {!searching && hasContact && !lead.phone ? (
            <p className="lead-search-hint">
              <SparkIcon size={14} /> E-mail sudah ditemukan; nomor PIC belum tertera di
              sumber publik. Lengkapi nomor PIC secara manual di Prospek bila diperlukan.
            </p>
          ) : null}

          {!searching && !lead.website ? (
            <p className="lead-search-hint">
              <SparkIcon size={14} /> Website belum tercatat. Robot tetap mencari kontak
              IT dari LinkedIn dan sumber publik lain bila pencarian web aktif.
            </p>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
