"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Stage, Layer, Group, Rect, Line, Arrow, Ellipse, Transformer } from "react-konva";
import type Konva from "konva";
import {
  ArrowLeft, Hand, MousePointer2, StickyNote, Type, Square, Circle, Triangle, Diamond, RectangleHorizontal, MoveUpRight, Pen, Highlighter, Eraser, Frame,
  Undo2, Redo2, ZoomIn, ZoomOut, Maximize, Copy, Trash2, BringToFront, SendToBack, WifiOff, Lock, Unlock, CornerDownRight, ArrowRight, Share2, MessageCircle, ImagePlus, Download,
  Bold, Italic, Underline, Slash, Spline, Lasso, Group as GroupIcon, Ungroup, PanelRight, Keyboard,
} from "lucide-react";
import { canComment, type BoardRole, type LinkAccess } from "@/lib/data/types";
import { t } from "@/lib/copy";
import { formatBytes } from "@/lib/plans";
import {
  addItem, addSticky, boxOf, setMeta, bringToFront, deleteItems, duplicateItems, fitImage, hasText, itemsInside, itemsMap, sendToBack, simplify, updateItems, bboxOfPoints,
  groupItems, ungroupItems, withGroups, nextStyle, lassoHits, frameOrder, moveFrame,
  type Box, type ConnectorItem, type DrawingItem, type End, type FrameItem, type ImageItem, type Item, type Patch, type Route, type ShapeItem, type ShapeKind, type TextItem, type TextStyle,
} from "@/lib/board/model";
import { hitTest } from "@/lib/board/hit";
import { CLIP_MIME, copyPayload, parsePayload, pasteItems, plainText } from "@/lib/board/clipboard";
import { CANVAS, DEFAULT_INK, INK, STICKY_COLOR_NAMES, ZOOM, boardLook, inkOn, stickyPair, type BoardLook, type GridStyle } from "@/lib/board/palette";
import { INITIAL_SIZES, clampSize, parseSizes, stepSize, strokeHits, type BrushTool } from "@/lib/board/brush";
import { seedGrid } from "@/lib/board/bench";
import { renameBoard } from "@/app/actions";
import { useBoardDoc } from "./useBoardDoc";
import { bounds, fitTo, intersects, stepZoom, toBoard, zoomAt, type Viewport } from "./viewport";
import { ItemView, preloadImages, type Detail } from "./ItemView";
import { BulkItems } from "./BulkItems";
import { FramesPanel } from "./FramesPanel";
import { ExportDialog } from "./ExportDialog";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { Cursors } from "./Cursors";
import { Toolbar, settingsPlace, useLocalPref, useToolbarPrefs, type ToolDef } from "./Toolbar";
import { BoardLookMenu, gridBackground } from "./BoardLookMenu";
import { BrushSize } from "./BrushSize";
import { download, fileName, renderRegion, toPdfBlob, toPngBlob, type ExportFormat, type ExportScope } from "./exportBoard";
import { ShareDialog } from "./ShareDialog";
import { Comments, type CommentDraft } from "./Comments";
import { NotificationBell } from "../NotificationBell";
import { FONT, PAD, fitText, fittedFontSize, fontStyleOf, textHeight } from "./text";

type Tool = "select" | "lasso" | "hand" | "sticky" | "text" | "shape" | "connector" | "pen" | "highlighter" | "eraser" | "frame" | "comment";
type Pt = { x: number; y: number };
const FONT_SIZES = [14, 20, 32, 48];
const SHAPE_ICONS: Record<ShapeKind, typeof Square> = { rect: Square, round: RectangleHorizontal, ellipse: Circle, triangle: Triangle, diamond: Diamond };
const ROUTE_ICONS: Record<Route, typeof Square> = { straight: Slash, elbow: CornerDownRight, curved: Spline };
const STYLE_ICONS: Record<TextStyle, typeof Square> = { bold: Bold, italic: Italic, underline: Underline };
// Below this zoom, items drop shadows and text: unreadable there, and the costliest part of drawing a big board.
const LOW_DETAIL_BELOW = 0.3;
// Items this far (in screen pixels) outside the view are still drawn, so a short pan does not show them popping in.
const CULL_MARGIN = 200;
// More items than this on screen: while the view moves, draw them from one bitmap (see pauseHits).
const BITMAP_ABOVE = 3000;

type Drag =
  | { kind: "pan"; start: Pt; vp: Viewport }
  | { kind: "move"; start: Pt; orig: Map<string, { x: number; y: number; from?: End; to?: End }>; moved: boolean }
  | { kind: "marquee"; start: Pt; current: Pt; base: string[] }
  | { kind: "lasso"; points: number[]; base: string[] }
  | { kind: "create"; what: "shape" | "frame"; start: Pt; current: Pt }
  | { kind: "connect"; from: End; current: Pt; hover: string | null }
  | { kind: "draw"; points: number[] }
  | { kind: "erase" };

const rectFrom = (a: Pt, b: Pt): Box => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

