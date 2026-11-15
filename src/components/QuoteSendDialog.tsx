import { useEffect, useState } from "react";
import type { Company, Profile, StoredFile } from "../types";
import { Modal } from "./Dialogs";
import {
  ArrowLeftIcon,
  CalendarIcon,
  CheckIcon,
  FileIcon,
  MailIcon,
  WhatsappIcon,
} from "./icons";
import { pdfUrl } from "../lib/api";
import { formatFileSize, formatShortDate } from "../lib/data";
import {
  isValidEmail,
  isValidWhatsApp,
  mailtoUrl,
  normalizeWhatsApp,
  quoteFilename,
  quoteMessage,
  quoteSubject,
  whatsappUrl,
  type SendChannel,
} from "../lib/send";

export interface UploadedQuoteInfo {
  companyId: string;
  number: string;
  date: string;
  quoteFile: StoredFile;
}

interface Props {
  open: boolean;
  company: Company | null;
  quote: UploadedQuoteInfo | null;
  profile: Profile;
  senderName: string;
  onClose: () => void;
}

type ShareNavigator = Navigator & {
  canShare?: (data: { files?: File[] }) => boolean;
  share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
};

function triggerDownload(quote: UploadedQuoteInfo) {
  const anchor = document.createElement("a");
  anchor.href = pdfUrl(quote.quoteFile.id);
  anchor.download = quoteFilename(quote.number);
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/** Buka tab baru dan laporkan bila browser memblokir popup. */
function openExternal(url: string, newTab: boolean): boolean {
  if (newTab) {
    const opened = window.open(url, "_blank");
    if (!opened) return false;
    opened.opener = null;
    return true;
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return true;
}

export default function QuoteSendDialog({
  open,
  company,
  quote,
  profile,
  senderName,
  onClose,
}: Props) {
  const [step, setStep] = useState<"preview" | "send">("preview");
  const [channel, setChannel] = useState<SendChannel>("whatsapp");
  const [waPhone, setWaPhone] = useState("");
  const [emailAddress, setEmailAddress] = useState("");
  const [notice, setNotice] = useState("");
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep("preview");
    setChannel("whatsapp");
    setWaPhone(company?.picPhone ?? "");
    setEmailAddress(company?.email ?? "");
    setNotice("");
    const nav = navigator as ShareNavigator;
    setCanShare(typeof nav.canShare === "function" && typeof nav.share === "function");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, company?.id, quote?.quoteFile.id]);

  if (!quote || !company) return null;

  const message = quoteMessage({
    channel,
    companyName: company.name,
    quoteNumber: quote.number,
    senderName,
    profile,
  });
  const subject = quoteSubject(company.name, quote.number);
  const waNumber = normalizeWhatsApp(waPhone);
  const waReady = isValidWhatsApp(waPhone);
  const emailReady = isValidEmail(emailAddress);
  const profileIncomplete = !profile.phone.trim() || !profile.email.trim();

  const sendWhatsApp = () => {
    if (!waReady) {
      setNotice("Nomor WhatsApp PIC belum valid. Isi nomor HP/WhatsApp PIC terlebih dahulu.");
      return;
    }

    // Utamakan nomor PIC: buka chat langsung ke nomor tersebut dengan pesan
    // yang sudah terisi, lalu unduh PDF untuk dilampirkan. Web Share tidak
    // dipakai di sini karena tidak bisa memilih nomor PIC secara otomatis.
    const opened = openExternal(whatsappUrl(waPhone, message), true);
    triggerDownload(quote);
    setNotice(
      opened
        ? `WhatsApp dibuka ke nomor ${waNumber} dengan pesan terisi. PDF sudah diunduh; lampirkan PDF tersebut pada chat PIC.`
        : `Popup diblokir. PDF sudah diunduh; izinkan popup atau buka chat WhatsApp ke nomor ${waNumber} secara manual.`,
    );
  };

  const sendEmail = () => {
    if (!emailReady) {
      setNotice("Alamat e-mail PIC belum valid. Isi alamat e-mail PIC terlebih dahulu.");
      return;
    }
    triggerDownload(quote);
    openExternal(mailtoUrl(emailAddress, subject, message), false);
    setNotice(
      "PDF diunduh dan draf e-mail sudah dibuka. Lampirkan PDF tersebut sebelum menekan kirim di aplikasi e-mail Anda.",
    );
  };

  const sharePdf = async () => {
    const nav = navigator as ShareNavigator;
    try {
      const response = await fetch(pdfUrl(quote.quoteFile.id), { credentials: "same-origin" });
      if (!response.ok) {
        setNotice("PDF tidak bisa diambil. Coba lagi.");
        return;
      }
      const blob = await response.blob();
      const file = new File([blob], quoteFilename(quote.number), { type: "application/pdf" });
      if (!nav.canShare?.({ files: [file] }) || !nav.share) {
        setNotice("Browser ini belum mendukung bagikan lampiran. Gunakan tombol WhatsApp atau e-mail.");
        return;
      }
      await nav.share({
        files: [file],
        title: `Penawaran ${quote.number}`,
        text: message,
      });
      setNotice("PDF penawaran sudah dibagikan beserta pesannya.");
    } catch (error) {
      if ((error as DOMException | undefined)?.name !== "AbortError") {
        setNotice("PDF gagal dibagikan. Gunakan tombol WhatsApp atau e-mail.");
      }
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={step === "preview" ? "Penawaran siap dikirim" : "Kirim penawaran"}
      subtitle={`${company.name} · ${quote.number}`}
      width={760}
      footer={
        step === "preview" ? (
          <>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Tutup
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setStep("send")}>
              Kirim
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setStep("preview");
                setNotice("");
              }}
            >
              <ArrowLeftIcon size={15} /> Kembali
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                if (channel === "whatsapp") void sendWhatsApp();
                else sendEmail();
              }}
            >
              {channel === "whatsapp" ? (
                <>
                  <WhatsappIcon size={15} /> Buka WhatsApp
                </>
              ) : (
                <>
                  <MailIcon size={15} /> Buka e-mail
                </>
              )}
            </button>
          </>
        )
      }
    >
      {step === "preview" ? (
        <div className="send-preview">
          <div className="send-file">
            <span className="send-file-icon">
              <FileIcon size={17} />
            </span>
            <div className="send-file-main">
              <strong>{quote.quoteFile.name}</strong>
              <span>
                {formatFileSize(quote.quoteFile.size)} · PDF ·{" "}
                {formatShortDate(quote.date)}
              </span>
            </div>
            <a
              className="link-btn"
              href={pdfUrl(quote.quoteFile.id)}
              target="_blank"
              rel="noreferrer"
            >
              Buka PDF
            </a>
          </div>

          <div className="send-meta">
            <span className="chip">
              <FileIcon size={12} /> {quote.number}
            </span>
            <span className="chip">
              <CalendarIcon size={12} /> {formatShortDate(quote.date)}
            </span>
            <span className="chip">Penerima: {company.name}</span>
          </div>

          <iframe
            className="send-frame"
            src={pdfUrl(quote.quoteFile.id)}
            title={`Pratinjau penawaran ${quote.number}`}
          />

          <p className="field-hint">
            Periksa isi penawaran terlebih dahulu. Setelah yakin, tekan{" "}
            <strong>Kirim</strong> untuk memilih WhatsApp atau e-mail.
          </p>
        </div>
      ) : (
        <div className="send-panel">
          <div className="send-channel-switch" role="tablist" aria-label="Pilih cara mengirim">
            <button
              type="button"
              role="tab"
              aria-selected={channel === "whatsapp"}
              className={channel === "whatsapp" ? "active" : ""}
              onClick={() => {
                setChannel("whatsapp");
                setNotice("");
              }}
            >
              <WhatsappIcon size={15} /> WhatsApp
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={channel === "email"}
              className={channel === "email" ? "active" : ""}
              onClick={() => {
                setChannel("email");
                setNotice("");
              }}
            >
              <MailIcon size={15} /> E-mail
            </button>
          </div>

          {channel === "whatsapp" ? (
            <div className="field">
              <label htmlFor="send-wa">Nomor WhatsApp PIC</label>
              <input
                id="send-wa"
                inputMode="tel"
                value={waPhone}
                placeholder="mis. 0812 3456 7890"
                onChange={(event) => {
                  setWaPhone(event.target.value);
                  setNotice("");
                }}
              />
              <span className="field-hint">
                {waReady
                  ? `Chat akan dibuka ke +${waNumber}.`
                  : "Isi nomor WhatsApp PIC perusahaan supaya chat langsung terbuka."}
              </span>
            </div>
          ) : (
            <div className="field">
              <label htmlFor="send-email">E-mail PIC</label>
              <input
                id="send-email"
                inputMode="email"
                value={emailAddress}
                placeholder="mis. pic@perusahaan.co.id"
                onChange={(event) => {
                  setEmailAddress(event.target.value);
                  setNotice("");
                }}
              />
              <span className="field-hint">
                {emailReady
                  ? `Draf akan ditujukan ke ${emailAddress.trim()}.`
                  : "Isi alamat e-mail PIC perusahaan supaya draf langsung terisi."}
              </span>
            </div>
          )}

          <div className="send-message">
            <div className="send-message-head">
              <span>{channel === "whatsapp" ? "Pesan WhatsApp" : "Isi e-mail"}</span>
              {channel === "email" ? <strong>{subject}</strong> : null}
            </div>
            <pre>{message}</pre>
          </div>

                      <p className="send-note">
            <strong>Buka WhatsApp</strong> membuka chat langsung ke nomor PIC dengan pesan
            terisi, lalu PDF diunduh otomatis. WhatsApp tidak mengizinkan situs web
            melampirkan file ke nomor tertentu, jadi lampirkan PDF dari unduhan. Untuk
            mengirim PDF lewat lembar berbagi, gunakan tombol di bawah lalu pilih WhatsApp
            dan kontak PIC.
          </p>

          {canShare ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void sharePdf()}>
              Bagikan PDF + pesan
            </button>
          ) : null}

          {profileIncomplete ? (
            <p className="send-warn">
              Nomor WhatsApp atau e-mail di profil belum lengkap. Lengkapi profil agar tanda
              tangan pesan berisi kontak Anda.
            </p>
          ) : null}

          {notice ? (
            <div className="send-notice" role="status">
              <CheckIcon size={14} />
              <span>{notice}</span>
            </div>
          ) : null}
        </div>
      )}
    </Modal>
  );
}
