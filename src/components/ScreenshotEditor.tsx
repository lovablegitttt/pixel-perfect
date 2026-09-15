import { useCallback, useEffect, useRef, useState } from "react";
import {
  UploadCloud,
  DownloadCloud,
  RotateCcw,
  Sparkles,
  Type,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Italic,
  Layers,
  ZoomIn,
  ZoomOut,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  CheckCircle2,
  Copy,
  ExternalLink,
  X,
  Check,
  Undo2,
  Redo2,
} from "lucide-react";
import { analyseBox } from "@/lib/image-analysis";
import { fitText, originFor, FAMILIES } from "@/lib/font-fit";

export type Layer = {
  id: string;
  text: string;
  original: string;
  /** exact ink bounds of the original line, in image pixels */
  x: number;
  y: number;
  w: number;
  h: number;
  /** coverage mask of the original ink, used for re-matching a font */
  mask: Uint8Array;
  /** alphabetic baseline of the original line, in image pixels */
  baselineY: number;
  fontSize: number;
  family: string;
  weight: number;
  italic: boolean;
  color: string;
  bg: string;
  letterSpacing: number;
  align: "left" | "center" | "right";
  dx: number;
  dy: number;
  /** set once the user changes text or style, so the layer gets repainted */
  edited?: boolean;
  /** layers the user added themselves are drawn without a background patch */
  added?: boolean;
};

export type EditorToolId =
  | "edit-text"
  | "erase-text"
  | "copy-text"
  | "add-text"
  | "replace-text"
  | "translate-text"
  | "font-finder"
  | "fix-text"
  | "pdf-text-editor";

const uid = () => Math.random().toString(36).slice(2, 9);

function isWordLike(raw: string, confidence: number) {
  const t = (raw ?? "").trim();
  if (!t) return false;
  // Keep everything visible: small text, single letters, numbers and symbols.
  // Only drop OCR noise that has essentially no confidence at all.
  const alnum = (t.match(/[\p{L}\p{N}]/gu) ?? []).length;
  if (!alnum) {
    // pure punctuation / symbols: keep common ones at low confidence
    return /^[\p{P}\p{S}]{1,4}$/u.test(t) && confidence >= 12;
  }
  return confidence >= 8;
}

const fontOf = (l: Layer) => `${l.italic ? "italic " : ""}${l.weight} ${l.fontSize}px ${l.family}`;

const QUICK_COLORS = [
  "#000000",
  "#ffffff",
  "#0284c7",
  "#1d4ed8",
  "#0f172a",
  "#dc2626",
  "#16a34a",
  "#d97706",
  "#9333ea",
  "#64748b",
];