export function Board({ board, role, user, unread }: { board: { id: string; name: string; linkAccess: LinkAccess }; role: BoardRole; user: { id: string; name: string }; unread?: number }) {
  const [shareOpen, setShareOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [exporting, setExporting] = useState(false); // draws every item, not just what is on screen, and hides selection
  const [commentDraft, setCommentDraft] = useState<CommentDraft | null>(null);
  const mayComment = canComment(role);
  const canEdit = role === "owner" || role === "coowner" || role === "editor";
  const canRename = role === "owner" || role === "coowner";
  const { doc, provider, items, meta, status, peers, cursors, undo, ready } = useBoardDoc(board.id, user);
  // Background and grid everyone on the board sees; the default ink and frames follow the background.
  const look = useMemo(() => boardLook(meta.bg), [meta.bg]);
  const gridStyle: GridStyle = meta.grid === "lines" || meta.grid === "none" ? meta.grid : "dots";
  const changeLook = (patch: { bg?: string; grid?: GridStyle }) => {
    if (!canEdit) return;
    undo.stopCapturing(); // each change is its own undo step
    setMeta(doc, patch);
    undo.stopCapturing();
  };
  // Per person, in this browser: brush sizes and where the toolbar sits.
  const [sizes, setSizes] = useLocalPref("mysl.brush", INITIAL_SIZES, parseSizes);
  const setBrushSize = (which: BrushTool, v: number) => setSizes({ ...sizes, [which]: clampSize(which, v) });
  const [bar, setBar] = useToolbarPrefs();

  // Hook for the performance benchmark (e2e/perf.spec.ts) to seed a big board: development only, or a
  // production build made with NEXT_PUBLIC_PERF_HOOK=1 to measure without development-mode React.
  useEffect(() => {
    if ((process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_PERF_HOOK !== "1") || !canEdit) return;
    const w = window as unknown as { __mysl?: { seed: (n: number) => number; touch: () => void } };
    w.__mysl = {
      seed: (n) => seedGrid(doc, n, user.id).length,
      // Moves one random sticky by a pixel, like a collaborator's edit arriving.
      touch: () => {
        const ids = [...itemsMap(doc).keys()];
        const id = ids[Math.floor(Math.random() * ids.length)];
        const m = itemsMap(doc).get(id);
        if (m && m.get("type") !== "connector") updateItems(doc, [{ id, patch: { x: (m.get("x") as number) + 1 } }]);
      },
    };
    return () => void delete w.__mysl;
  }, [doc, user.id, canEdit]);

  const wrapRef = useRef<HTMLDivElement>(null);
  const wrapRect = useRef({ left: 0, top: 0 });
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [vp, setVp] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [tool, setTool] = useState<Tool>("select");
  const [shapeKind, setShapeKind] = useState<ShapeKind>("rect");
  const [route, setRoute] = useState<Route>("straight");
  const [framesOpen, setFramesOpen] = useState(false);
  const framesOpener = useRef<HTMLButtonElement>(null);
  // Where the pointer is over the board (screen coordinates), so a paste lands under it.
  const pointerIn = useRef<Pt | null>(null);
  const [ink, setInk] = useState(DEFAULT_INK);
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [name, setName] = useState(board.name);
  const fitted = useRef(false);
  // A new item opens its editor on pointer-up, so the click that made it does not steal focus.
  const pendingEdit = useRef<string | null>(null);
  const pendingComment = useRef<CommentDraft | null>(null); // opened on pointer-up so the canvas does not take focus back
  // Konva reports a double click for any two quick clicks; only count ones in the same spot.
  const lastDown = useRef({ x: 0, y: 0, prev: { x: -999, y: -999 } });
  const cursorFrame = useRef(0);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const frames = useMemo(() => items.filter((i): i is FrameItem => i.type === "frame"), [items]);
  const lookup = useCallback((id: string) => {
    const i = byId.get(id);
    return i ? boxOf(i) : undefined;
  }, [byId]);

  useEffect(() => {
    setSelected((s) => (s.every((id) => byId.has(id)) ? s : s.filter((id) => byId.has(id))));
    if (editing && !byId.has(editing)) setEditing(null);
  }, [byId, editing]);

  useEffect(() => {
    provider?.awareness?.setLocalStateField("selection", selected);
  }, [provider, selected]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // Where the board sits in the window, read on resize instead of on every pointer and wheel event
    // (reading it then forces the browser to lay the page out mid-frame).
    const place = () => {
      wrapRect.current = el.getBoundingClientRect();
    };
    const ro = new ResizeObserver(() => {
      place();
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, []);

  useEffect(() => {
    if (fitted.current || size.w === 0 || !ready) return;
    setVp(fitTo(bounds(items.filter((i) => i.type !== "connector")), size));
    fitted.current = true;
  }, [items, size, ready]);

  const fitAll = useCallback(() => setVp(fitTo(bounds(items.filter((i) => i.type !== "connector")), size)), [items, size]);
  const center = { x: size.w / 2, y: size.h / 2 };
  const pointer = () => stageRef.current?.getPointerPosition() ?? center;

  // ---------- images: picker, paste, drop ----------
  const fileInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticePlans, setNoticePlans] = useState(false);
  const uploadImages = async (files: File[], at: Pt) => {
    const images = files.filter((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type));
    if (!canEdit) return;
    if (images.length === 0) return files.length && setNotice(t.images.unsupported);
    setNotice(t.images.uploading);
    setNoticePlans(false);
    const added: string[] = [];
    let error: string | null = null;
    let planLimit = false;
    for (const [n, file] of images.entries()) {
      if (file.size > 30 * 1024 * 1024) {
        error = t.images.tooLarge;
        continue;
      }
      // A file the browser cannot open as an image is not one, whatever its name says.
      const dims = await imageSize(file).catch(() => null);
      if (!dims) {
        error = t.images.unsupported;
        continue;
      }
      try {
        const form = new FormData();
        form.set("boardId", board.id);
        form.set("file", file);
        form.set("width", String(dims.width));
        form.set("height", String(dims.height));
        const res = await fetch("/api/assets", { method: "POST", body: form });
        if (res.status === 402) {
          const body = (await res.json().catch(() => ({}))) as { max?: number };
          error = t.limits.storage(formatBytes(body.max ?? 0));
          planLimit = true;
          break;
        }
        if (!res.ok) {
          error = res.status === 413 ? t.images.tooLarge : res.status === 415 ? t.images.unsupported : t.images.failed;
          continue;
        }
        const { id, src } = (await res.json()) as { id: string; src: string };
        const { w, h } = fitImage(dims.width, dims.height);
        const item = addItem<ImageItem>(doc, { type: "image", assetId: id, src, alt: file.name.replace(/\.[^.]+$/, "") || t.images.untitled, x: Math.round(at.x - w / 2 + n * 24), y: Math.round(at.y - h / 2 + n * 24), w, h }, user.id);
        added.push(item.id);
      } catch {
        error = t.images.failed;
      }
    }
    if (added.length) {
      setSelected(added);
      setTool("select");
    }
    setNotice(error);
    setNoticePlans(planLimit);
  };

  // ---------- clipboard: items (our own format), then image files ----------
  const typing = (target: EventTarget | null) => !!(target as HTMLElement)?.closest?.("input, textarea, select, [contenteditable=true], dialog");
  const pastePoint = () => toBoard(vp, pointerIn.current ?? center);
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      if (typing(e.target) || selected.length === 0 || editing) return;
      if (window.getSelection()?.toString()) return; // the person selected some page text: copy that instead
      const payload = copyPayload(items, selected);
      if (!payload || !e.clipboardData) return;
      e.preventDefault();
      e.clipboardData.setData(CLIP_MIME, JSON.stringify(payload));
      e.clipboardData.setData("text/plain", plainText(payload));
      if (e.type === "cut") removeSelected();
    };
    const onPaste = (e: ClipboardEvent) => {
      if (typing(e.target)) return;
      const payload = parsePayload(e.clipboardData?.getData(CLIP_MIME));
      if (payload) {
        e.preventDefault();
        if (!canEdit) return;
        const ids = pasteItems(doc, payload, pastePoint(), user.id);
        undo.stopCapturing(); // a paste is its own undo step
        setSelected(ids);
        setTool("select");
        return;
      }
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length === 0) return;
      e.preventDefault();
      void uploadImages(files, pastePoint());
    };
    window.addEventListener("copy", onCopy);
    window.addEventListener("cut", onCopy);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("copy", onCopy);
      window.removeEventListener("cut", onCopy);
      window.removeEventListener("paste", onPaste);
    };
  });
  const editable = (id: string) => canEdit && !byId.get(id)?.locked;

  // ---------- actions ----------
  const startEditingAfterClick = (id: string) => {
    setSelected([id]);
    pendingEdit.current = id;
    setTool("select");
  };
  const placeSticky = (at: Pt) => startEditingAfterClick(addSticky(doc, at, user.id).id);
  const placeText = (at: Pt) =>
    startEditingAfterClick(
      addItem<TextItem>(doc, { type: "text", x: Math.round(at.x), y: Math.round(at.y - 13), w: 60, h: 26, text: "", fontSize: 20, color: ink }, user.id).id,
    );
  const removeSelected = () => {
    const ids = selected.filter(editable);
    if (ids.length === 0) return;
    deleteItems(doc, ids);
    setSelected([]);
  };
  const groupSelected = () => {
    if (!canEdit) return;
    const ids = selected.filter(editable);
    if (groupItems(doc, ids)) setSelected(ids);
  };
  const ungroupSelected = () => {
    if (canEdit) ungroupItems(doc, selected.filter(editable));
  };
  /** Bold, italic or underline on the selected text items (or the one being edited); sizes follow the new width of the words. */
  const toggleStyle = (key: TextStyle, ids = selected) => {
    if (!canEdit) return;
    const texts = ids.map((id) => byId.get(id)).filter((i): i is TextItem => i?.type === "text" && !i.locked);
    if (texts.length === 0) return;
    const on = nextStyle(texts, key);
    undo.stopCapturing(); // each toggle is its own undo step
    updateItems(doc, texts.map((i) => ({ id: i.id, patch: { [key]: on || undefined, ...fitText(i, { [key]: on }) } })));
  };
  const duplicateSelected = () => {
    if (!canEdit || selected.length === 0) return;
    setSelected(duplicateItems(doc, withGroups(items, selected), user.id));
  };
  const patchSelected = (patch: Patch) => updateItems(doc, selected.filter(editable).map((id) => ({ id, patch })));
  const nudge = (dx: number, dy: number) => {
    updateItems(doc, selected.filter(editable).flatMap((id): { id: string; patch: Patch }[] => {
      const i = byId.get(id)!;
      if (i.type === "connector") return [{ id, patch: { from: shiftEnd(i.from, dx, dy), to: shiftEnd(i.to, dx, dy) } }];
      return [{ id, patch: { x: i.x + dx, y: i.y + dy } }];
    }));
  };
  const frameSelection = () => {
    const box = bounds(selected.map((id) => byId.get(id)).filter((i): i is Item => !!i && i.type !== "connector"));
    if (!box || !canEdit) return false;
    const f = addItem<FrameItem>(doc, { type: "frame", x: box.x - 40, y: box.y - 40, w: box.w + 80, h: box.h + 80, title: "" }, user.id);
    setSelected([f.id]);
    return true;
  };

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable=true], dialog")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.type === "keyup") {
        if (e.code === "Space") setSpaceDown(false);
        return;
      }
      if (e.code === "Space") {
        setSpaceDown(true);
        e.preventDefault();
        return;
      }
      const k = e.key.toLowerCase();
      if (mod) {
        if (k === "z") {
          e.preventDefault();
          if (canEdit) (e.shiftKey ? undo.redo() : undo.undo());
        } else if (k === "y") {
          e.preventDefault();
          if (canEdit) undo.redo();
        } else if (k === "d") {
          e.preventDefault();
          duplicateSelected();
        } else if (k === "a") {
          e.preventDefault();
          setSelected(items.map((i) => i.id));
        } else if (k === "=" || k === "+") {
          e.preventDefault();
          setVp((v) => stepZoom(v, 1, center));
        } else if (k === "-") {
          e.preventDefault();
          setVp((v) => stepZoom(v, -1, center));
        } else if (k === "0") {
          e.preventDefault();
          setVp((v) => zoomAt(v, center, 1));
        } else if (k === "g") {
          e.preventDefault();
          if (e.shiftKey) ungroupSelected();
          else groupSelected();
        } else if ((k === "b" || k === "i" || k === "u") && selected.some((id) => byId.get(id)?.type === "text")) {
          e.preventDefault();
          toggleStyle(k === "b" ? "bold" : k === "i" ? "italic" : "underline");
        } else if (e.shiftKey && k === "l") {
          e.preventDefault();
          const allLocked = selected.every((id) => byId.get(id)?.locked);
          if (canEdit) updateItems(doc, selected.map((id) => ({ id, patch: { locked: !allLocked } })));
        }
        return;
      }
      if (e.shiftKey && (e.key === "!" || e.code === "Digit1")) return fitAll();
      if (e.shiftKey && (e.key === "@" || e.code === "Digit2")) {
        const box = bounds(selected.map((id) => byId.get(id)).filter((i): i is Item => !!i));
        if (box) setVp(fitTo(box, size));
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        return setHelpOpen(true);
      }
      if (e.altKey) return; // Alt+letter belongs to the browser and the operating system
      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        return stepBrush(e.key === "]" ? 1 : -1);
      }
      const tools: Record<string, Tool> = { v: "select", o: "lasso", h: "hand", n: "sticky", t: "text", s: "shape", l: "connector", p: "pen", m: "highlighter", e: "eraser" };
      if (tools[k]) {
        if (canEdit || tools[k] === "select" || tools[k] === "hand" || tools[k] === "lasso") setTool(tools[k]);
        return;
      }
      if (k === "c") {
        if (mayComment) setTool("comment");
        return;
      }
      if (k === "i") {
        if (canEdit) fileInput.current?.click();
        return;
      }
      switch (e.key) {
        case "f":
        case "F":
          if (!frameSelection() && canEdit) setTool("frame");
          return;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          return removeSelected();
        case "Escape":
          if (framesOpen) {
            setFramesOpen(false);
            framesOpener.current?.focus();
          }
          setSelected([]);
          return setTool("select");
        case "Enter":
          if (selected.length === 1 && editable(selected[0]) && byId.get(selected[0])?.type !== "drawing") {
            e.preventDefault();
            setEditing(selected[0]);
          }
          return;
        case "ArrowLeft":
        case "ArrowRight":
        case "ArrowUp":
        case "ArrowDown": {
          if (selected.length === 0) return;
          e.preventDefault();
          const d = e.shiftKey ? 10 : 1;
          nudge(e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0, e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0);
          return;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  });

  // ---------- pointer ----------
  const itemAt = (target: Konva.Node | null): string | null => {
    let node: Konva.Node | null = target;
    while (node && node !== stageRef.current) {
      const id = node.getAttr("itemId");
      if (id) return id;
      node = node.getParent();
    }
    return null;
  };
  /**
   * The item at screen point `p`: from the canvas node that was hit, or, far out where items are drawn in bulk
   * without nodes of their own, by geometry. `title` is set when a frame was hit on its title.
   */
  const pickAt = (target: Konva.Node | null, p: Pt): { id: string | null; title: boolean } => {
    const id = itemAt(target);
    if (id) return { id, title: !!target?.getAttr("frameTitle") };
    if (detail !== "low") return { id: null, title: false };
    return hitTest(visible, toBoard(vp, p), vp.scale, lookup);
  };
  /** The item under the pointer that a connector may attach to. */
  const attachableAt = (p: Pt): string | null => {
    const id = pickAt(stageRef.current?.getIntersection(p) ?? null, p).id;
    const i = id ? byId.get(id) : undefined;
    return i && i.type !== "connector" && i.type !== "drawing" ? id : null;
  };

  /** Erases every stroke the eraser's circle touches (its size is in screen pixels). */
  const eraseAt = (p: Pt) => {
    const c = toBoard(vp, p);
    const r = sizes.eraser / 2 / vp.scale;
    const hits = visible.filter(
      (i): i is DrawingItem =>
        i.type === "drawing" && c.x >= i.x - r - i.width && c.x <= i.x + i.w + r + i.width && c.y >= i.y - r - i.width && c.y <= i.y + i.h + r + i.width && editable(i.id) && strokeHits(i, c, r),
    );
    if (hits.length) deleteItems(doc, hits.map((i) => i.id));
  };
  /** [ and ]: the current brush, or the selected drawings, one preset thinner or thicker. */
  const stepBrush = (dir: 1 | -1) => {
    if (tool === "pen" || tool === "highlighter" || tool === "eraser") return setBrushSize(tool, stepSize(tool, sizes[tool], dir));
    const drawings = selected.map((id) => byId.get(id)).filter((i): i is DrawingItem => i?.type === "drawing" && editable(i.id));
    if (drawings.length === 0 || drawings.length !== selected.length) return;
    undo.stopCapturing();
    updateItems(doc, drawings.map((i) => ({ id: i.id, patch: { width: stepSize(i.highlighter ? "highlighter" : "pen", i.width, dir) } })));
  };

  const startMarquee = (b: Pt, additive: boolean) => {
    setDrag({ kind: "marquee", start: b, current: b, base: additive ? selected : [] });
    if (!additive) setSelected([]);
  };

  const startMove = (ids: string[], b: Pt) => {
    const all = new Set(ids);
    // Frames carry what lies inside them.
    ids.forEach((id) => {
      const i = byId.get(id);
      if (i?.type === "frame") itemsInside(i, items, i.id).forEach((c) => all.add(c));
    });
    const orig = new Map<string, { x: number; y: number; from?: End; to?: End }>();
    all.forEach((id) => {
      const i = byId.get(id);
      if (!i || i.locked) return;
      orig.set(id, i.type === "connector" ? { x: 0, y: 0, from: i.from, to: i.to } : { x: i.x, y: i.y });
    });
    setDrag({ kind: "move", start: b, orig, moved: false });
  };

  const onPointerDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const p = pointer();
    lastDown.current = { ...p, prev: { x: lastDown.current.x, y: lastDown.current.y } };
    if (editing) setEditing(null);
    const tr = trRef.current;
    if (tr && e.target.getParent() === tr) return; // resize handles
    if (tool === "hand" || spaceDown || e.evt.button === 1 || e.evt.button === 2) {
      setDrag({ kind: "pan", start: p, vp });
      return;
    }
    const b = toBoard(vp, p);
    if (tool === "lasso") {
      setDrag({ kind: "lasso", points: [b.x, b.y], base: e.evt.shiftKey ? selected : [] });
      if (!e.evt.shiftKey) setSelected([]);
      return;
    }
    if (tool === "comment") {
      // A pin on an item sticks to it; elsewhere it stays where it was dropped.
      const id = pickAt(e.target, p).id;
      const on = id ? byId.get(id) : undefined;
      pendingComment.current = on && on.type !== "connector" ? { x: b.x - on.x, y: b.y - on.y, itemId: on.id } : { x: b.x, y: b.y, itemId: null };
      setTool("select");
      return;
    }
    if (canEdit) {
      switch (tool) {
        case "sticky":
          return placeSticky(b);
        case "text":
          return placeText(b);
        case "shape":
        case "frame":
          return setDrag({ kind: "create", what: tool, start: b, current: b });
        case "connector": {
          const hover = attachableAt(p);
          return setDrag({ kind: "connect", from: hover ? { itemId: hover, x: b.x, y: b.y } : { x: b.x, y: b.y }, current: b, hover: null });
        }
        case "pen":
        case "highlighter":
          undo.stopCapturing();
          return setDrag({ kind: "draw", points: [b.x, b.y] });
        case "eraser":
          undo.stopCapturing();
          eraseAt(p);
          return setDrag({ kind: "erase" });
      }
    }
    const picked = pickAt(e.target, p);
    const id = picked.id;
    if (id) {
      // A frame is picked by its title; its empty inside works like empty canvas.
      const hit = byId.get(id);
      if (hit?.type === "frame" && !picked.title && !selected.includes(id)) {
        startMarquee(b, e.evt.shiftKey);
        return;
      }
      // A grouped item is picked with its whole group.
      const pick = withGroups(items, [id]);
      let next = selected;
      if (e.evt.shiftKey) next = selected.includes(id) ? selected.filter((s) => !pick.includes(s)) : [...new Set([...selected, ...pick])];
      else if (!selected.includes(id)) next = pick;
      setSelected(next);
      if (canEdit && next.includes(id)) startMove(next, b);
      return;
    }
    startMarquee(b, e.evt.shiftKey);
  };

  const shareCursor = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = wrapRect.current;
    pointerIn.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const b = toBoard(vp, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    cancelAnimationFrame(cursorFrame.current);
    cursorFrame.current = requestAnimationFrame(() => provider?.awareness?.setLocalStateField("cursor", { x: Math.round(b.x), y: Math.round(b.y) }));
  };
  const hideCursor = () => {
    pointerIn.current = null;
    cancelAnimationFrame(cursorFrame.current);
    provider?.awareness?.setLocalStateField("cursor", null);
  };

  const onPointerMove = () => {
    if (!drag) return;
    const p = pointer();
    const b = toBoard(vp, p);
    switch (drag.kind) {
      case "pan":
        pauseHits();
        return setVp({ ...drag.vp, x: drag.vp.x + (p.x - drag.start.x), y: drag.vp.y + (p.y - drag.start.y) });
      case "move": {
        const dx = Math.round(b.x - drag.start.x);
        const dy = Math.round(b.y - drag.start.y);
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
        if (!drag.moved) undo.stopCapturing(); // one undo step for the whole drag
        updateItems(doc, [...drag.orig].map(([id, o]) => ({ id, patch: o.from ? { from: shiftEnd(o.from, dx, dy), to: shiftEnd(o.to!, dx, dy) } : { x: o.x + dx, y: o.y + dy } })));
        if (!drag.moved) setDrag({ ...drag, moved: true });
        return;
      }
      case "marquee": {
        const box = rectFrom(drag.start, b);
        const hits = items.filter((i) => i.type !== "connector" && intersects(box, boxOf(i)) && (i.type !== "frame" || contains(box, i))).map((i) => i.id);
        setSelected(Array.from(new Set([...drag.base, ...withGroups(items, hits)])));
        return setDrag({ ...drag, current: b });
      }
      case "lasso": {
        const last = drag.points.length;
        if (Math.hypot(b.x - drag.points[last - 2], b.y - drag.points[last - 1]) * vp.scale < 4) return;
        const points = [...drag.points, b.x, b.y];
        setSelected(Array.from(new Set([...drag.base, ...withGroups(items, lassoHits(items, points))])));
        return setDrag({ ...drag, points });
      }
      case "create":
        return setDrag({ ...drag, current: b });
      case "connect":
        return setDrag({ ...drag, current: b, hover: attachableAt(p) });
      case "draw": {
        const last = drag.points.length;
        if (Math.hypot(b.x - drag.points[last - 2], b.y - drag.points[last - 1]) * vp.scale < 2) return;
        return setDrag({ ...drag, points: [...drag.points, b.x, b.y] });
      }
      case "erase":
        return eraseAt(p);
    }
  };

  const onPointerUp = () => {
    const d = drag;
    setDrag(null);
    if (d?.kind === "move" && d.moved) undo.stopCapturing();
    if (d?.kind === "lasso" && selected.length > 0) setTool("select");
    if (d?.kind === "create") {
      let box = rectFrom(d.start, d.current);
      const clicked = box.w < 8 && box.h < 8;
      if (d.what === "shape") {
        if (clicked) box = { x: d.start.x - 80, y: d.start.y - 60, w: 160, h: 120 };
        const s = addItem<ShapeItem>(doc, { type: "shape", kind: shapeKind, ...roundBox(box), text: "", fill: "none", stroke: ink }, user.id);
        startEditingAfterClick(s.id);
      } else {
        if (clicked) box = { x: d.start.x - 400, y: d.start.y - 225, w: 800, h: 450 };
        const f = addItem<FrameItem>(doc, { type: "frame", ...roundBox(box), title: "" }, user.id);
        setSelected([f.id]);
        setTool("select");
      }
    }
    if (d?.kind === "connect") {
      const b = toBoard(vp, pointer());
      const to: End = d.hover ? { itemId: d.hover, x: b.x, y: b.y } : { x: b.x, y: b.y };
      const tooShort = !d.hover && !d.from.itemId && Math.hypot(b.x - d.from.x, b.y - d.from.y) < 10;
      if (!tooShort && !(d.hover && d.hover === d.from.itemId)) {
        const c = addItem<ConnectorItem>(doc, { type: "connector", x: 0, y: 0, w: 0, h: 0, from: d.from, to, route, endArrow: true, startArrow: false, stroke: ink, label: "" }, user.id);
        setSelected([c.id]);
      }
      setTool("select");
    }
    if (d?.kind === "draw" && d.points.length >= 4) {
      const pts = simplify(d.points, 0.8 / vp.scale);
      const box = bboxOfPoints(pts);
      const highlighter = tool === "highlighter";
      addItem<DrawingItem>(
        doc,
        { type: "drawing", x: box.x, y: box.y, w: Math.max(1, box.w), h: Math.max(1, box.h), points: pts.map((v, k) => (k % 2 ? v - box.y : v - box.x)), stroke: ink, width: sizes[highlighter ? "highlighter" : "pen"], highlighter },
        user.id,
      );
      undo.stopCapturing();
    }
    if (d?.kind === "erase") undo.stopCapturing();
    if (pendingEdit.current) {
      setEditing(pendingEdit.current);
      pendingEdit.current = null;
    }
    if (pendingComment.current) {
      setCommentDraft(pendingComment.current);
      pendingComment.current = null;
    }
  };

  // While the view moves, the layer stops hit-testing: Konva would redraw its hit canvas and read pixels back
  // on every wheel event and pointer move, which costs more than drawing the board. It resumes once the view
  // has been still for a moment, or right away when a pointer goes down.
  // With thousands of items on screen, the items are also drawn once into a bitmap that moves with the view
  // until it settles, instead of drawing every item on every frame.
  const [frozen, setFrozen] = useState(false);
  const layerRef = useRef<Konva.Layer>(null);
  const itemsRef = useRef<Konva.Group>(null);
  const motion = useRef({ count: 0, scale: 1 }); // what is on screen, for the bitmap decision
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const resumeHits = useCallback(() => {
    clearTimeout(settle.current);
    const group = itemsRef.current;
    if (group?.isCached()) {
      group.clearCache();
      group.getLayer()?.batchDraw();
      setFrozen(false);
    }
    const layer = layerRef.current;
    if (layer && !layer.listening()) {
      layer.listening(true);
      layer.drawHit();
    }
  }, []);
  const pauseHits = useCallback(() => {
    layerRef.current?.listening(false);
    const group = itemsRef.current;
    const { count, scale } = motion.current;
    if (group && !group.isCached() && count > BITMAP_ABOVE) {
      const r = group.getClientRect({ relativeTo: group });
      const ratio = scale * (window.devicePixelRatio || 1);
      if (r.width * ratio < 4096 && r.height * ratio < 4096) {
        group.cache({ pixelRatio: ratio });
        setFrozen(true);
      }
    }
    clearTimeout(settle.current);
    settle.current = setTimeout(resumeHits, 150);
  }, [resumeHits]);

  // Wheel and trackpad: handled before Konva sees the event, so it does not hit-test for it.
  const onWheel = useRef<(e: WheelEvent) => void>(() => {});
  onWheel.current = (e) => {
    e.preventDefault();
    e.stopPropagation();
    pauseHits();
    const rect = wrapRect.current;
    const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * 0.01); // trackpad pinch arrives as ctrl+wheel
      setVp((v) => zoomAt(v, p, v.scale * factor));
    } else {
      const dx = e.shiftKey ? e.deltaY : e.deltaX;
      const dy = e.shiftKey ? 0 : e.deltaY;
      setVp((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
    }
  };
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => onWheel.current(e);
    const down = () => resumeHits();
    el.addEventListener("wheel", wheel, { capture: true, passive: false });
    el.addEventListener("pointerdown", down, { capture: true });
    return () => {
      el.removeEventListener("wheel", wheel, { capture: true });
      el.removeEventListener("pointerdown", down, { capture: true });
    };
  }, [resumeHits]);

  const onDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const { x, y, prev } = lastDown.current;
    if (!canEdit || tool !== "select" || Math.hypot(x - prev.x, y - prev.y) > 6) return;
    const picked = pickAt(e.target, pointer());
    const hit = picked.id ? byId.get(picked.id) : undefined;
    if (hit && (hit.type !== "frame" || picked.title)) {
      if (hit.type === "drawing" || !editable(hit.id)) return;
      setSelected([hit.id]);
      setEditing(hit.id);
    } else {
      const s = addSticky(doc, toBoard(vp, pointer()), user.id);
      setSelected([s.id]);
      setEditing(s.id);
    }
  };

  // ---------- transformer (resize) ----------
  const resizable = selected.filter((id) => {
    const i = byId.get(id);
    return i && i.type !== "connector" && editable(id);
  });
  const resizableKey = resizable.join(",");
  const transformable = !editing && tool === "select";
  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    const nodes = transformable ? resizableKey.split(",").filter(Boolean).map((id) => stage.findOne(`#item-${id}`)).filter((n): n is Konva.Node => Boolean(n)) : [];
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [resizableKey, transformable, items, vp.scale]);

  // Item views get one stable callback, so a board re-render does not re-render every item.
  const transformEnd = useRef<() => void>(() => {});
  const onTransformEndStable = useCallback(() => transformEnd.current(), []);
  transformEnd.current = () => {
    const tr = trRef.current;
    if (!tr) return;
    const changes = tr.nodes().map((n) => {
      const id = n.getAttr("itemId") as string;
      const i = byId.get(id)!;
      const sx = n.scaleX();
      const sy = n.scaleY();
      n.scale({ x: 1, y: 1 });
      const w = Math.max(i.type === "drawing" ? 4 : 40, Math.round(i.w * sx));
      const h = Math.max(i.type === "drawing" ? 4 : 30, Math.round(i.h * sy));
      const patch: Patch = { x: Math.round(n.x()), y: Math.round(n.y()), w, h };
      if (i.type === "drawing") patch.points = i.points.map((v, k) => (k % 2 ? v * sy : v * sx));
      if (i.type === "text") {
        patch.h = textHeight(i.text, w, i.fontSize, fontStyleOf(i));
        patch.fixedWidth = true;
      }
      return { id, patch };
    });
    updateItems(doc, changes);
  };

  // ---------- export ----------
  const boxOfAny = (i: Item): Box => (i.type === "connector" ? connectorBox(i, lookup) : boxOf(i));
  const runExport = async ({ format, scope, quality }: { format: ExportFormat; scope: ExportScope; quality: number }) => {
    const stage = stageRef.current;
    if (!stage) throw new Error("no stage");
    const pick = scope === "selection" ? items.filter((i) => selected.includes(i.id)) : items;
    const regions = scope === "frames" ? frameOrder(frames).map(boxOf) : [bounds(pick.map(boxOfAny))].filter((b): b is Box => !!b);
    if (regions.length === 0) throw new Error("nothing to export");
    await preloadImages(items.filter((i): i is ImageItem => i.type === "image").map((i) => i.src));
    setExporting(true);
    trRef.current?.visible(false);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      // A chosen background is part of the picture; the theme's default canvas exports on white.
      const canvases = regions.map((b) => renderRegion(stage, vp, b, quality, scope === "frames" ? 0 : undefined, look.custom ? look.bg : undefined));
      const blob = format === "pdf" ? await toPdfBlob(canvases) : await toPngBlob(canvases[0]);
      download(blob, fileName(name || t.board.untitled, format));
    } finally {
      trRef.current?.visible(true);
      setExporting(false);
    }
  };

  // ---------- render ----------
  // Viewport culling: only items in or near the view are drawn (all of them while exporting).
  // While the board moves as a bitmap (see pauseHits), the items layer keeps what it drew: nothing is culled,
  // re-rendered or re-drawn until the view settles.
  const lastDrawn = useRef<{ visible: Item[]; scale: number; detail: Detail }>({ visible: [], scale: 1, detail: "full" });
  let visible: Item[];
  let detail: Detail;
  let drawScale: number;
  if (frozen && !exporting) {
    ({ visible, detail, scale: drawScale } = lastDrawn.current);
  } else {
    const margin = CULL_MARGIN / vp.scale;
    const view = { x: -vp.x / vp.scale - margin, y: -vp.y / vp.scale - margin, w: size.w / vp.scale + margin * 2, h: size.h / vp.scale + margin * 2 };
    const culled = exporting ? items : items.filter((i) => intersects(view, i.type === "connector" ? connectorBox(i, lookup) : i));
    // Same items in view as last render: keep the same array, so a pan that reveals nothing new skips the items layer.
    const prevVisible = lastDrawn.current.visible;
    visible = culled.length === prevVisible.length && culled.every((v, k) => v === prevVisible[k]) ? prevVisible : culled;
    detail = vp.scale < LOW_DETAIL_BELOW && !exporting ? "low" : "full";
    drawScale = vp.scale;
    if (!exporting) lastDrawn.current = { visible, detail, scale: drawScale };
  }
  motion.current = { count: visible.length, scale: vp.scale };
  const peerSelections = peers.flatMap((p) => p.selection.map((id) => ({ id, color: p.color.fill })));
  const editingItem = editing ? byId.get(editing) : undefined;
  const selItems = selected.map((id) => byId.get(id)).filter((i): i is Item => Boolean(i));
  const single = selItems.length === 1 ? selItems[0] : undefined;
  const selBox = bounds(selItems.map((i) => (i.type === "connector" ? connectorBox(i, lookup) : boxOf(i))));
  const gridStep = ZOOM["grid-step"] * vp.scale;
  const drawingTool = tool === "pen" || tool === "highlighter";
  const cursorStyle = drag?.kind === "pan" ? "grabbing" : tool === "hand" || spaceDown ? "grab" : tool === "select" ? "default" : "crosshair";
  const types = new Set(selItems.map((i) => i.type));
  const groups = new Set(selItems.map((i) => i.groupId).filter(Boolean));
  const allLocked = selItems.length > 0 && selItems.every((i) => i.locked);

  // The main toolbar's tools; `primary` ones stay in compact mode, the rest move under «Ещё».
  const pick = (next: Tool) => () => setTool(next);
  const toolDefs: ToolDef[] = [
    { id: "select", label: t.board.select, icon: (s) => <MousePointer2 size={s} />, active: tool === "select", onClick: pick("select"), primary: true },
    { id: "lasso", label: t.board.lasso, icon: (s) => <Lasso size={s} />, active: tool === "lasso", onClick: pick("lasso") },
    { id: "hand", label: t.board.hand, icon: (s) => <Hand size={s} />, active: tool === "hand", onClick: pick("hand"), primary: true },
    ...(mayComment ? [{ id: "comment", label: t.comments.tool, icon: (s: number) => <MessageCircle size={s} />, active: tool === "comment", onClick: pick("comment"), primary: !canEdit }] : []),
    ...(canEdit
      ? ([
          { id: "sticky", label: t.board.sticky, icon: (s) => <StickyNote size={s} />, active: tool === "sticky", onClick: pick("sticky"), primary: true },
          { id: "text", label: t.board.text, icon: (s) => <Type size={s} />, active: tool === "text", onClick: pick("text"), primary: true },
          { id: "shape", label: t.board.shape, icon: (s) => <ShapeIcon kind={shapeKind} size={s} />, active: tool === "shape", onClick: pick("shape"), primary: true },
          { id: "connector", label: t.board.connector, icon: (s) => <MoveUpRight size={s} />, active: tool === "connector", onClick: pick("connector"), primary: true },
          { id: "pen", label: t.board.pen, icon: (s) => <Pen size={s} />, active: tool === "pen", onClick: pick("pen"), primary: true },
          { id: "highlighter", label: t.board.highlighter, icon: (s) => <Highlighter size={s} />, active: tool === "highlighter", onClick: pick("highlighter") },
          { id: "eraser", label: t.board.eraser, icon: (s) => <Eraser size={s} />, active: tool === "eraser", onClick: pick("eraser") },
          { id: "frame", label: t.board.frame, icon: (s) => <Frame size={s} />, active: tool === "frame", onClick: pick("frame") },
          { id: "image", label: t.images.tool, icon: (s) => <ImagePlus size={s} />, onClick: () => fileInput.current?.click() },
          { id: "undo", label: t.board.undo, icon: (s) => <Undo2 size={s} />, onClick: () => undo.undo(), divider: true, primary: true },
          { id: "redo", label: t.board.redo, icon: (s) => <Redo2 size={s} />, onClick: () => undo.redo() },
        ] satisfies ToolDef[])
      : []),
  ];
  // A toolbar on the right moves aside for the frames panel.
  const barRight = framesOpen && size.w >= 720 ? "calc(var(--layout-side-panel) + 24px)" : "12px";
  const settings = settingsPlace(bar.side, bar.compact);

  return (
    <div
      className="relative h-full w-full touch-none overflow-hidden bg-canvas-bg"
      style={{ cursor: cursorStyle, ...(look.custom ? { background: look.bg } : {}) }}
      // Focus moving to a control near the edge must not scroll the board's frame.
      onScroll={(e) => {
        e.currentTarget.scrollTop = 0;
        e.currentTarget.scrollLeft = 0;
      }}
      data-board-bg={meta.bg ?? "default"}
      data-grid={gridStyle}
      onPointerMove={shareCursor}
      onPointerLeave={hideCursor}
      data-ready={ready || undefined}
      data-tool={tool}
      onDragOver={(e) => {
        if (canEdit && e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!canEdit || e.dataTransfer.files.length === 0) return;
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        void uploadImages([...e.dataTransfer.files], toBoard(vp, { x: e.clientX - rect.left, y: e.clientY - rect.top }));
      }}
    >
      {/* Dot grid: a layer one cell larger than the view, moved by transform so panning does not repaint it. */}
      {gridStep >= 8 && gridStyle !== "none" && (
        <div
          aria-hidden
          className="pointer-events-none absolute will-change-transform"
          style={{
            left: -gridStep,
            top: -gridStep,
            width: size.w + gridStep * 2,
            height: size.h + gridStep * 2,
            ...gridBackground(gridStyle, look.custom ? look.grid : "var(--color-canvas-grid)", gridStep),
            transform: `translate3d(${mod(vp.x, gridStep)}px, ${mod(vp.y, gridStep)}px, 0)`,
          }}
        />
      )}

      <div ref={wrapRef} className="absolute inset-0" onContextMenu={(e) => e.preventDefault()}>
        {size.w > 0 && (
          <Stage
            ref={stageRef}
            width={size.w}
            height={size.h}
            x={vp.x}
            y={vp.y}
            scaleX={vp.scale}
            scaleY={vp.scale}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onDblClick={onDblClick}
            role="application"
            aria-label="Доска"
          >
            <Layer ref={layerRef}>
              <Group ref={itemsRef}>
                <Items visible={visible} byId={byId} editing={editing} scale={drawScale} detail={detail} onTransformEnd={onTransformEndStable} look={look} lifted={selectedSet} />
              </Group>
              {!exporting && peerSelections.map(({ id, color }) => {
                const i = byId.get(id);
                if (!i) return null;
                const b = i.type === "connector" ? connectorBox(i, lookup) : boxOf(i);
                return <Rect key={`peer-${id}-${color}`} x={b.x - 3} y={b.y - 3} width={b.w + 6} height={b.h + 6} stroke={color} strokeWidth={2 / vp.scale} listening={false} />;
              })}
              {!exporting && selItems.filter((i) => i.type === "connector" || i.locked || (selItems.length > 1 && !i.groupId)).map((i) => {
                const b = i.type === "connector" ? connectorBox(i, lookup) : boxOf(i);
                const pad = 4 / vp.scale;
                return <Rect key={`sel-${i.id}`} x={b.x - pad} y={b.y - pad} width={b.w + pad * 2} height={b.h + pad * 2} stroke={look.selection} strokeWidth={1.5 / vp.scale} dash={i.locked ? [4 / vp.scale, 3 / vp.scale] : undefined} listening={false} />;
              })}
              {/* A selected group gets one solid outline around all of its members. */}
              {!exporting && [...new Set(selItems.map((i) => i.groupId).filter((g): g is string => !!g))].map((g) => {
                const b = bounds(selItems.filter((i) => i.groupId === g).map((i) => (i.type === "connector" ? connectorBox(i, lookup) : boxOf(i))))!;
                const pad = 8 / vp.scale;
                return <Rect key={`group-${g}`} x={b.x - pad} y={b.y - pad} width={b.w + pad * 2} height={b.h + pad * 2} stroke={look.selection} strokeWidth={1.5 / vp.scale} listening={false} />;
              })}
              <DragPreview drag={drag} scale={vp.scale} shapeKind={shapeKind} ink={inkOn(look, ink)} highlighter={tool === "highlighter"} width={sizes[tool === "highlighter" ? "highlighter" : "pen"]} look={look} lookup={lookup} />
              <Transformer
                ref={trRef}
                rotateEnabled={false}
                flipEnabled={false}
                keepRatio={single?.type === "image"}
                enabledAnchors={single?.type === "text" ? ["middle-left", "middle-right"] : single?.type === "image" ? ["top-left", "top-right", "bottom-left", "bottom-right"] : undefined}
                borderStroke={look.selection}
                borderStrokeWidth={1.5}
                anchorStroke={look.selection}
                anchorFill={look.dark ? look.bg : CANVAS.handle}
                anchorSize={8}
                ignoreStroke
              />
            </Layer>
          </Stage>
        )}
      </div>

      {editingItem && hasText(editingItem) && (
        <TextEditor
          key={editingItem.id}
          item={editingItem}
          look={look}
          vp={vp}
          onChange={(text) => {
            const patch: Patch = { text };
            if (editingItem.type === "text") Object.assign(patch, fitText(editingItem, { text }));
            updateItems(doc, [{ id: editingItem.id, patch }]);
          }}
          onStyle={(key) => toggleStyle(key, [editingItem.id])}
          onDone={(text) => {
            setEditing(null);
            // An empty text box is removed when you leave it, like a cancelled note.
            if (editingItem.type === "text" && !text.trim()) deleteItems(doc, [editingItem.id]);
          }}
        />
      )}
      {editingItem?.type === "frame" && (
        <InlineInput
          label={t.board.frameTitle}
          value={editingItem.title}
          placeholder={t.board.framePlaceholder}
          style={{ left: editingItem.x * vp.scale + vp.x, top: editingItem.y * vp.scale + vp.y - 34 }}
          onChange={(title) => updateItems(doc, [{ id: editingItem.id, patch: { title } }])}
          onDone={() => setEditing(null)}
        />
      )}
      {editingItem?.type === "connector" && (() => {
        const b = connectorBox(editingItem, lookup);
        return (
          <InlineInput
            label={t.board.connectorLabel}
            value={editingItem.label}
            placeholder={t.board.connectorLabel}
            style={{ left: (b.x + b.w / 2) * vp.scale + vp.x - 80, top: (b.y + b.h / 2) * vp.scale + vp.y - 16 }}
            onChange={(label) => updateItems(doc, [{ id: editingItem.id, patch: { label } }])}
            onDone={() => setEditing(null)}
          />
        );
      })()}

      {/* What the canvas shows, for screen readers (and tests). */}
      <ItemList items={items} />

      <Cursors store={cursors} vp={vp} />

      <header className="absolute left-3 right-3 top-3 flex items-start justify-between gap-3">
        <div className="flex h-12 min-w-0 items-center gap-1 rounded-md bg-bg px-2 shadow-toolbar">
          <Link href="/" aria-label={t.board.back} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm hover:bg-surface-hover">
            <ArrowLeft size={18} aria-hidden />
          </Link>
          <span className="mx-1 hidden text-sm font-semibold sm:inline">{t.product}</span>
          <label className="sr-only" htmlFor="board-name">Название доски</label>
          <input
            id="board-name"
            value={name}
            maxLength={60}
            readOnly={!canRename}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const clean = name.trim();
              if (!clean) setName(board.name);
              else if (clean !== board.name) void renameBoard(board.id, clean);
            }}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="h-8 w-48 min-w-0 rounded-sm bg-transparent px-2 hover:bg-surface-hover focus:bg-bg"
          />
          {!canEdit && <span className="rounded-pill bg-surface px-2 py-1 text-xs text-text-muted">{t.board.readOnly}</span>}
          {status !== "connected" && (
            <span role="status" className="flex items-center gap-1 rounded-pill bg-warning-subtle px-2 py-1 text-xs text-warning">
              {status === "offline" && <WifiOff size={14} aria-hidden />}
              {status === "offline" ? t.board.offline : t.board.connecting}
            </span>
          )}
        </div>
        <div className="flex h-12 items-center gap-1 rounded-md bg-bg px-2 shadow-toolbar" aria-label="Участники">
          <Avatar name={user.name} color="var(--color-accent)" label={`${user.name} (${t.board.you})`} />
          {peers.map((p) => (
            <Avatar key={p.clientId} name={p.name} color={p.color.fill} label={p.name} />
          ))}
          <NotificationBell initialUnread={unread} />
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            aria-label={t.export.open}
            title={t.export.open}
            className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-surface-hover"
          >
            <Download size={18} aria-hidden />
          </button>
          <BoardLookMenu bg={meta.bg ?? "default"} grid={gridStyle} canEdit={canEdit} onChange={changeLook} />
          <button
            type="button"
            onClick={() => setShareOpen(true)}
            className="ml-1 flex h-9 items-center gap-2 rounded-md bg-accent px-3 text-sm font-semibold text-on-accent hover:bg-accent-hover"
          >
            <Share2 size={16} aria-hidden /> <span className="hidden sm:inline">{t.share.open}</span>
            <span className="sr-only sm:hidden">{t.share.open}</span>
          </button>
        </div>
      </header>
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        hidden
        aria-label={t.images.add}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          void uploadImages(files, toBoard(vp, center));
        }}
      />
      {notice && (
        <div role="status" className="absolute bottom-16 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-md bg-bg px-3 py-2 text-sm shadow-pop">
          {notice}
          {noticePlans && (
            <Link href="/pricing" target="_blank" className="shrink-0 font-medium text-accent underline underline-offset-2">{t.limits.seePlans}</Link>
          )}
          {notice !== t.images.uploading && (
            <button type="button" aria-label={t.comments.close} onClick={() => setNotice(null)} className="text-text-muted hover:text-text">×</button>
          )}
        </div>
      )}
      <Comments
        boardId={board.id}
        userId={user.id}
        canComment={mayComment}
        vp={vp}
        size={size}
        lookup={(id) => byId.get(id)}
        provider={provider}
        draft={commentDraft}
        onDraftDone={() => setCommentDraft(null)}
      />
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        hasSelection={selected.length > 0}
        frameCount={frames.length}
        empty={items.length === 0}
        onExport={runExport}
      />
      <ShareDialog boardId={board.id} role={role} userId={user.id} linkAccess={board.linkAccess} open={shareOpen} onClose={() => setShareOpen(false)} />

      <Toolbar prefs={bar} setPrefs={setBar} tools={toolDefs} rightOffset={barRight} />

      {canEdit && (tool === "shape" || drawingTool || tool === "eraser" || tool === "connector" || tool === "text") && (
        <div
          role="toolbar"
          aria-label="Настройки инструмента"
          className={`absolute z-toolbar flex items-center gap-1 rounded-md bg-bg p-1 shadow-toolbar ${settings.className}`}
          style={bar.side === "right" ? { right: `calc(${barRight} + ${bar.compact ? 52 : 60}px)` } : undefined}
        >
          {tool === "shape" &&
            (Object.keys(SHAPE_ICONS) as ShapeKind[]).map((k) => (
              <ToolButton key={k} small label={t.board.shapes[k]} active={shapeKind === k} onClick={() => setShapeKind(k)}><ShapeIcon kind={k} size={16} /></ToolButton>
            ))}
          {tool === "connector" && <RoutePicker value={route} onChange={setRoute} vertical={settings.vertical} />}
          {(drawingTool || tool === "eraser") && <BrushSize tool={tool} value={sizes[tool]} onChange={(v) => setBrushSize(tool, v)} vertical={settings.vertical} />}
          {tool !== "eraser" && <InkPicker value={ink} onChange={setInk} vertical={settings.vertical} look={look} />}
        </div>
      )}

      {canEdit && selBox && !drag && !editing && tool === "select" && (
        <div
          role="toolbar"
          aria-label="Свойства выбранного"
          className="absolute flex max-w-[calc(100%-16px)] flex-wrap items-center gap-1 rounded-md bg-bg p-1 shadow-pop"
          style={{ left: Math.max(8, Math.min(size.w - 460, selBox.x * vp.scale + vp.x)), top: Math.max(68, selBox.y * vp.scale + vp.y - 60) }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {!allLocked && (
            <>
              {types.size === 1 && types.has("sticky") && (
                <div role="radiogroup" aria-label={t.board.colour} className="flex flex-wrap gap-0.5 px-1">
                  {STICKY_COLOR_NAMES.map((c) => (
                    <Swatch key={c} name={c} fill={stickyPair(c).fill} checked={single?.type === "sticky" && single.color === c} onClick={() => patchSelected({ color: c })} />
                  ))}
                </div>
              )}
              {types.size === 1 && types.has("shape") && (
                <>
                  {(Object.keys(SHAPE_ICONS) as ShapeKind[]).map((k) => (
                    <ToolButton key={k} small label={t.board.shapes[k]} active={single?.type === "shape" && single.kind === k} onClick={() => patchSelected({ kind: k })}><ShapeIcon kind={k} size={16} /></ToolButton>
                  ))}
                  <Divider />
                  <div role="radiogroup" aria-label={t.board.fill} className="flex gap-0.5 px-1">
                    <Swatch name={t.board.noFill} fill="transparent" checked={single?.type === "shape" && single.fill === "none"} onClick={() => patchSelected({ fill: "none" })} />
                    {STICKY_COLOR_NAMES.slice(0, 8).map((c) => (
                      <Swatch key={c} name={c} fill={stickyPair(c).fill} checked={single?.type === "shape" && single.fill === c} onClick={() => patchSelected({ fill: c })} />
                    ))}
                  </div>
                </>
              )}
              {types.size === 1 && types.has("text") && (
                <div role="group" aria-label={t.board.textStyle} className="flex gap-0.5">
                  {(Object.keys(STYLE_ICONS) as TextStyle[]).map((key) => {
                    const I = STYLE_ICONS[key];
                    return (
                      <ToolButton key={key} small label={t.board[key]} active={selItems.every((i) => i.type === "text" && i[key])} onClick={() => toggleStyle(key)}>
                        <I size={16} />
                      </ToolButton>
                    );
                  })}
                  <Divider />
                </div>
              )}
              {types.size === 1 && types.has("text") && (
                <div role="radiogroup" aria-label={t.board.fontSize} className="flex gap-0.5">
                  {FONT_SIZES.map((fs) => (
                    <button
                      key={fs}
                      role="radio"
                      aria-checked={single?.type === "text" && single.fontSize === fs}
                      onClick={() =>
                        updateItems(doc, selItems.flatMap((i) => (i.type === "text" ? [{ id: i.id, patch: { fontSize: fs, ...fitText(i, { fontSize: fs }) } }] : [])))
                      }
                      className={`h-8 min-w-8 rounded-sm px-1 text-sm ${single?.type === "text" && single.fontSize === fs ? "bg-accent-subtle text-accent" : "hover:bg-surface-hover"}`}
                    >
                      {fs}
                    </button>
                  ))}
                </div>
              )}
              {types.size === 1 && types.has("drawing") && (
                <>
                  <BrushSize
                    tool={selItems.every((i) => i.type === "drawing" && i.highlighter) ? "highlighter" : "pen"}
                    value={single?.type === "drawing" ? single.width : undefined}
                    onChange={(v) => updateItems(doc, selItems.filter((i) => i.type === "drawing" && !i.locked).map((i) => ({ id: i.id, patch: { width: v } })))}
                  />
                  <Divider />
                </>
              )}
              {single?.type === "connector" && (
                <>
                  <RoutePicker value={single.route} onChange={(r) => patchSelected({ route: r })} />
                  <Divider />
                  <ToolButton small label={t.board.arrow} active={single.endArrow} onClick={() => patchSelected({ endArrow: !single.endArrow })}><ArrowRight size={16} /></ToolButton>
                </>
              )}
              {[...types].every((ty) => ty === "text" || ty === "shape" || ty === "connector" || ty === "drawing") && (
                <>
                  <Divider />
                  <InkPicker look={look}
                    value={single ? inkOf(single) : undefined}
                    onChange={(c) => updateItems(doc, selItems.filter((i) => !i.locked).map((i) => ({ id: i.id, patch: i.type === "text" ? { color: c } : { stroke: c } })))}
                  />
                </>
              )}
              <Divider />
              {selItems.length > 1 && !(groups.size === 1 && selItems.every((i) => i.groupId)) && (
                <ToolButton small label={t.board.group} onClick={groupSelected}><GroupIcon size={16} /></ToolButton>
              )}
              {groups.size > 0 && <ToolButton small label={t.board.ungroup} onClick={ungroupSelected}><Ungroup size={16} /></ToolButton>}
              <ToolButton small label={t.board.duplicate} onClick={duplicateSelected}><Copy size={16} /></ToolButton>
              <ToolButton small label={t.board.front} onClick={() => bringToFront(doc, selected)}><BringToFront size={16} /></ToolButton>
              <ToolButton small label={t.board.back2} onClick={() => sendToBack(doc, selected)}><SendToBack size={16} /></ToolButton>
            </>
          )}
          <ToolButton small label={allLocked ? t.board.unlock : t.board.lock} active={allLocked} onClick={() => updateItems(doc, selected.map((id) => ({ id, patch: { locked: !allLocked } })))}>
            {allLocked ? <Unlock size={16} /> : <Lock size={16} />}
          </ToolButton>
          {!allLocked && <ToolButton small label={t.board.remove} onClick={removeSelected}><Trash2 size={16} /></ToolButton>}
        </div>
      )}

      {items.length === 0 && ready && canEdit && tool === "select" && (
        <p className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-bg px-4 py-2 text-center text-text-muted shadow-card">
          {t.board.emptyHint}
        </p>
      )}

      <div className="absolute bottom-3 right-3 flex h-12 items-center gap-1 rounded-md bg-bg px-1 shadow-toolbar">
        <ToolButton label={t.board.zoomOut} onClick={() => setVp((v) => stepZoom(v, -1, center))}><ZoomOut size={18} /></ToolButton>
        <button className="h-10 min-w-14 rounded-sm px-2 text-sm tabular-nums hover:bg-surface-hover" onClick={() => setVp((v) => zoomAt(v, center, 1))} aria-label="Масштаб 100%">
          {Math.round(vp.scale * 100)}%
        </button>
        <ToolButton label={t.board.zoomIn} onClick={() => setVp((v) => stepZoom(v, 1, center))}><ZoomIn size={18} /></ToolButton>
        <ToolButton label={t.board.fit} onClick={fitAll}><Maximize size={18} /></ToolButton>
        <ToolButton label={t.frames.open} active={framesOpen} onClick={() => setFramesOpen((o) => !o)} buttonRef={framesOpener}><PanelRight size={18} /></ToolButton>
        <ToolButton label={t.shortcuts.open} active={helpOpen} onClick={() => setHelpOpen(true)}><Keyboard size={18} /></ToolButton>
      </div>
      {framesOpen && (
        <FramesPanel
          frames={frames}
          canRename={canEdit}
          current={single?.type === "frame" ? single.id : null}
          onShow={(f) => {
            // Fit the frame into the part of the board the panel leaves free.
            setVp(fitTo(boxOf(f), { w: Math.max(200, size.w - 384), h: size.h }, 60));
            setSelected([f.id]);
          }}
          onRename={(id, title) => {
            if (byId.get(id)?.type === "frame" && editable(id) && (byId.get(id) as FrameItem).title !== title) updateItems(doc, [{ id, patch: { title } }]);
          }}
          onMove={(id, to) => {
            if (!canEdit) return;
            undo.stopCapturing(); // each move is its own undo step
            moveFrame(doc, id, to);
            undo.stopCapturing();
          }}
          onClose={() => {
            setFramesOpen(false);
            framesOpener.current?.focus();
          }}
        />
      )}
      <ShortcutsDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

// ---------- helpers ----------

const mod = (a: number, n: number) => ((a % n) + n) % n;

function shiftEnd(e: End, dx: number, dy: number): End {
  return e.itemId ? e : { x: e.x + dx, y: e.y + dy };
}

function roundBox(b: Box): Box {
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.max(20, Math.round(b.w)), h: Math.max(20, Math.round(b.h)) };
}

