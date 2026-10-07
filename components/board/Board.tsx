"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Stage, Layer, Rect, Line, Arrow, Ellipse, Transformer } from "react-konva";
import type Konva from "konva";
import {
  ArrowLeft, Hand, MousePointer2, StickyNote, Type, Square, Circle, Triangle, Diamond, RectangleHorizontal, MoveUpRight, Pen, Highlighter, Eraser, Frame,
  Undo2, Redo2, ZoomIn, ZoomOut, Maximize, Copy, Trash2, BringToFront, SendToBack, WifiOff, Lock, Unlock, CornerDownRight, ArrowRight, Share2, MessageCircle, ImagePlus,
} from "lucide-react";
import { canComment, type BoardRole, type LinkAccess } from "@/lib/data/types";
import { t } from "@/lib/copy";
import {
  addItem, addSticky, boxOf, bringToFront, deleteItems, duplicateItems, fitImage, hasText, itemsInside, sendToBack, simplify, updateItems, bboxOfPoints,
  type Box, type ConnectorItem, type DrawingItem, type End, type FrameItem, type ImageItem, type Item, type Patch, type ShapeItem, type ShapeKind, type TextItem,
} from "@/lib/board/model";
import { CANVAS, DEFAULT_INK, INK, STICKY_COLOR_NAMES, ZOOM, stickyPair } from "@/lib/board/palette";
import { renameBoard } from "@/app/actions";
import { useBoardDoc } from "./useBoardDoc";
import { bounds, fitTo, intersects, stepZoom, toBoard, zoomAt, type Viewport } from "./viewport";
import { ItemView } from "./ItemView";
import { ShareDialog } from "./ShareDialog";
import { Comments, type CommentDraft } from "./Comments";
import { FONT, PAD, autoTextWidth, fittedFontSize, textHeight } from "./text";

type Tool = "select" | "hand" | "sticky" | "text" | "shape" | "connector" | "pen" | "highlighter" | "eraser" | "frame" | "comment";
type Pt = { x: number; y: number };
const FONT_SIZES = [14, 20, 32, 48];
const SHAPE_ICONS: Record<ShapeKind, typeof Square> = { rect: Square, round: RectangleHorizontal, ellipse: Circle, triangle: Triangle, diamond: Diamond };

type Drag =
  | { kind: "pan"; start: Pt; vp: Viewport }
  | { kind: "move"; start: Pt; orig: Map<string, { x: number; y: number; from?: End; to?: End }>; moved: boolean }
  | { kind: "marquee"; start: Pt; current: Pt; base: string[] }
  | { kind: "create"; what: "shape" | "frame"; start: Pt; current: Pt }
  | { kind: "connect"; from: End; current: Pt; hover: string | null }
  | { kind: "draw"; points: number[] }
  | { kind: "erase" };

const rectFrom = (a: Pt, b: Pt): Box => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

