/**
 * pdfExtractor.js
 * Extracts plain text from an uploaded PDF file using PDF.js.
 *
 * Text-first approach: PDF.js reads the actual text layer (works for all
 * digitally-created PDFs). If text extraction returns very little content
 * (< 50 chars), the PDF is likely a scanned image — the returned object
 * sets `isImagePdf: true` so the caller can trigger an OCR fallback later.
 *
 * Depends on: pdfjsLib (loaded from CDN before this script)
 */
const PdfExtractor = (() => {

  const WORKER_SRC =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  let workerConfigured = false;

  function ensureWorker() {
    if (!workerConfigured) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_SRC;
      workerConfigured = true;
    }
  }

  /**
   * Group PDF text items into logical lines by their Y position.
   *
   * PDF coordinates have Y=0 at the bottom of the page. Items on the same
   * visual line share a similar Y value. We bucket items within ±4 units of
   * each other, sort each bucket by X (left→right), then join buckets with
   * newlines (top→bottom, i.e. descending Y).
   *
   * This produces much cleaner output than naive concatenation, especially
   * for table-heavy documents like registration cards.
   */
  function itemsToText(items) {
    if (items.length === 0) return '';

    // Build lines: Map<roundedY → [{x, str}]>
    const lineMap = new Map();
    for (const item of items) {
      if (!item.str || item.str.trim() === '') continue;
      const y = Math.round(item.transform[5] / 4) * 4; // bucket to nearest 4 units
      const x = item.transform[4];
      if (!lineMap.has(y)) lineMap.set(y, []);
      lineMap.get(y).push({ x, str: item.str });
    }

    // Sort Y buckets descending (top of page first in PDF coords = higher Y)
    const sortedYs = [...lineMap.keys()].sort((a, b) => b - a);

    return sortedYs
      .map(y =>
        lineMap
          .get(y)
          .sort((a, b) => a.x - b.x)  // left to right
          .map(i => i.str)
          .join(' ')
          .trim()
      )
      .filter(line => line.length > 0)
      .join('\n');
  }

  /**
   * Extract all text from a PDF File object.
   *
   * @param {File} file — The uploaded PDF file.
   * @returns {Promise<{ text: string, pageCount: number, isImagePdf: boolean }>}
   */
  async function extractText(file) {
    ensureWorker();

    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    let fullText = '';

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page    = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = itemsToText(content.items);
      fullText += pageText + '\n\n';
    }

    fullText = fullText.trim();

    // Heuristic: if we got almost no text, this is probably a scanned image PDF
    const isImagePdf = fullText.length < 50;

    return { text: fullText, pageCount: pdf.numPages, isImagePdf };
  }

  return { extractText };
})();
