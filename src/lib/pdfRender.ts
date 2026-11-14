import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Render setiap halaman PDF menjadi gambar agar bisa dipratinjau dan dicetak. */
export async function renderPdfPages(
  source: Blob | string,
  scale = 1.7,
): Promise<string[]> {
  let data: Uint8Array;
  if (typeof source === "string") {
    const response = await fetch(source, { credentials: "same-origin" });
    if (!response.ok) throw new Error("PDF tidak bisa dibuka.");
    data = new Uint8Array(await response.arrayBuffer());
  } else {
    data = new Uint8Array(await source.arrayBuffer());
  }

  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const pages: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas tidak tersedia.");
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      pages.push(canvas.toDataURL("image/png"));
    }
    return pages;
  } finally {
    await doc.destroy().catch(() => undefined);
  }
}