function contains(outer: Box, inner: Box) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

function connectorBox(c: ConnectorItem, lookup: (id: string) => Box | undefined): Box {
  const ends = [c.from, c.to].map((e) => {
    const b = e.itemId ? lookup(e.itemId) : undefined;
    return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : e;
  });
  return rectFrom(ends[0], ends[1]);
}

function describe(i: Item): string {
  const lock = (i.locked ? " (закреплено)" : "") + (i.groupId ? ` (${t.board.inGroup})` : "");
  switch (i.type) {
    case "sticky":
      return `Стикер: ${i.text || "пустой"}${lock}`;
    case "text": {
      const style = [i.bold && "жирный", i.italic && "курсив", i.underline && "подчёркнутый"].filter(Boolean).join(", ");
      return `Текст${style ? ` (${style})` : ""}: ${i.text}${lock}`;
    }
    case "shape":
      return `Фигура ${t.board.shapes[i.kind]}: ${i.text || "без текста"}${lock}`;
    case "connector":
      return `Линия${i.route === "curved" ? " плавная" : i.route === "elbow" ? " ломаная" : ""}${i.from.itemId && i.to.itemId ? " между объектами" : ""}${i.label ? `: ${i.label}` : ""}${lock}`;
    case "drawing":
      return `Рисунок${i.highlighter ? " маркером" : ""}, толщина ${i.width}${lock}`;
    case "frame":
      return `Рамка: ${i.title || t.board.framePlaceholder}${lock}`;
    case "image":
      return `Картинка: ${i.alt}${lock}`;
  }
}

