/**
 * Browser-only helpers shared by the file based tools (resize, PDF
 * conversion and photo-to-scan). Everything runs on the user's device.
 */

export async function loadImage(file: File | Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

export function canvasFromImage(img: HTMLImageElement, w?: number, h?: number) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w ?? img.naturalWidth));
  canvas.height = Math.max(1, Math.round(h ?? img.naturalHeight));
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function downloadCanvas(canvas: HTMLCanvasElement, name: string, type = "image/png", quality = 0.92) {
  return new Promise<void>((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return resolve();
        downloadBlob(blob, name);
        resolve();
      },
      type,
      quality,
    );
  });
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1500);
}

/** Document-scanner look: grey, high contrast, clean white paper. */
export function applyScanFilter(canvas: HTMLCanvasElement, strength = 1) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;

  // estimate page brightness so shadows do not turn the page grey
  let total = 0;
  for (let i = 0; i < d.length; i += 4) total += 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
  const mean = total / (d.length / 4);
  const white = Math.max(140, Math.min(250, mean * 1.08));
  const contrast = 1.6 + strength * 0.9;

  for (let i = 0; i < d.length; i += 4) {
    const grey = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
    let v = ((grey / white) * 255 - 128) * contrast + 150;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Render every page of a PDF file to a canvas. */
export async function pdfToCanvases(file: File, scale = 2): Promise<HTMLCanvasElement[]> {
  const pdfjs = await import("pdfjs-dist");
  const workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const out: HTMLCanvasElement[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    out.push(canvas);
  }
  return out;
}

/** Turn one or more canvases into a single downloadable PDF. */
export async function canvasesToPdf(canvases: HTMLCanvasElement[], name: string) {
  const { jsPDF } = await import("jspdf");
  const first = canvases[0]!;
  const doc = new jsPDF({
    orientation: first.width >= first.height ? "landscape" : "portrait",
    unit: "px",
    format: [first.width, first.height],
    compress: true,
  });
  canvases.forEach((canvas, index) => {
    if (index > 0) {
      doc.addPage([canvas.width, canvas.height], canvas.width >= canvas.height ? "landscape" : "portrait");
    }
    doc.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, canvas.width, canvas.height);
  });
  doc.save(name);
}

/** Rasterise the first page of a PDF into an image File the editor can open. */
export async function pdfFirstPageAsFile(file: File): Promise<File> {
  const [page] = await pdfToCanvases(file, 2.5);
  const blob: Blob = await new Promise((resolve) =>
    page!.toBlob((b) => resolve(b!), "image/png"),
  );
  return new File([blob], file.name.replace(/\.pdf$/i, "") + "-page-1.png", { type: "image/png" });
}
