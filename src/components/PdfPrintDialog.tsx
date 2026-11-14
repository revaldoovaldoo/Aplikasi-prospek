import { useEffect, useState } from "react";
import type { StoredFile } from "../types";
import { downloadUrl, pdfUrl } from "../lib/api";
import { renderPdfPages } from "../lib/pdfRender";
import { Modal } from "./Dialogs";
import { DownloadIcon, FileIcon, PrinterIcon } from "./icons";

interface Props {
  open: boolean;
  file: StoredFile | null;
  label: string;
  onClose: () => void;
}

export default function PdfPrintDialog({ open, file, label, onClose }: Props) {
  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !file) return;
    let cancelled = false;
    setPages([]);
    setError("");
    setLoading(true);

    renderPdfPages(pdfUrl(file.id), 1.7)
      .then((rendered) => {
        if (!cancelled) setPages(rendered);
      })
      .catch(() => {
        if (!cancelled) setError("PDF belum bisa dibuka. Coba lagi atau unduh filenya.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, file?.id]);

  useEffect(
    () => () => {
      document.body.classList.remove("pdf-print-mode");
    },
    [],
  );

  if (!file) return null;

  const print = () => {
    if (pages.length === 0) return;
    document.body.classList.add("pdf-print-mode");
    window.setTimeout(() => {
      window.print();
      window.setTimeout(() => document.body.classList.remove("pdf-print-mode"), 1000);
    }, 80);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Cetak ${label}`}
      subtitle="Halaman PDF ditampilkan sesuai ukuran aslinya. Pilih printer Wi-Fi atau IP yang terhubung ke perangkat Anda."
      width={840}
      footer={
        <>
          <a className="btn btn-secondary" href={downloadUrl(file.id)} download={file.name}>
            <DownloadIcon size={15} /> Unduh PDF
          </a>
          <button
            type="button"
            className="btn btn-primary"
            onClick={print}
            disabled={loading || pages.length === 0}
          >
            <PrinterIcon size={16} /> Cetak sekarang
          </button>
        </>
      }
    >
      {loading ? (
        <div className="pdf-print-loading">
          <FileIcon size={24} />
          <p>Menyiapkan halaman PDF…</p>
        </div>
      ) : error ? (
        <div className="pdf-print-loading pdf-print-error">
          <FileIcon size={24} />
          <p>{error}</p>
          <a className="link-btn" href={pdfUrl(file.id)} target="_blank" rel="noreferrer">
            Buka PDF di tab baru
          </a>
        </div>
      ) : (
        <div className="pdf-print-pages">
          {pages.map((page, index) => (
            <img
              key={index}
              src={page}
              alt={`Halaman ${index + 1} dari ${label}`}
              className="pdf-print-page"
            />
          ))}
        </div>
      )}
    </Modal>
  );
}
