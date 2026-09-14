import { useCallback, useRef, useState } from "react";
import { UploadCloud, DownloadCloud, FileText, ImagePlus, FileImage, Aperture } from "lucide-react";
import {
  applyScanFilter,
  canvasFromImage,
  canvasesToPdf,
  downloadCanvas,
  loadImage,
  pdfToCanvases,
} from "@/lib/file-tools";

export type FileToolId = "resize-image" | "image-to-pdf" | "pdf-to-images" | "photo-to-scan";

const COPY: Record<FileToolId, { title: string; hint: string; accept: string; multiple: boolean; icon: typeof FileText }> = {
  "resize-image": {
    title: "Resize image",
    hint: "Pick an image, choose the new size, then download it.",
    accept: "image/*",
    multiple: false,
    icon: FileImage,
  },
  "image-to-pdf": {
    title: "Image to PDF",
    hint: "Select one or more images — they become the pages of a single PDF.",
    accept: "image/*",
    multiple: true,
    icon: FileText,
  },
  "pdf-to-images": {
    title: "PDF to images",
    hint: "Select a PDF and download every page as a PNG image.",
    accept: "application/pdf",
    multiple: false,
    icon: ImagePlus,
  },
  "photo-to-scan": {
    title: "Photo to scan",
    hint: "Turn a photo of a document into a clean, high-contrast scan.",
    accept: "image/*",
    multiple: false,
    icon: Aperture,
  },
};