function inkOf(i: Item) {
  return i.type === "text" ? i.color : i.type === "shape" || i.type === "connector" || i.type === "drawing" ? i.stroke : undefined;
}

function ShapeIcon({ kind, size }: { kind: ShapeKind; size: number }) {
  const I = SHAPE_ICONS[kind];
  return <I size={size} />;
}

function DragPreview({ drag, scale, shapeKind, ink, highlighter, width, look, lookup }: { drag: Drag | null; scale: number; shapeKind: ShapeKind; ink: string; highlighter: boolean; width: number; look: BoardLook; lookup: (id: string) => Box | undefined }) {
  if (!drag) return null;
  const C = { selection: look.selection, lassoFill: CANVAS.lassoFill };
  if (drag.kind === "marquee") {
    const r = rectFrom(drag.start, drag.current);
    return <Rect x={r.x} y={r.y} width={r.w} height={r.h} fill={C.lassoFill} stroke={C.selection} strokeWidth={1 / scale} listening={false} />;
  }
  if (drag.kind === "lasso") {
    return <Line points={drag.points} closed fill={C.lassoFill} stroke={C.selection} strokeWidth={1 / scale} dash={[5 / scale, 4 / scale]} listening={false} />;
  }
  if (drag.kind === "create") {
    const r = rectFrom(drag.start, drag.current);
    if (drag.what === "shape" && shapeKind === "ellipse") {
      return <Ellipse x={r.x + r.w / 2} y={r.y + r.h / 2} radiusX={r.w / 2} radiusY={r.h / 2} stroke={ink} strokeWidth={2 / scale} dash={[6 / scale, 4 / scale]} listening={false} />;
    }
    return <Rect x={r.x} y={r.y} width={r.w} height={r.h} stroke={drag.what === "frame" ? C.selection : ink} strokeWidth={2 / scale} dash={[6 / scale, 4 / scale]} listening={false} />;
  }
  if (drag.kind === "connect") {
    const fb = drag.from.itemId ? lookup(drag.from.itemId) : undefined;
    const start = fb ? { x: fb.x + fb.w / 2, y: fb.y + fb.h / 2 } : drag.from;
    const hb = drag.hover ? lookup(drag.hover) : undefined;
    return (
      <>
        {hb && <Rect x={hb.x - 4} y={hb.y - 4} width={hb.w + 8} height={hb.h + 8} stroke={C.selection} strokeWidth={2 / scale} listening={false} />}
        <Arrow points={[start.x, start.y, drag.current.x, drag.current.y]} stroke={ink} fill={ink} strokeWidth={2 / scale} pointerLength={10 / scale} pointerWidth={10 / scale} listening={false} />
      </>
    );
  }
  if (drag.kind === "draw") {
    return <Line points={drag.points} stroke={ink} strokeWidth={width} opacity={highlighter ? 0.35 : 1} lineCap="round" lineJoin="round" tension={0.4} listening={false} />;
  }
  return null;
}