export function Board({ board, role, user }: { board: { id: string; name: string; linkAccess: LinkAccess }; role: BoardRole; user: { id: string; name: string } }) {
  const [shareOpen, setShareOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState<CommentDraft | null>(null);
  const mayComment = canComment(role);
  const canEdit = role === "owner" || role === "coowner" || role === "editor";
  const canRename = role === "owner" || role === "coowner";
  const { doc, provider, items, status, peers, undo, ready } = useBoardDoc(board.id, user);

  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [vp, setVp] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [tool, setTool] = useState<Tool>("select");
  const [shapeKind, setShapeKind] = useState<ShapeKind>("rect");
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
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
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
  const uploadImages = async (files: File[], at: Pt) => {
    const images = files.filter((f) => /^image\/(png|jpeg|gif|webp)$/.test(f.type));
    if (!canEdit) return;
    if (images.length === 0) return files.length && setNotice(t.images.unsupported);
    setNotice(t.images.uploading);
    const added: string[] = [];
    let error: string | null = null;
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
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement).closest?.("input, textarea, [contenteditable=true], dialog")) return;
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length === 0) return;
      e.preventDefault();
      void uploadImages(files, toBoard(vp, center));
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
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
  const duplicateSelected = () => {
    if (!canEdit || selected.length === 0) return;
    setSelected(duplicateItems(doc, selected, user.id));
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
      const tools: Record<string, Tool> = { v: "select", h: "hand", n: "sticky", t: "text", s: "shape", l: "connector", p: "pen", e: "eraser" };
      if (tools[k]) {
        if (canEdit || tools[k] === "select" || tools[k] === "hand") setTool(tools[k]);
        return;
      }
      if (k === "c") {
        if (mayComment) setTool("comment");
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
  /** The item under the pointer that a connector may attach to. */
  const attachableAt = (p: Pt): string | null => {
    const id = itemAt(stageRef.current?.getIntersection(p) ?? null);
    const i = id ? byId.get(id) : undefined;
    return i && i.type !== "connector" && i.type !== "drawing" ? id : null;
  };

  const eraseAt = (p: Pt) => {
    const id = itemAt(stageRef.current?.getIntersection(p) ?? null);
    if (id && byId.get(id)?.type === "drawing" && editable(id)) deleteItems(doc, [id]);
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
    if (tool === "comment") {
      // A pin on an item sticks to it; elsewhere it stays where it was dropped.
      const id = itemAt(e.target);
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
    const id = itemAt(e.target);
    if (id) {
      // A frame is picked by its title; its empty inside works like empty canvas.
      const hit = byId.get(id);
      if (hit?.type === "frame" && !(e.target as Konva.Node).getAttr("frameTitle") && !selected.includes(id)) {
        startMarquee(b, e.evt.shiftKey);
        return;
      }
      let next = selected;
      if (e.evt.shiftKey) next = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
      else if (!selected.includes(id)) next = [id];
      setSelected(next);
      if (canEdit && next.includes(id)) startMove(next, b);
      return;
    }
    startMarquee(b, e.evt.shiftKey);
  };

  const shareCursor = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const b = toBoard(vp, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    cancelAnimationFrame(cursorFrame.current);
    cursorFrame.current = requestAnimationFrame(() => provider?.awareness?.setLocalStateField("cursor", { x: Math.round(b.x), y: Math.round(b.y) }));
  };
  const hideCursor = () => {
    cancelAnimationFrame(cursorFrame.current);
    provider?.awareness?.setLocalStateField("cursor", null);
  };

  const onPointerMove = () => {
    if (!drag) return;
    const p = pointer();
    const b = toBoard(vp, p);
    switch (drag.kind) {
      case "pan":
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
        setSelected(Array.from(new Set([...drag.base, ...hits])));
        return setDrag({ ...drag, current: b });
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
        const c = addItem<ConnectorItem>(doc, { type: "connector", x: 0, y: 0, w: 0, h: 0, from: d.from, to, route: "straight", endArrow: true, startArrow: false, stroke: ink, label: "" }, user.id);
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
        { type: "drawing", x: box.x, y: box.y, w: Math.max(1, box.w), h: Math.max(1, box.h), points: pts.map((v, k) => (k % 2 ? v - box.y : v - box.x)), stroke: ink, width: highlighter ? 16 : 3, highlighter },
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

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const p = pointer();
    if (e.evt.ctrlKey || e.evt.metaKey) {
      const factor = Math.exp(-e.evt.deltaY * 0.01); // trackpad pinch arrives as ctrl+wheel
      setVp((v) => zoomAt(v, p, v.scale * factor));
    } else {
      const dx = e.evt.shiftKey ? e.evt.deltaY : e.evt.deltaX;
      const dy = e.evt.shiftKey ? 0 : e.evt.deltaY;
      setVp((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
    }
  };

  const onDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const { x, y, prev } = lastDown.current;
    if (!canEdit || tool !== "select" || Math.hypot(x - prev.x, y - prev.y) > 6) return;
    const id = itemAt(e.target);
    const hit = id ? byId.get(id) : undefined;
    if (hit && (hit.type !== "frame" || (e.target as Konva.Node).getAttr("frameTitle"))) {
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
  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    const nodes = !editing && tool === "select" ? resizable.map((id) => stage.findOne(`#item-${id}`)).filter((n): n is Konva.Node => Boolean(n)) : [];
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  });

  const onTransformEnd = () => {
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
        patch.h = textHeight(i.text, w, i.fontSize);
        patch.fixedWidth = true;
      }
      return { id, patch };
    });
    updateItems(doc, changes);
  };

  // ---------- render ----------
  const view = { x: -vp.x / vp.scale, y: -vp.y / vp.scale, w: size.w / vp.scale, h: size.h / vp.scale };
  const visible = items.filter((i) => i.type === "connector" || intersects(view, boxOf(i)));
  const peerSelections = peers.flatMap((p) => p.selection.map((id) => ({ id, color: p.color.fill })));
  const editingItem = editing ? byId.get(editing) : undefined;
  const selItems = selected.map((id) => byId.get(id)).filter((i): i is Item => Boolean(i));
  const single = selItems.length === 1 ? selItems[0] : undefined;
  const selBox = bounds(selItems.map((i) => (i.type === "connector" ? connectorBox(i, lookup) : boxOf(i))));
  const gridStep = ZOOM["grid-step"] * vp.scale;
  const drawingTool = tool === "pen" || tool === "highlighter";
  const cursorStyle = drag?.kind === "pan" ? "grabbing" : tool === "hand" || spaceDown ? "grab" : tool === "select" ? "default" : "crosshair";
  const types = new Set(selItems.map((i) => i.type));
  const allLocked = selItems.length > 0 && selItems.every((i) => i.locked);

  return (
    <div
      className="relative h-full w-full touch-none overflow-hidden bg-canvas-bg"
      style={{ cursor: cursorStyle }}
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
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: gridStep >= 8 ? "radial-gradient(var(--color-canvas-grid) 1.2px, transparent 1.2px)" : undefined,
          backgroundSize: `${gridStep}px ${gridStep}px`,
          backgroundPosition: `${vp.x}px ${vp.y}px`,
        }}
      />

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
            onWheel={onWheel}
            onDblClick={onDblClick}
            role="application"
            aria-label="Доска"
          >
            <Layer>
              {visible.map((i) => (
                <ItemView key={i.id} item={i} editing={editing === i.id} scale={vp.scale} lookup={lookup} onTransformEnd={onTransformEnd} />
              ))}
              {peerSelections.map(({ id, color }) => {
                const i = byId.get(id);
                if (!i) return null;
                const b = i.type === "connector" ? connectorBox(i, lookup) : boxOf(i);
                return <Rect key={`peer-${id}-${color}`} x={b.x - 3} y={b.y - 3} width={b.w + 6} height={b.h + 6} stroke={color} strokeWidth={2 / vp.scale} listening={false} />;
              })}
              {selItems.filter((i) => i.type === "connector" || i.locked || selItems.length > 1).map((i) => {
                const b = i.type === "connector" ? connectorBox(i, lookup) : boxOf(i);
                const pad = 4 / vp.scale;
                return <Rect key={`sel-${i.id}`} x={b.x - pad} y={b.y - pad} width={b.w + pad * 2} height={b.h + pad * 2} stroke={CANVAS.selection} strokeWidth={1.5 / vp.scale} dash={i.locked ? [4 / vp.scale, 3 / vp.scale] : undefined} listening={false} />;
              })}
              <DragPreview drag={drag} scale={vp.scale} shapeKind={shapeKind} ink={ink} highlighter={tool === "highlighter"} lookup={lookup} />
              <Transformer
                ref={trRef}
                rotateEnabled={false}
                flipEnabled={false}
                keepRatio={single?.type === "image"}
                enabledAnchors={single?.type === "text" ? ["middle-left", "middle-right"] : single?.type === "image" ? ["top-left", "top-right", "bottom-left", "bottom-right"] : undefined}
                borderStroke={CANVAS.selection}
                borderStrokeWidth={1.5}
                anchorStroke={CANVAS.selection}
                anchorFill={CANVAS.handle}
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
          vp={vp}
          onChange={(text) => {
            const patch: Patch = { text };
            if (editingItem.type === "text") {
              const w = editingItem.fixedWidth ? editingItem.w : autoTextWidth(text, editingItem.fontSize);
              patch.w = w;
              patch.h = textHeight(text, w, editingItem.fontSize);
            }
            updateItems(doc, [{ id: editingItem.id, patch }]);
          }}
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
      <ul aria-label="Объекты на доске" className="sr-only">
        {items.map((i) => (
          <li key={i.id}>{describe(i)}</li>
        ))}
      </ul>

      <div aria-hidden className="pointer-events-none absolute inset-0">
        {peers.map((p) =>
          p.cursor ? (
            <div
              key={p.clientId}
              className="absolute left-0 top-0 transition-transform duration-75 ease-linear"
              style={{ transform: `translate(${p.cursor.x * vp.scale + vp.x}px, ${p.cursor.y * vp.scale + vp.y}px)` }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18"><path d="M1 1l6 15 2.2-6.3L16 7.5z" fill={p.color.fill} stroke="#fff" strokeWidth="1.2" /></svg>
              <span className="ml-3 rounded-sm px-1.5 py-0.5 text-xs font-medium" style={{ background: p.color.fill, color: p.color.label }}>{p.name}</span>
            </div>
          ) : null,
        )}
      </div>

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
      <ShareDialog boardId={board.id} role={role} userId={user.id} linkAccess={board.linkAccess} open={shareOpen} onClose={() => setShareOpen(false)} />

      <nav aria-label="Инструменты" className="absolute left-3 top-1/2 flex max-h-[calc(100%-140px)] -translate-y-1/2 flex-col gap-1 overflow-y-auto rounded-md bg-bg p-1 shadow-toolbar">
        <ToolButton label={t.board.select} active={tool === "select"} onClick={() => setTool("select")}><MousePointer2 size={20} /></ToolButton>
        <ToolButton label={t.board.hand} active={tool === "hand"} onClick={() => setTool("hand")}><Hand size={20} /></ToolButton>
        {mayComment && <ToolButton label={t.comments.tool} active={tool === "comment"} onClick={() => setTool("comment")}><MessageCircle size={20} /></ToolButton>}
        {canEdit && (
          <>
            <ToolButton label={t.board.sticky} active={tool === "sticky"} onClick={() => setTool("sticky")}><StickyNote size={20} /></ToolButton>
            <ToolButton label={t.board.text} active={tool === "text"} onClick={() => setTool("text")}><Type size={20} /></ToolButton>
            <ToolButton label={t.board.shape} active={tool === "shape"} onClick={() => setTool("shape")}><ShapeIcon kind={shapeKind} size={20} /></ToolButton>
            <ToolButton label={t.board.connector} active={tool === "connector"} onClick={() => setTool("connector")}><MoveUpRight size={20} /></ToolButton>
            <ToolButton label={t.board.pen} active={tool === "pen"} onClick={() => setTool("pen")}><Pen size={20} /></ToolButton>
            <ToolButton label={t.board.highlighter} active={tool === "highlighter"} onClick={() => setTool("highlighter")}><Highlighter size={20} /></ToolButton>
            <ToolButton label={t.board.eraser} active={tool === "eraser"} onClick={() => setTool("eraser")}><Eraser size={20} /></ToolButton>
            <ToolButton label={t.board.frame} active={tool === "frame"} onClick={() => setTool("frame")}><Frame size={20} /></ToolButton>
            <ToolButton label={t.images.add} onClick={() => fileInput.current?.click()}><ImagePlus size={20} /></ToolButton>
            <div className="my-1 h-px shrink-0 bg-border" />
            <ToolButton label={t.board.undo} onClick={() => undo.undo()}><Undo2 size={20} /></ToolButton>
            <ToolButton label={t.board.redo} onClick={() => undo.redo()}><Redo2 size={20} /></ToolButton>
          </>
        )}
      </nav>

      {canEdit && (tool === "shape" || drawingTool || tool === "connector" || tool === "text") && (
        <div role="toolbar" aria-label="Настройки инструмента" className="absolute left-[68px] top-1/2 flex -translate-y-1/2 flex-col items-center gap-1 rounded-md bg-bg p-1 shadow-toolbar">
          {tool === "shape" &&
            (Object.keys(SHAPE_ICONS) as ShapeKind[]).map((k) => (
              <ToolButton key={k} small label={t.board.shapes[k]} active={shapeKind === k} onClick={() => setShapeKind(k)}><ShapeIcon kind={k} size={16} /></ToolButton>
            ))}
          <InkPicker value={ink} onChange={setInk} vertical />
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
                <div role="radiogroup" aria-label={t.board.fontSize} className="flex gap-0.5">
                  {FONT_SIZES.map((fs) => (
                    <button
                      key={fs}
                      role="radio"
                      aria-checked={single?.type === "text" && single.fontSize === fs}
                      onClick={() =>
                        updateItems(doc, selItems.flatMap((i) => {
                          if (i.type !== "text") return [];
                          const w = i.fixedWidth ? i.w : autoTextWidth(i.text, fs);
                          return [{ id: i.id, patch: { fontSize: fs, w, h: textHeight(i.text, w, fs) } }];
                        }))
                      }
                      className={`h-8 min-w-8 rounded-sm px-1 text-sm ${single?.type === "text" && single.fontSize === fs ? "bg-accent-subtle text-accent" : "hover:bg-surface-hover"}`}
                    >
                      {fs}
                    </button>
                  ))}
                </div>
              )}
              {single?.type === "connector" && (
                <>
                  <ToolButton small label={t.board.route} active={single.route === "elbow"} onClick={() => patchSelected({ route: single.route === "elbow" ? "straight" : "elbow" })}><CornerDownRight size={16} /></ToolButton>
                  <ToolButton small label={t.board.arrow} active={single.endArrow} onClick={() => patchSelected({ endArrow: !single.endArrow })}><ArrowRight size={16} /></ToolButton>
                </>
              )}
              {[...types].every((ty) => ty === "text" || ty === "shape" || ty === "connector" || ty === "drawing") && (
                <>
                  <Divider />
                  <InkPicker
                    value={single ? inkOf(single) : undefined}
                    onChange={(c) => updateItems(doc, selItems.filter((i) => !i.locked).map((i) => ({ id: i.id, patch: i.type === "text" ? { color: c } : { stroke: c } })))}
                  />
                </>
              )}
              <Divider />
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
      </div>
    </div>
  );
}