export default function FileTools({ tool, onBeforeExport }: { tool: FileToolId; onBeforeExport?: () => Promise<boolean> }) {
  const meta = COPY[tool];
  const Icon = meta.icon;
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  // resize controls
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [lockRatio, setLockRatio] = useState(true);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [format, setFormat] = useState<"image/png" | "image/jpeg">("image/png");

  // scan controls
  const [strength, setStrength] = useState(1);

  const pick = useCallback(async (list: FileList | null) => {
    if (!list || !list.length) return;
    const arr = Array.from(list);
    setFiles(arr);
    setStatus("");
    setPreviews([]);
    if (tool === "pdf-to-images") return;
    const urls = arr.slice(0, 6).map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    if (tool === "resize-image" || tool === "photo-to-scan") {
      const img = await loadImage(arr[0]!);
      setNatural({ w: img.naturalWidth, h: img.naturalHeight });
      setWidth(img.naturalWidth);
      setHeight(img.naturalHeight);
    }
  }, [tool]);

  const setW = (value: number) => {
    setWidth(value);
    if (lockRatio && natural.w) setHeight(Math.round((value * natural.h) / natural.w));
  };
  const setH = (value: number) => {
    setHeight(value);
    if (lockRatio && natural.h) setWidth(Math.round((value * natural.w) / natural.h));
  };

  async function run() {
    if (!files.length) {
      setStatus("Choose a file first.");
      return;
    }
    if (onBeforeExport && !(await onBeforeExport())) return;
    setBusy(true);
    try {
      if (tool === "resize-image") {
        const img = await loadImage(files[0]!);
        const canvas = canvasFromImage(img, width, height);
        await downloadCanvas(canvas, `resized-${width}x${height}.${format === "image/png" ? "png" : "jpg"}`, format);
        setStatus(`Downloaded at ${width} × ${height} px.`);
      } else if (tool === "image-to-pdf") {
        const canvases: HTMLCanvasElement[] = [];
        for (const file of files) canvases.push(canvasFromImage(await loadImage(file)));
        await canvasesToPdf(canvases, `images-${Date.now()}.pdf`);
        setStatus(`PDF created with ${canvases.length} page${canvases.length === 1 ? "" : "s"}.`);
      } else if (tool === "pdf-to-images") {
        setStatus("Rendering pages…");
        const pages = await pdfToCanvases(files[0]!, 2);
        setPreviews(pages.slice(0, 6).map((c) => c.toDataURL("image/png")));
        for (let i = 0; i < pages.length; i++) {
          await downloadCanvas(pages[i]!, `page-${i + 1}.png`);
        }
        setStatus(`${pages.length} page image${pages.length === 1 ? "" : "s"} downloaded.`);
      } else {
        const img = await loadImage(files[0]!);
        const canvas = applyScanFilter(canvasFromImage(img), strength);
        setPreviews([canvas.toDataURL("image/png")]);
        await downloadCanvas(canvas, `scan-${Date.now()}.png`);
        setStatus("Scan created and downloaded.");
      }
    } catch (e) {
      console.error(e);
      setStatus(e instanceof Error ? e.message : "Something went wrong. Please try another file.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <input
        ref={inputRef}
        type="file"
        accept={meta.accept}
        multiple={meta.multiple}
        className="hidden"
        onChange={(e) => void pick(e.target.files)}
      />

      <div className="iphone-glass-tray rounded-[32px] p-6 sm:p-8">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-sky-200 bg-white/90 text-sky-700">
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">{meta.title}</h2>
            <p className="text-xs font-medium text-sky-900/70">{meta.hint}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="iphone-btn-glass mt-5 inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-xs font-bold"
        >
          <UploadCloud className="h-4 w-4 text-sky-600" />
          <span>{files.length ? `${files.length} file${files.length === 1 ? "" : "s"} selected` : "Choose file"}</span>
        </button>

        {tool === "resize-image" && files.length > 0 && (
          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            <label className="flex flex-col gap-1.5 text-xs font-bold text-sky-950">
              Width (px)
              <input
                type="number"
                min={1}
                value={width}
                onChange={(e) => setW(Number(e.target.value))}
                className="rounded-xl border border-sky-200 bg-white/95 px-3 py-2.5 text-xs font-semibold text-slate-900 outline-none focus:border-sky-500"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-bold text-sky-950">
              Height (px)
              <input
                type="number"
                min={1}
                value={height}
                onChange={(e) => setH(Number(e.target.value))}
                className="rounded-xl border border-sky-200 bg-white/95 px-3 py-2.5 text-xs font-semibold text-slate-900 outline-none focus:border-sky-500"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-bold text-sky-950">
              File type
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as typeof format)}
                className="rounded-xl border border-sky-200 bg-white/95 px-3 py-2.5 text-xs font-semibold text-slate-900 outline-none focus:border-sky-500"
              >
                <option value="image/png">PNG</option>
                <option value="image/jpeg">JPG</option>
              </select>
            </label>
            <label className="flex items-end gap-2 pb-2 text-xs font-bold text-sky-950">
              <input type="checkbox" checked={lockRatio} onChange={(e) => setLockRatio(e.target.checked)} />
              Keep proportions
            </label>
          </div>
        )}

        {tool === "photo-to-scan" && files.length > 0 && (
          <label className="mt-5 flex flex-col gap-1.5 text-xs font-bold text-sky-950">
            Contrast strength
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={strength}
              onChange={(e) => setStrength(Number(e.target.value))}
            />
          </label>
        )}

        <button
          type="button"
          onClick={run}
          disabled={busy || !files.length}
          className="iphone-btn-primary mt-6 inline-flex items-center gap-2 rounded-2xl px-6 py-3 text-xs font-bold tracking-wider uppercase disabled:opacity-50"
        >
          <DownloadCloud className="h-4 w-4" />
          <span>
            {tool === "image-to-pdf" ? "Create PDF" : tool === "pdf-to-images" ? "Export page images" : "Download result"}
          </span>
        </button>

        {previews.length > 0 && (
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {previews.map((src) => (
              <img key={src} src={src} alt="Preview" className="rounded-xl border border-sky-200 bg-white object-contain p-1" />
            ))}
          </div>
        )}

        {status && (
          <p className="mt-4 rounded-2xl border border-sky-200 bg-white/80 px-4 py-2.5 text-xs font-semibold text-sky-900">
            {busy ? "Working… " : ""}
            {status}
          </p>
        )}
      </div>
    </div>
  );
}