/** The board's items. Memoised on its props: panning re-renders it only when different items come into view. */
const Items = memo(function Items({ visible, byId, editing, scale, detail, onTransformEnd, look, lifted }: { visible: Item[]; byId: Map<string, Item>; editing: string | null; scale: number; detail: Detail; onTransformEnd: () => void; look: BoardLook; lifted: Set<string> }) {
  // Far out: everything from one bulk shape, except the selected items (and the one being edited), which keep
  // nodes of their own so the resize handles can attach to them; they are drawn on top.
  const nodes = detail === "low" ? visible.filter((i) => lifted.has(i.id) || i.id === editing) : visible;
  const bulk = detail === "low" ? (nodes.length ? visible.filter((i) => !lifted.has(i.id) && i.id !== editing) : visible) : null;
  const views = nodes.map((i) => (
    <ItemView
      key={i.id}
      item={i}
      editing={editing === i.id}
      // Only these draw differently with zoom; the rest get a constant so zooming skips them.
      scale={i.type === "frame" || i.type === "connector" || i.type === "drawing" ? scale : 1}
      detail={detail}
      from={i.type === "connector" && i.from.itemId ? byId.get(i.from.itemId) : undefined}
      to={i.type === "connector" && i.to.itemId ? byId.get(i.to.itemId) : undefined}
      onTransformEnd={onTransformEnd}
      look={look}
    />
  ));
  if (!bulk) return views;
  return (
    <>
      <BulkItems items={bulk} byId={byId} look={look} scale={scale} version={byId} />
      {views}
    </>
  );
});