// ---------- helpers ----------

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
  const lock = i.locked ? " (закреплено)" : "";
  switch (i.type) {
    case "sticky":
      return `Стикер: ${i.text || "пустой"}${lock}`;
    case "text":
      return `Текст: ${i.text}${lock}`;
    case "shape":
      return `Фигура ${t.board.shapes[i.kind]}: ${i.text || "без текста"}${lock}`;
    case "connector":
      return `Линия${i.from.itemId && i.to.itemId ? " между объектами" : ""}${i.label ? `: ${i.label}` : ""}${lock}`;
    case "drawing":
      return `Рисунок${i.highlighter ? " маркером" : ""}${lock}`;
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

function DragPreview({ drag, scale, shapeKind, ink, highlighter, lookup }: { drag: Drag | null; scale: number; shapeKind: ShapeKind; ink: string; highlighter: boolean; lookup: (id: string) => Box | undefined }) {
  if (!drag) return null;
  if (drag.kind === "marquee") {
    const r = rectFrom(drag.start, drag.current);
    return <Rect x={r.x} y={r.y} width={r.w} height={r.h} fill="rgba(109,40,217,.06)" stroke={CANVAS.selection} strokeWidth={1 / scale} listening={false} />;
  }
  if (drag.kind === "create") {
    const r = rectFrom(drag.start, drag.current);
    if (drag.what === "shape" && shapeKind === "ellipse") {
      return <Ellipse x={r.x + r.w / 2} y={r.y + r.h / 2} radiusX={r.w / 2} radiusY={r.h / 2} stroke={ink} strokeWidth={2 / scale} dash={[6 / scale, 4 / scale]} listening={false} />;
    }
    return <Rect x={r.x} y={r.y} width={r.w} height={r.h} stroke={drag.what === "frame" ? CANVAS.selection : ink} strokeWidth={2 / scale} dash={[6 / scale, 4 / scale]} listening={false} />;
  }
  if (drag.kind === "connect") {
    const fb = drag.from.itemId ? lookup(drag.from.itemId) : undefined;
    const start = fb ? { x: fb.x + fb.w / 2, y: fb.y + fb.h / 2 } : drag.from;
    const hb = drag.hover ? lookup(drag.hover) : undefined;
    return (
      <>
        {hb && <Rect x={hb.x - 4} y={hb.y - 4} width={hb.w + 8} height={hb.h + 8} stroke={CANVAS.selection} strokeWidth={2 / scale} listening={false} />}
        <Arrow points={[start.x, start.y, drag.current.x, drag.current.y]} stroke={ink} fill={ink} strokeWidth={2 / scale} pointerLength={10 / scale} pointerWidth={10 / scale} listening={false} />
      </>
    );
  }
  if (drag.kind === "draw") {
    return <Line points={drag.points} stroke={ink} strokeWidth={highlighter ? 16 : 3} opacity={highlighter ? 0.35 : 1} lineCap="round" lineJoin="round" tension={0.4} listening={false} />;
  }
  return null;
}

function ToolButton({ label, active, small, onClick, children }: { label: string; active?: boolean; small?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
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

function InkPicker({ value, onChange, vertical }: { value?: string; onChange: (c: string) => void; vertical?: boolean }) {
  return (
    <div role="radiogroup" aria-label={t.board.ink} className={`flex gap-1 p-1 ${vertical ? "flex-col items-center" : ""}`}>
      {INK.map((c) => (
        <Swatch key={c} name={c} fill={c} checked={value === c} onClick={() => onChange(c)} />
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

function TextEditor({ item, vp, onChange, onDone }: { item: Extract<Item, { text: string }>; vp: Viewport; onChange: (t: string) => void; onDone: (text: string) => void }) {
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
    item.type === "sticky" ? stickyPair(item.color) : item.type === "shape" ? (item.fill === "none" ? { fill: "transparent", text: item.stroke } : stickyPair(item.fill)) : { fill: "transparent", text: item.color };
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
