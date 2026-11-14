import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const NUMBER_PATTERN =
  /(\d{1,4})\s*\/\s*UAS\s*\/\s*QUOT[-\s]?PANE\s*\/\s*(I{1,3}|IV|V|VI{0,3}|IX|X|XI|XII)\s*\/\s*(\d{4})/i;
const GENERIC_PATTERN = /\b(\d{1,4}\/UAS\/QUOT-PANE\/[IVX]+\/\d{4})\b/i;

/**
 * Coba baca nomor penawaran langsung dari teks PDF.
 * Hasilnya selalu bisa dikoreksi manual; null berarti tidak terdeteksi.
 */
export async function extractQuoteNumber(file: File): Promise<string | null> {
  let doc: pdfjs.PDFDocumentProxy | null = null;
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;

    const pageCount = Math.min(doc.numPages, 3);
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");

      const match = NUMBER_PATTERN.exec(text);
      if (match) {
        return `${match[1].padStart(3, "0")}/UAS/QUOT-PANE/${match[2].toUpperCase()}/${match[3]}`;
      }

      const generic = GENERIC_PATTERN.exec(text);
      if (generic) return generic[1];
    }
    return null;
  } catch {
    return null;
  } finally {
    if (doc) {
      try {
        await doc.destroy();
      } catch {
        // abaikan
      }
    }
  }
}