/** What the canvas shows, for screen readers (and tests). Memoised: it only changes with the items, not on pan or zoom. */
/** On a big board it follows the items at most twice a second, so a stream of edits does not rebuild thousands of rows. */
const BIG_BOARD = 2000;
const ItemList = memo(function ItemList({ items }: { items: Item[] }) {
  const [shown, setShown] = useState(items);
  const latest = useRef(items);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    latest.current = items;
    if (items.length < BIG_BOARD || timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      setShown(latest.current);
    }, 500);
  }, [items]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const list = items.length < BIG_BOARD ? items : shown;
  // The same element while the list is unchanged lets React skip all of its rows.
  return useMemo(
    () => (
      <ul aria-label="Объекты на доске" className="sr-only">
        {list.map((i) => (
          <ItemRow key={i.id} item={i} />
        ))}
      </ul>
    ),
    [list],
  );
});
const ItemRow = memo(function ItemRow({ item }: { item: Item }) {
  return <li>{describe(item)}</li>;
});

function RoutePicker({ value, onChange, vertical }: { value: Route; onChange: (r: Route) => void; vertical?: boolean }) {
  return (
    <div role="group" aria-label={t.board.routes.label} className={`flex gap-0.5 ${vertical ? "flex-col" : ""}`}>
      {(Object.keys(ROUTE_ICONS) as Route[]).map((r) => {
        const I = ROUTE_ICONS[r];
        return (
          <ToolButton key={r} small label={t.board.routes[r]} active={value === r} onClick={() => onChange(r)}>
            <I size={16} />
          </ToolButton>
        );
      })}
    </div>
  );
}