export default function ScreenshotEditor({
  onBeforeExport,
  tool = "edit-text",
}: {
  onBeforeExport?: () => Promise<boolean>;
  tool?: EditorToolId;
}) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [history, setHistory] = useState<Layer[][]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [showLayerList, setShowLayerList] = useState(true);
  const [showInspector, setShowInspector] = useState(true);
  const [viewZoom, setViewZoom] = useState(1);

  // iOS Export Action Sheet Modal State
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportPreviewUrl, setExportPreviewUrl] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  // Tool workflow state
  const [findText, setFindText] = useState("");
  const [replaceWith, setReplaceWith] = useState("");
  const [language, setLanguage] = useState("Spanish");
  const [toolBusy, setToolBusy] = useState(false);
  const [toolNote, setToolNote] = useState("");
  const [placing, setPlacing] = useState(false);
  const [copied, setCopied] = useState(false);
  const isPdfTool = tool === "pdf-text-editor";

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const sel = layers.find((l) => l.id === selected) ?? null;

  const commitLayers = useCallback(
    (newLayers: Layer[]) => {
      setLayers(newLayers);
      setHistory((prev) => {
        const nextHistory = prev.slice(0, historyIndex + 1);
        nextHistory.push(newLayers);
        if (nextHistory.length > 40) {
          nextHistory.shift();
        }
        return nextHistory;
      });
      setHistoryIndex((prev) => Math.min(prev + 1, 39));
    },
    [historyIndex],
  );

  const update = (id: string, patch: Partial<Layer>) => {
    const newLayers = layers.map((l) => (l.id === id ? { ...l, ...patch, edited: true } : l));
    commitLayers(newLayers);
  };

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex >= 0 && historyIndex < history.length - 1;

  const undo = useCallback(() => {
    if (historyIndex > 0) {
      const nextIndex = historyIndex - 1;
      const target = history[nextIndex];
      if (target) {
        setLayers(target);
        setHistoryIndex(nextIndex);
        setStatus("Undo applied");
      }
    }
  }, [history, historyIndex]);

  const redo = useCallback(() => {
    if (historyIndex >= 0 && historyIndex < history.length - 1) {
      const nextIndex = historyIndex + 1;
      const target = history[nextIndex];
      if (target) {
        setLayers(target);
        setHistoryIndex(nextIndex);
        setStatus("Redo applied");
      }
    }
  }, [history, historyIndex]);

  // Global Keyboard Shortcuts for Undo & Redo (Cmd+Z / Ctrl+Z, Cmd+Shift+Z / Ctrl+Y)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isModifier = e.metaKey || e.ctrlKey;
      if (!isModifier) return;

      if (e.key.toLowerCase() === "z" && !e.shiftKey) {
        if (historyIndex > 0) {
          e.preventDefault();
          undo();
        }
      } else if ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y") {
        if (historyIndex >= 0 && historyIndex < history.length - 1) {
          e.preventDefault();
          redo();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [historyIndex, history, undo, redo]);

  const triggerImport = useCallback(() => {
    if (fileRef.current) {
      fileRef.current.value = ""; // Clear so same image can be re-selected
      fileRef.current.click();
    }
  }, []);

  const handleFile = useCallback(async (incoming: File) => {
    setBusy(true);
    setToolNote("");
    let file = incoming;
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
      setStatus("Opening the first page of your PDF…");
      try {
        const { pdfFirstPageAsFile } = await import("@/lib/file-tools");
        file = await pdfFirstPageAsFile(incoming);
      } catch (e) {
        console.error(e);
        setStatus("That PDF could not be opened. Please try another file.");
        setBusy(false);
        return;
      }
    }
    setLayers([]);
    setHistory([]);
    setHistoryIndex(-1);
    setSelected(null);
    setEditing(null);
    setShowExportModal(false);
    setExportPreviewUrl(null);
    setStatus("Loading screenshot…");
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    setImage(img);

    const off = document.createElement("canvas");
    off.width = img.naturalWidth;
    off.height = img.naturalHeight;
    const octx = off.getContext("2d", { willReadFrequently: true })!;
    octx.drawImage(img, 0, 0);
    const pixels = octx.getImageData(0, 0, off.width, off.height).data;

    setStatus("Analyzing screenshot typography & layout…");
    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng");
      // Upscale more aggressively so small text is legible to the OCR engine.
      const ocrScale = Math.min(4, Math.max(1, Math.round(2200 / Math.max(1, off.width))));
      let source: HTMLCanvasElement | File = file;
      if (ocrScale > 1) {
        const up = document.createElement("canvas");
        up.width = off.width * ocrScale;
        up.height = off.height * ocrScale;
        const uctx = up.getContext("2d")!;
        uctx.imageSmoothingEnabled = true;
        uctx.imageSmoothingQuality = "high";
        uctx.drawImage(img, 0, 0, up.width, up.height);
        source = up;
      }

      type OcrData = Awaited<ReturnType<typeof worker.recognize>>["data"];
      const passes: OcrData[] = [];
      // Pass 1: normal page layout. Pass 2: sparse text, which catches isolated
      // words, numbers, badges and symbols the layout pass misses.
      for (const psm of ["3", "11"]) {
        try {
          await worker.setParameters({
            // @ts-expect-error tesseract.js accepts the numeric PSM as a string
            tessedit_pageseg_mode: psm,
            preserve_interword_spaces: "1",
          });
          const { data } = await worker.recognize(source, {}, { blocks: true });
          passes.push(data);
        } catch (err) {
          console.warn("OCR pass failed", psm, err);
        }
      }
      await worker.terminate();

      type Bbox = { x0: number; y0: number; x1: number; y1: number };
      // One segment per WORD: each word becomes its own independently editable
      // layer, so editing a word never affects its neighbours.
      const segments: { text: string; bbox: Bbox; conf: number }[] = [];
      const seen = new Set<string>();
      const overlaps = (a: Bbox, b: Bbox) => {
        const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        if (ix <= 0 || iy <= 0) return false;
        const inter = ix * iy;
        const areaA = Math.max(1, (a.x1 - a.x0) * (a.y1 - a.y0));
        const areaB = Math.max(1, (b.x1 - b.x0) * (b.y1 - b.y0));
        return inter / Math.min(areaA, areaB) > 0.5;
      };
      for (const data of passes) {
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs ?? []) {
          for (const line of para.lines ?? []) {

            for (const w of line.words ?? []) {
              const t = (w.text ?? "").trim();
              const conf = w.confidence ?? 0;
              if (!t || !isWordLike(t, conf)) continue;
              const raw = w.bbox as Bbox;
              const bbox: Bbox = {
                x0: raw.x0 / ocrScale,
                y0: raw.y0 / ocrScale,
                x1: raw.x1 / ocrScale,
                y1: raw.y1 / ocrScale,
              };
              if (bbox.x1 - bbox.x0 < 1 || bbox.y1 - bbox.y0 < 1) continue;
              const key = `${t}|${Math.round(bbox.x0)}|${Math.round(bbox.y0)}`;
              if (seen.has(key)) continue;
              // drop duplicates found by both passes at the same place
              if (segments.some((s) => overlaps(s.bbox, bbox))) continue;
              seen.add(key);
              segments.push({ text: t, bbox, conf });
            }
          }
        }
      }
      }



      const found: Layer[] = [];
      for (const { text, bbox, conf } of segments) {
        const bh = bbox.y1 - bbox.y0;
        // vertical padding captures ascenders/descenders, horizontal padding
        // gives analyseBox enough surrounding background to sample from
        const padY = Math.max(1, bh * 0.18);
        const padX = Math.max(1, bh * 0.22);
        const box = {
          x: bbox.x0 - padX,
          y: bbox.y0 - padY,
          w: bbox.x1 - bbox.x0 + padX * 2,
          h: bh + padY * 2,
        };
        const s = analyseBox(pixels, off.width, off.height, box);

        // Keep small glyphs (periods, commas, thin digits) — only skip empties.
        if (s.ink.h < 2 || s.ink.w < 1) continue;
        // Very permissive: only reject regions that clearly are not text at all.
        const needed = conf >= 60 ? 0.14 : conf >= 30 ? 0.2 : 0.28;
        if (s.textScore < needed) continue;

        const fit = fitText(text, s.ink, s.mask, { strokeWidth: s.strokeWidth });


        found.push({
          id: uid(),
          text,
          original: text,
          x: s.ink.x,
          y: s.ink.y,
          w: s.ink.w,
          h: s.ink.h,
          mask: s.mask,
          baselineY: fit.baselineY,
          fontSize: fit.fontSize,
          family: fit.family,
          weight: fit.weight,
          italic: fit.italic,
          color: s.color,
          bg: s.background,
          letterSpacing: fit.letterSpacing,
          align: "left" as const,
          dx: 0,
          dy: 0,
        });
      }

      setLayers(found);
      setHistory([found]);
      setHistoryIndex(0);
      setStatus(
        found.length
          ? `${found.length} ${found.length === 1 ? "word" : "words"} detected — click any word to edit it.`
          : "No text detected. Try another screenshot.",
      );
      if (found.length > 0) {
        setSelected(found[0]?.id ?? null);
      }
    } catch (e) {
      console.error(e);
      setStatus("Could not read text from this image. Please try another screenshot.");
    } finally {
      setBusy(false);
    }
  }, []);

  // draw
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(image, 0, 0);

    for (const l of layers) {
      if (!l.edited && l.text === l.original) continue;
      if (!l.added) {
        const padX = Math.max(1, l.fontSize * 0.12);
        const padY = Math.max(1, l.fontSize * 0.28);
        ctx.fillStyle = l.bg;
        ctx.fillRect(l.x - padX, l.y - padY, l.w + padX * 2, l.h + padY * 2);
      }
      if (!l.text.trim()) continue;

      ctx.fillStyle = l.color;
      ctx.font = fontOf(l);
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
      (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing =
        `${l.letterSpacing}px`;
      const o = originFor(
        l.text,
        {
          family: l.family,
          weight: l.weight,
          italic: l.italic,
          fontSize: l.fontSize,
          letterSpacing: l.letterSpacing,
        },
        { x: l.x, y: l.y, w: l.w, baselineY: l.baselineY },
        l.align,
      );
      ctx.fillText(l.text, o.x + l.dx, o.y + l.dy);
      (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0px";
    }
  }, [image, layers]);

  useEffect(() => {
    redrawCanvas();
  }, [redrawCanvas]);

  // track on-screen scale so overlays line up with the rendered canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const measure = () => setScale(canvas.clientWidth / image.naturalWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [image]);

  /**
   * Robust Multi-Platform Export Handler
   * Triggers download, supports blob creation, fallback dataURL, and opens iOS Export Sheet.
   */
  const handleExport = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    if (onBeforeExport && !(await onBeforeExport())) return;

    // Ensure fresh render pass
    redrawCanvas();

    try {
      // 1. Generate preview for export sheet
      const dataUrl = canvas.toDataURL("image/png");
      setExportPreviewUrl(dataUrl);
      setShowExportModal(true);

      // 2. Immediate direct file download
      canvas.toBlob(
        (blob) => {
          const fileName = `screenshotguru-${Date.now()}.png`;
          if (blob) {
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = fileName;
            a.rel = "noopener noreferrer";
            a.style.display = "none";
            document.body.appendChild(a);
            a.click();
            setDownloadSuccess(true);
            setTimeout(() => {
              document.body.removeChild(a);
              URL.revokeObjectURL(blobUrl);
            }, 1000);
          } else {
            // Fallback to dataURL
            const a = document.createElement("a");
            a.href = dataUrl;
            a.download = fileName;
            a.style.display = "none";
            document.body.appendChild(a);
            a.click();
            setDownloadSuccess(true);
            setTimeout(() => {
              document.body.removeChild(a);
            }, 1000);
          }
        },
        "image/png",
        1.0,
      );
    } catch (err) {
      console.error("Export error, falling back:", err);
      const dataUrl = canvas.toDataURL("image/png");
      setExportPreviewUrl(dataUrl);
      setShowExportModal(true);
    }
  }, [image, onBeforeExport, redrawCanvas]);

  /** Copy rendered screenshot directly to clipboard */
  const handleCopyToClipboard = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              "image/png": blob,
            }),
          ]);
          setCopySuccess(true);
          setTimeout(() => setCopySuccess(false), 2500);
        } catch {
          // Clipboard write fallback
          const dataUrl = canvas.toDataURL("image/png");
          await navigator.clipboard.writeText(dataUrl);
          setCopySuccess(true);
          setTimeout(() => setCopySuccess(false), 2500);
        }
      }, "image/png");
    } catch (e) {
      console.error("Clipboard copy failed:", e);
    }
  };

  /** Open full resolution image in new window (essential for iPhone save to photos) */
  const handleOpenInNewTab = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        const win = window.open(url, "_blank");
        if (!win) {
          // If popups blocked, download directly
          const a = document.createElement("a");
          a.href = url;
          a.download = "screenshotguru.png";
          a.click();
        }
      }
    });
  };

  const resetAllLayers = () => {
    const reset = layers.map((l) => ({ ...l, text: l.original, edited: false, dx: 0, dy: 0 }));
    commitLayers(reset);
    setStatus("All edits reset to original");
  };

  /* ----------------------------- tool actions ----------------------------- */

  const extractedText = layers.map((l) => l.text).filter(Boolean).join(" ");

  const eraseLayer = (id: string) => {
    commitLayers(layers.map((l) => (l.id === id ? { ...l, text: "", edited: true } : l)));
    setToolNote("Word erased — the background was painted back in.");
  };

  const eraseAll = () => {
    commitLayers(layers.map((l) => ({ ...l, text: "", edited: true })));
    setToolNote("All detected text erased.");
  };

  const copyAllText = async () => {
    try {
      await navigator.clipboard.writeText(extractedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      setToolNote("Text copied to your clipboard.");
    } catch {
      setToolNote("Copying was blocked — select the text below and copy it manually.");
    }
  };

  const replaceAll = () => {
    if (!findText) {
      setToolNote("Type the word you want to find first.");
      return;
    }
    let count = 0;
    const next = layers.map((l) => {
      if (!l.text.toLowerCase().includes(findText.toLowerCase())) return l;
      count++;
      const re = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      return { ...l, text: l.text.replace(re, replaceWith), edited: true };
    });
    commitLayers(next);
    setToolNote(count ? `Replaced in ${count} place${count === 1 ? "" : "s"}.` : "That word was not found.");
  };

  const addTextAt = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * image.naturalWidth;
    const y = ((clientY - rect.top) / rect.height) * image.naturalHeight;
    const fontSize = Math.max(14, Math.round(image.naturalWidth / 34));
    const layer: Layer = {
      id: uid(),
      text: "New text",
      original: "",
      x,
      y,
      w: fontSize * 5,
      h: fontSize,
      mask: new Uint8Array(0),
      baselineY: y + fontSize * 0.82,
      fontSize,
      family: FAMILIES[0]!,
      weight: 600,
      italic: false,
      color: "#0f172a",
      bg: "#ffffff",
      letterSpacing: 0,
      align: "left",
      dx: 0,
      dy: 0,
      edited: true,
      added: true,
    };
    commitLayers([...layers, layer]);
    setSelected(layer.id);
    setPlacing(false);
    setToolNote("Text added — type your wording in the inspector below.");
  };

  const runAi = async (mode: "translate" | "fix") => {
    const targets = layers.filter((l) => l.text.trim());
    if (!targets.length) {
      setToolNote("Load a screenshot with text first.");
      return;
    }
    setToolBusy(true);
    setToolNote(mode === "translate" ? `Translating into ${language}…` : "Checking spelling…");
    try {
      const { transformTexts } = await import("@/lib/text-ai.functions");
      const result = await transformTexts({
        data: { mode, language, items: targets.map((l) => l.text) },
      });
      const map = new Map(targets.map((l, i) => [l.id, result.items[i] ?? l.text]));
      commitLayers(
        layers.map((l) => (map.has(l.id) ? { ...l, text: map.get(l.id)!, edited: true } : l)),
      );
      setToolNote(mode === "translate" ? `Translated into ${language}.` : "Spelling and casing corrected.");
    } catch (e) {
      setToolNote(e instanceof Error ? e.message : "That did not work. Please try again.");
    } finally {
      setToolBusy(false);
    }
  };

  const toolPanel = image ? (
    <div className="iphone-glass-tray space-y-4 rounded-[30px] p-5 sm:p-6">
      {tool === "erase-text" && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => sel && eraseLayer(sel.id)} disabled={!sel} className="iphone-btn-primary rounded-2xl px-5 py-2.5 text-xs font-bold disabled:opacity-50">
            Erase selected word
          </button>
          <button type="button" onClick={eraseAll} className="iphone-btn-glass rounded-2xl px-5 py-2.5 text-xs font-bold">
            Erase all text
          </button>
          <span className="text-xs font-medium text-sky-900/70">Tap a word on the screenshot, then erase it.</span>
        </div>
      )}

      {tool === "copy-text" && (
        <div className="space-y-3">
          <button type="button" onClick={copyAllText} className="iphone-btn-primary rounded-2xl px-5 py-2.5 text-xs font-bold">
            {copied ? "Copied!" : "Copy all text"}
          </button>
          <textarea
            readOnly
            value={extractedText}
            rows={5}
            className="w-full rounded-2xl border border-sky-200 bg-white/95 px-4 py-3 text-sm text-slate-900"
          />
        </div>
      )}

      {tool === "add-text" && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setPlacing((p) => !p)}
            className={placing ? "iphone-btn-glass rounded-2xl px-5 py-2.5 text-xs font-bold" : "iphone-btn-primary rounded-2xl px-5 py-2.5 text-xs font-bold"}
          >
            {placing ? "Cancel placing" : "Add a text box"}
          </button>
          <span className="text-xs font-medium text-sky-900/70">
            {placing ? "Now tap anywhere on the screenshot." : "Then edit the wording, size and colour below."}
          </span>
        </div>
      )}

      {tool === "replace-text" && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-xs font-bold text-sky-950">
            Find
            <input value={findText} onChange={(e) => setFindText(e.target.value)} className="rounded-xl border border-sky-200 bg-white/95 px-3 py-2.5 text-xs font-semibold outline-none focus:border-sky-500" />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-bold text-sky-950">
            Replace with
            <input value={replaceWith} onChange={(e) => setReplaceWith(e.target.value)} className="rounded-xl border border-sky-200 bg-white/95 px-3 py-2.5 text-xs font-semibold outline-none focus:border-sky-500" />
          </label>
          <button type="button" onClick={replaceAll} className="iphone-btn-primary rounded-2xl px-5 py-2.5 text-xs font-bold">
            Replace everywhere
          </button>
        </div>
      )}

      {tool === "translate-text" && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-xs font-bold text-sky-950">
            Translate into
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className="rounded-xl border border-sky-200 bg-white/95 px-3 py-2.5 text-xs font-semibold outline-none focus:border-sky-500">
              {["Spanish", "French", "German", "Portuguese", "Italian", "Hindi", "Arabic", "Japanese", "Korean", "Chinese (Simplified)", "English"].map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void runAi("translate")} disabled={toolBusy} className="iphone-btn-primary rounded-2xl px-5 py-2.5 text-xs font-bold disabled:opacity-50">
            Translate screenshot
          </button>
        </div>
      )}

      {tool === "fix-text" && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void runAi("fix")} disabled={toolBusy} className="iphone-btn-primary rounded-2xl px-5 py-2.5 text-xs font-bold disabled:opacity-50">
            Fix spelling in all text
          </button>
          <span className="text-xs font-medium text-sky-900/70">Corrects typos and misread characters without changing meaning.</span>
        </div>
      )}

      {tool === "font-finder" && (
        <div className="space-y-3">
          <p className="text-xs font-medium text-sky-900/70">Tap any word to see the closest matching font.</p>
          {sel ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Font", sel.family.split(",")[0]!.replace(/'/g, "")],
                ["Size", `${Math.round(sel.fontSize)} px`],
                ["Thickness", String(sel.weight)],
                ["Colour", sel.color],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-sky-200 bg-white/90 px-4 py-3">
                  <p className="text-[10px] font-bold tracking-wide text-sky-700 uppercase">{label}</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">{value}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs font-semibold text-slate-500">No word selected yet.</p>
          )}
        </div>
      )}

      {toolNote && (
        <p className="rounded-2xl border border-sky-200 bg-white/80 px-4 py-2.5 text-xs font-semibold text-sky-900">
          {toolBusy ? "Working… " : ""}
          {toolNote}
        </p>
      )}
    </div>
  ) : null;

  return (
    <div className="space-y-6">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />

      {/* 1. IMPORT STATE (When no screenshot has been selected) */}
      {!image && (
        <div
          onClick={triggerImport}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void handleFile(f);
          }}
          className={`iphone-glass-tray group relative cursor-pointer overflow-hidden rounded-[32px] p-10 text-center transition-all duration-300 sm:p-16 ${
            dragOver
              ? "scale-[1.01] border-sky-400 bg-sky-100/90 shadow-2xl shadow-sky-400/30"
              : "hover:border-sky-300 hover:bg-white/95"
          }`}
        >
          {/* Subtle luminous glass light reflection gleam */}
          <div className="pointer-events-none absolute -inset-x-20 top-0 h-40 bg-gradient-to-b from-white/90 via-white/30 to-transparent" />

          <div className="relative z-10 flex flex-col items-center">
            {/* Glossy blue glass icon tray inspired directly by user reference photo */}
            <div className="iphone-blue-plate flex h-24 w-32 items-center justify-center rounded-[26px] text-sky-700 shadow-xl shadow-sky-500/25 transition-transform duration-300 group-hover:scale-105 group-hover:rotate-1">
              <UploadCloud className="h-11 w-11 text-sky-600 drop-shadow-sm" />
            </div>

            <div className="mt-7 inline-flex items-center gap-2 rounded-full border border-sky-300/80 bg-white/80 px-4 py-1.5 text-xs font-bold tracking-wider text-sky-700 uppercase shadow-xs">
              <span className="h-2 w-2 rounded-full bg-sky-500 animate-pulse" />
              <span>Step 1 • IMPORT</span>
            </div>

            <h2 className="mt-4 font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              Import Your Screenshot
            </h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-sky-950/70">
              Drag & drop any screenshot here or tap to select from your device gallery
            </p>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                triggerImport();
              }}
              className="iphone-btn-primary mt-7 inline-flex items-center gap-2.5 rounded-2xl px-8 py-3.5 text-sm font-bold tracking-wide"
            >
              <ImageIcon className="h-4 w-4" />
              <span>Choose Image</span>
            </button>
          </div>
        </div>
      )}

      {/* 2. EDIT & 3. EXPORT WORKFLOW */}
      {image && (
        <div className="space-y-6">
          {/* Floating iOS Dynamic Island / Glass Capsule Header */}
          <div className="iphone-glass-tray flex flex-wrap items-center justify-between gap-3.5 rounded-[26px] p-3.5 sm:px-6">
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200/90 bg-white/85 px-3.5 py-1.5 text-xs font-bold text-sky-900 shadow-xs">
                <Layers className="h-3.5 w-3.5 text-sky-600" />
                <span>{layers.length} words detected</span>
              </div>
              <span className="hidden text-xs font-medium text-sky-900/60 sm:inline">
                {image.naturalWidth} × {image.naturalHeight} px
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
              {/* Undo & Redo Controls */}
              <div className="flex items-center rounded-xl border border-sky-200/80 bg-white/80 p-0.5 shadow-xs backdrop-blur-md">
                <button
                  type="button"
                  onClick={undo}
                  disabled={!canUndo}
                  title="Undo (Ctrl+Z / ⌘Z)"
                  aria-label="Undo"
                  className={`rounded-lg p-1.5 text-sky-800 transition-all ${
                    canUndo
                      ? "hover:bg-sky-100 hover:text-sky-950 active:scale-90"
                      : "cursor-not-allowed opacity-35"
                  }`}
                >
                  <Undo2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={redo}
                  disabled={!canRedo}
                  title="Redo (Ctrl+Y / ⌘⇧Z)"
                  aria-label="Redo"
                  className={`rounded-lg p-1.5 text-sky-800 transition-all ${
                    canRedo
                      ? "hover:bg-sky-100 hover:text-sky-950 active:scale-90"
                      : "cursor-not-allowed opacity-35"
                  }`}
                >
                  <Redo2 className="h-4 w-4" />
                </button>
              </div>

              {/* iOS Segmented Zoom Controls */}
              <div className="flex items-center rounded-xl border border-sky-200/80 bg-white/80 p-0.5 shadow-xs backdrop-blur-md">
                <button
                  type="button"
                  onClick={() => setViewZoom((z) => Math.max(0.75, z - 0.15))}
                  title="Zoom Out"
                  className="rounded-lg p-1.5 text-sky-700 transition-colors hover:bg-sky-100 active:scale-90"
                >
                  <ZoomOut className="h-3.5 w-3.5" />
                </button>
                <span className="px-2 text-xs font-bold text-sky-900">
                  {Math.round(viewZoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setViewZoom((z) => Math.min(2, z + 0.15))}
                  title="Zoom In"
                  className="rounded-lg p-1.5 text-sky-700 transition-colors hover:bg-sky-100 active:scale-90"
                >
                  <ZoomIn className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Reset edits */}
              <button
                type="button"
                onClick={resetAllLayers}
                title="Reset all edits"
                className="iphone-btn-glass inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold"
              >
                <RotateCcw className="h-3.5 w-3.5 text-sky-600" />
                <span className="hidden sm:inline">Reset</span>
              </button>

              {/* Import new screenshot */}
              <button
                type="button"
                onClick={triggerImport}
                title="Import another screenshot"
                className="iphone-btn-glass inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold"
              >
                <UploadCloud className="h-3.5 w-3.5 text-sky-600" />
                <span>IMPORT</span>
              </button>

              {/* High-visibility EXPORT button */}
              <button
                type="button"
                onClick={handleExport}
                disabled={busy}
                title="Export edited screenshot as PNG"
                className="iphone-btn-primary inline-flex items-center gap-2 rounded-xl px-5 py-2 text-xs font-bold uppercase tracking-wider"
              >
                <DownloadCloud className="h-4 w-4" />
                <span>EXPORT</span>
              </button>
            </div>
          </div>

          {/* Screenshot Viewport Container (iPhone Curved Glass Tray) */}
          <div className="iphone-glass-tray relative overflow-hidden rounded-[32px] p-3 sm:p-5">
            <div className="flex min-h-[340px] items-center justify-center overflow-auto rounded-2xl border border-sky-200/80 bg-slate-900/5 p-2.5 backdrop-blur-md">
              <div
                className="relative origin-top transition-transform duration-150"
                style={{ transform: `scale(${viewZoom})`, width: "100%" }}
              >
                <canvas ref={canvasRef} className="block h-auto w-full rounded-xl shadow-md" />
                <div className="absolute inset-0">
                  {layers.map((l, idx) => {
                    const box = {
                      left: `${(l.x / image.naturalWidth) * 100}%`,
                      top: `${(l.y / image.naturalHeight) * 100}%`,
                      width: `${(l.w / image.naturalWidth) * 100}%`,
                      height: `${(l.h / image.naturalHeight) * 100}%`,
                    };

                    const isSel = selected === l.id;

                    if (editing === l.id) {
                      return (
                        <input
                          key={l.id}
                          autoFocus
                          value={l.text}
                          onChange={(e) => update(l.id, { text: e.target.value })}
                          onBlur={() => setEditing(null)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === "Escape") setEditing(null);
                          }}
                          className="absolute z-10 rounded-sm border-0 bg-transparent p-0 leading-none outline-none ring-2 ring-sky-500 shadow-[0_0_14px_rgba(2,132,199,0.8)]"
                          style={{
                            ...box,
                            color: "transparent",
                            caretColor: l.color || "#0284c7",
                            fontFamily: l.family,
                            fontWeight: l.weight,
                            fontStyle: l.italic ? "italic" : "normal",
                            fontSize: `${Math.max(4, l.fontSize * scale)}px`,
                            letterSpacing: `${l.letterSpacing * scale}px`,
                            textAlign: l.align,
                          }}
                        />
                      );
                    }

                    return (
                      <button
                        key={l.id}
                        onClick={() => {
                          setSelected(l.id);
                          setEditing(l.id);
                        }}
                        aria-label={`Edit word ${idx + 1}: ${l.original}`}
                        className={`absolute rounded-[3px] bg-transparent transition-all before:absolute before:-inset-1 before:content-[''] ${
                          isSel
                            ? "border border-sky-400 bg-sky-400/25 ring-2 ring-sky-500 shadow-[0_0_14px_rgba(2,132,199,0.6)]"
                            : "hover:border hover:border-sky-400/70 hover:bg-sky-400/15"
                        }`}
                        style={box}
                      >
                        {isSel && (
                          <span className="pointer-events-none absolute -top-5 left-0 rounded-md border border-sky-300 bg-sky-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm">
                            #{idx + 1}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-3.5 flex flex-wrap items-center justify-between px-2 text-xs font-medium text-sky-950/70">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-sky-600 animate-ping" />
                <span>Tap any word inside the screenshot to edit it</span>
              </span>
              <span className="font-semibold">
                {layers.filter((l) => l.edited).length} modified
              </span>
            </div>
          </div>

          {/* Active Layer Inspector (Apple iOS Glass Card) */}
          {sel && (
            <div className="iphone-glass-tray rounded-[30px] p-5 sm:p-7 shadow-xl transition-all">
              <div className="flex items-center justify-between border-b border-sky-200/60 pb-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-sky-200 bg-white/90 text-sky-700 shadow-xs">
                    <Type className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-display text-base font-bold text-slate-900">
                      EDIT • Text Inspector
                    </h3>
                    <p className="text-xs font-medium text-sky-900/70">
                      Original: <span className="italic font-semibold">"{sel.original}"</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {sel.edited && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-[11px] font-bold text-emerald-700 shadow-xs">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Edited
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowInspector(!showInspector)}
                    className="rounded-xl p-1.5 text-sky-700 hover:bg-white/80 active:scale-95 transition-all"
                  >
                    {showInspector ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>

              {showInspector && (
                <div className="mt-4 space-y-4">
                  {/* Direct Text Editor Box */}
                  <div>
                    <label className="mb-1.5 block text-xs font-bold text-sky-950">
                      Replacement Text
                    </label>
                    <input
                      type="text"
                      value={sel.text}
                      onChange={(e) => update(sel.id, { text: e.target.value })}
                      placeholder="Type replacement text here..."
                      className="w-full rounded-2xl border border-sky-200/90 bg-white/95 px-4 py-3 text-sm font-semibold text-slate-900 placeholder:text-slate-400 shadow-xs outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200 transition-all"
                    />
                  </div>

                  {/* Typography controls row */}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {/* Font Family */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold text-sky-950">Font Family</label>
                      <select
                        value={sel.family}
                        onChange={(e) => update(sel.id, { family: e.target.value })}
                        className="rounded-xl border border-sky-200/90 bg-white/95 px-3 py-2.5 text-xs font-semibold text-slate-800 shadow-xs outline-none focus:border-sky-500"
                      >
                        {FAMILIES.map((f) => (
                          <option key={f} value={f}>
                            {f.split(",")[0]!.replace(/'/g, "")}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Weight / Thickness */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold text-sky-950">Thickness</label>
                      <select
                        value={sel.weight}
                        onChange={(e) => update(sel.id, { weight: Number(e.target.value) })}
                        className="rounded-xl border border-sky-200/90 bg-white/95 px-3 py-2.5 text-xs font-semibold text-slate-800 shadow-xs outline-none focus:border-sky-500"
                      >
                        {[200, 300, 400, 500, 600, 700, 800, 900].map((w) => (
                          <option key={w} value={w}>
                            {w} {w === 400 ? "(Regular)" : w === 700 ? "(Bold)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Font Size with Stepper */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold text-sky-950">Font Size (px)</label>
                      <div className="flex items-center rounded-xl border border-sky-200/90 bg-white/95 px-2 py-1.5 shadow-xs">
                        <button
                          type="button"
                          onClick={() =>
                            update(sel.id, { fontSize: Math.max(4, sel.fontSize - 0.5) })
                          }
                          className="rounded-lg p-1 text-xs font-bold text-sky-700 hover:bg-sky-100 active:scale-90"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          step="0.5"
                          value={Math.round(sel.fontSize * 10) / 10}
                          onChange={(e) =>
                            update(sel.id, { fontSize: Math.max(4, Number(e.target.value)) })
                          }
                          className="w-full bg-transparent text-center text-xs font-bold text-slate-900 outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => update(sel.id, { fontSize: sel.fontSize + 0.5 })}
                          className="rounded-lg p-1 text-xs font-bold text-sky-700 hover:bg-sky-100 active:scale-90"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {/* Text Colour */}
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold text-sky-950">Text Colour</label>
                      <div className="flex items-center gap-2 rounded-xl border border-sky-200/90 bg-white/95 px-2.5 py-1.5 shadow-xs">
                        <input
                          type="color"
                          value={sel.color}
                          onChange={(e) => update(sel.id, { color: e.target.value })}
                          className="h-6 w-6 cursor-pointer rounded-lg border-0 bg-transparent p-0"
                        />
                        <span className="text-xs font-mono font-bold text-slate-800">
                          {sel.color}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Secondary controls: alignment, italic, palette */}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sky-200/60 pt-3">
                    {/* Alignment & Italic buttons */}
                    <div className="flex items-center gap-2">
                      <div className="flex items-center rounded-xl border border-sky-200 bg-white/90 p-0.5 shadow-xs">
                        <button
                          type="button"
                          onClick={() => update(sel.id, { align: "left" })}
                          title="Align Left"
                          className={`rounded-lg p-1.5 transition-colors active:scale-90 ${
                            sel.align === "left"
                              ? "bg-sky-600 text-white shadow-xs"
                              : "text-slate-600 hover:text-slate-900"
                          }`}
                        >
                          <AlignLeft className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => update(sel.id, { align: "center" })}
                          title="Align Center"
                          className={`rounded-lg p-1.5 transition-colors active:scale-90 ${
                            sel.align === "center"
                              ? "bg-sky-600 text-white shadow-xs"
                              : "text-slate-600 hover:text-slate-900"
                          }`}
                        >
                          <AlignCenter className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => update(sel.id, { align: "right" })}
                          title="Align Right"
                          className={`rounded-lg p-1.5 transition-colors active:scale-90 ${
                            sel.align === "right"
                              ? "bg-sky-600 text-white shadow-xs"
                              : "text-slate-600 hover:text-slate-900"
                          }`}
                        >
                          <AlignRight className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => update(sel.id, { italic: !sel.italic })}
                        className={`inline-flex items-center gap-1 rounded-xl border px-3 py-1.5 text-xs font-bold transition-colors shadow-xs active:scale-95 ${
                          sel.italic
                            ? "border-sky-400 bg-sky-600 text-white"
                            : "border-sky-200 bg-white/95 text-slate-700 hover:bg-sky-50"
                        }`}
                      >
                        <Italic className="h-3.5 w-3.5" />
                        <span>Italic</span>
                      </button>
                    </div>

                    {/* Quick Color Swatches */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-bold text-sky-950 mr-1">Palette:</span>
                      {QUICK_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => update(sel.id, { color: c })}
                          style={{ backgroundColor: c }}
                          className={`h-5 w-5 rounded-full border shadow-xs transition-transform hover:scale-125 active:scale-90 ${
                            sel.color.toLowerCase() === c.toLowerCase()
                              ? "border-sky-600 ring-2 ring-sky-400 scale-110"
                              : "border-slate-300"
                          }`}
                          title={`Set color ${c}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Detected Lines Navigator (iOS pill matrix) */}
          <div className="iphone-glass-tray rounded-[30px] p-5 sm:p-7 shadow-xl">
            <div className="flex items-center justify-between border-b border-sky-200/60 pb-3.5">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-sky-600" />
                <h3 className="font-display text-sm font-bold text-slate-900">
                  Detected Words ({layers.length})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowLayerList(!showLayerList)}
                className="text-xs font-bold text-sky-700 hover:text-sky-950 transition-colors"
              >
                {showLayerList ? "Collapse" : "Expand"}
              </button>
            </div>

            {showLayerList && (
              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
                {layers.map((l, idx) => {
                  const isSel = selected === l.id;
                  return (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => {
                        setSelected(l.id);
                        setEditing(l.id);
                      }}
                      className={`group flex flex-col items-start rounded-2xl p-3 text-left transition-all duration-200 active:scale-95 ${
                        isSel
                          ? "border border-sky-400 bg-sky-100/90 shadow-md shadow-sky-500/20 scale-[1.02]"
                          : "iphone-pill-idle hover:border-sky-300 hover:bg-white"
                      }`}
                    >
                      <div className="flex w-full items-center justify-between">
                        <span className="text-[10px] font-bold text-sky-700">#{idx + 1}</span>
                        <span
                          className="h-2.5 w-2.5 rounded-full border border-slate-300 shadow-2xs"
                          style={{ backgroundColor: l.color }}
                        />
                      </div>
                      <span className="mt-1 line-clamp-2 text-xs font-bold text-slate-900 group-hover:text-sky-700">
                        {l.text || <span className="italic text-slate-400">(Empty line)</span>}
                      </span>
                      <span className="mt-1 text-[10px] font-medium text-sky-900/60">
                        {l.family.split(",")[0]!.replace(/'/g, "")} • {Math.round(l.fontSize)}px
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Status Bar */}
      {status && (
        <div className="iphone-glass-capsule flex items-center gap-2.5 rounded-2xl px-4 py-3 text-xs font-semibold text-sky-950 shadow-md">
          {busy ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-sky-600 border-t-transparent" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 text-sky-600" />
          )}
          <span>{status}</span>
        </div>
      )}

      {/* Full-screen loading overlay while a screenshot is being processed */}
      {busy && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/35 p-6 backdrop-blur-md animate-fade-in">
          <div className="iphone-glass-tray flex w-full max-w-xs flex-col items-center gap-4 rounded-[32px] px-8 py-10 text-center shadow-2xl animate-scale-in">
            <span className="relative flex h-14 w-14 items-center justify-center">
              <span className="absolute inset-0 animate-spin rounded-full border-4 border-sky-200 border-t-sky-600" />
              <Sparkles className="h-5 w-5 text-sky-600 pulse" />
            </span>
            <div>
              <p className="font-display text-sm font-bold text-slate-900">Reading your screenshot</p>
              <p className="mt-1 text-xs font-medium text-sky-900/70">{status || "Just a moment…"}</p>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-sky-100">
              <div className="h-full w-1/3 animate-[slide-in-right_1.2s_ease-in-out_infinite] rounded-full bg-sky-500" />
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          iOS Frosted Glass Export Action Sheet Modal
          ========================================================================= */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-md animate-fade-in">
          <div className="iphone-glass-tray relative w-full max-w-lg overflow-hidden rounded-[36px] p-6 sm:p-8 shadow-2xl animate-scale-in">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-sky-200/60 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white bg-gradient-to-br from-sky-400 to-blue-600 text-white shadow-md">
                  <DownloadCloud className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-display text-lg font-bold text-slate-900">
                    Export Screenshot
                  </h3>
                  <p className="text-xs font-medium text-sky-900/70">
                    High-resolution PNG generated
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="rounded-full p-2 text-sky-900/60 hover:bg-sky-100 hover:text-slate-900 active:scale-90 transition-all"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Preview image */}
            {exportPreviewUrl && (
              <div className="mt-5 overflow-hidden rounded-2xl border border-sky-200/80 bg-slate-900/5 p-2 shadow-inner">
                <img
                  src={exportPreviewUrl}
                  alt="Exported Screenshot Preview"
                  className="max-h-60 w-full rounded-xl object-contain shadow-sm"
                />
              </div>
            )}

            {/* Notifications */}
            {downloadSuccess && (
              <div className="mt-4 flex items-center gap-2 rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-xs font-bold text-emerald-800 shadow-xs">
                <Check className="h-4 w-4 text-emerald-600" />
                <span>PNG downloaded to your device!</span>
              </div>
            )}
            {copySuccess && (
              <div className="mt-4 flex items-center gap-2 rounded-2xl border border-sky-300 bg-sky-50 px-4 py-2.5 text-xs font-bold text-sky-800 shadow-xs">
                <Check className="h-4 w-4 text-sky-600" />
                <span>Image copied to clipboard! Ready to paste anywhere.</span>
              </div>
            )}

            {/* Action Buttons Grid */}
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={handleExport}
                className="iphone-btn-primary flex items-center justify-center gap-2 rounded-2xl py-3.5 text-xs font-bold uppercase tracking-wider"
              >
                <DownloadCloud className="h-4 w-4" />
                <span>Download PNG</span>
              </button>

              <button
                type="button"
                onClick={handleCopyToClipboard}
                className="iphone-btn-glass flex items-center justify-center gap-2 rounded-2xl py-3.5 text-xs font-bold uppercase tracking-wider"
              >
                {copySuccess ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-600" />
                    <span className="text-emerald-700">Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 text-sky-600" />
                    <span>Copy Image</span>
                  </>
                )}
              </button>
            </div>

            {/* Save to Photos / iPhone helper */}
            <div className="mt-3 flex items-center justify-center">
              <button
                type="button"
                onClick={handleOpenInNewTab}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-700 hover:text-sky-950 transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Open in New Tab (iPhone Save to Photos)</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