function ToolButton({ label, active, small, onClick, children, buttonRef }: { label: string; active?: boolean; small?: boolean; onClick: () => void; children: React.ReactNode; buttonRef?: React.Ref<HTMLButtonElement> }) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex shrink-0 items-center justify-center rounded-sm ${small ? "h-8 w-8" : "h-10 w-10"} ${active ? "bg-accent-subtle text-accent" : "text-text hover:bg-surface-hover"}`}
    >
      <span aria-hidden className="contents">{children}</span>
    </button>
  );
}

function Divider() {
  return <div className="mx-1 h-6 w-px bg-border" />;
}

function Swatch({ name, fill, checked, onClick }: { name: string; fill: string; checked: boolean; onClick: () => void }) {
  return (
    <button
      role="radio"
      aria-checked={checked}
      aria-label={name}
      title={name}
      onClick={onClick}
      className={`h-6 w-6 shrink-0 rounded-full border border-border ${checked ? "ring-2 ring-selection ring-offset-1" : ""}`}
      style={{ background: fill === "transparent" ? "linear-gradient(135deg, transparent 45%, var(--color-danger) 45%, var(--color-danger) 55%, transparent 55%)" : fill }}
    />
  );
}

function InkPicker({ value, onChange, vertical, look }: { value?: string; onChange: (c: string) => void; vertical?: boolean; look: BoardLook }) {
  return (
    <div role="radiogroup" aria-label={t.board.ink} className={`flex gap-1 p-1 ${vertical ? "flex-col items-center" : ""}`}>
      {INK.map((c) => (
        <Swatch key={c} name={c} fill={inkOn(look, c)} checked={value === c} onClick={() => onChange(c)} />
      ))}
    </div>
  );
}

function Avatar({ name, color, label }: { name: string; color: string; label: string }) {
  return (
    <span title={label} aria-label={label} role="img" className="flex h-8 w-8 items-center justify-center rounded-full border-2 bg-surface text-xs font-semibold" style={{ borderColor: color }}>
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function InlineInput({ label, value, placeholder, style, onChange, onDone }: { label: string; value: string; placeholder: string; style: React.CSSProperties; onChange: (v: string) => void; onDone: () => void }) {
  return (
    <input
      autoFocus
      aria-label={label}
      placeholder={placeholder}
      defaultValue={value}
      maxLength={120}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => (e.key === "Enter" || e.key === "Escape") && onDone()}
      className="absolute h-8 w-40 rounded-sm border border-border-input bg-bg px-2 text-sm shadow-pop"
      style={style}
    />
  );
}

function TextEditor({ item, vp, look, onChange, onDone, onStyle }: { item: Extract<Item, { text: string }>; vp: Viewport; look: BoardLook; onChange: (t: string) => void; onDone: (text: string) => void; onStyle: (key: TextStyle) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const free = item.type === "text";
  const fontSize = free ? item.fontSize : fittedFontSize(item);
  const colors =
    item.type === "sticky" ? stickyPair(item.color) : item.type === "shape" ? (item.fill === "none" ? { fill: "transparent", text: inkOn(look, item.stroke) } : stickyPair(item.fill)) : { fill: "transparent", text: inkOn(look, item.color) };
  const lines = Math.max(1, item.text.split("\n").length);
  return (
    <textarea
      ref={ref}
      aria-label={item.type === "sticky" ? "Текст стикера" : item.type === "shape" ? "Текст фигуры" : "Текст"}
      placeholder={item.type === "sticky" ? t.board.stickyPlaceholder : t.board.textPlaceholder}
      defaultValue={item.text}
      maxLength={6000}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onDone(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          e.currentTarget.blur();
        }
        // Ctrl+B / I / U style the whole text item while typing.
        const k = e.key.toLowerCase();
        if ((e.metaKey || e.ctrlKey) && !e.altKey && free && (k === "b" || k === "i" || k === "u")) {
          e.preventDefault();
          onStyle(k === "b" ? "bold" : k === "i" ? "italic" : "underline");
        }
      }}
      className={`absolute resize-none overflow-hidden border-0 bg-transparent outline-none ${free ? "text-left" : "text-center"}`}
      style={{
        left: item.x * vp.scale + vp.x,
        top: item.y * vp.scale + vp.y,
        width: free ? item.w + fontSize : item.w,
        height: free ? Math.max(item.h, fontSize * 1.3) + 4 : item.h,
        padding: free ? 0 : PAD,
        paddingTop: free ? 0 : Math.max(PAD, (item.h - fontSize * 1.3 * lines) / 2),
        transform: `scale(${vp.scale})`,
        transformOrigin: "top left",
        fontFamily: FONT,
        fontSize,
        fontWeight: free && item.bold ? 700 : undefined,
        fontStyle: free && item.italic ? "italic" : undefined,
        textDecoration: free && item.underline ? "underline" : undefined,
        lineHeight: 1.3,
        color: colors.text,
        background: item.type === "sticky" ? colors.fill : "transparent",
      }}
    />
  );
}

/** Natural size of an image file, read in the browser before upload. */
function imageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("not an image"));
    };
    img.src = url;
  });
}
