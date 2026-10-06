"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Stage, Layer, Group, Rect, Text, Transformer } from "react-konva";
import type Konva from "konva";
import { ArrowLeft, Hand, MousePointer2, StickyNote, Undo2, Redo2, ZoomIn, ZoomOut, Maximize, Copy, Trash2, BringToFront, SendToBack, WifiOff } from "lucide-react";
import type { BoardRole } from "@/lib/data/types";
import { t } from "@/lib/copy";
import { addSticky, bringToFront, deleteItems, duplicateItems, sendToBack, updateItems, type Item } from "@/lib/board/model";
import { CANVAS, STICKY_COLOR_NAMES, ZOOM, stickyPair } from "@/lib/board/palette";
import { fitFontSize, type Measure } from "@/lib/board/fit";
import { renameBoard } from "@/app/actions";
import { useBoardDoc } from "./useBoardDoc";
import { bounds, fitTo, intersects, stepZoom, toBoard, zoomAt, type Viewport } from "./viewport";

type Tool = "select" | "hand" | "sticky";
const PAD = 14;
const FONT = "Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

let measureCtx: CanvasRenderingContext2D | null = null;
const measure: Measure = (text, size) => {
  measureCtx ??= document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * size * 0.6;
  measureCtx.font = `${size}px ${FONT}`;
  return measureCtx.measureText(text).width;
};
const fitCache = new Map<string, number>();
function stickyFontSize(item: Item) {
  const key = `${item.w}x${item.h}:${item.text}`;
  let v = fitCache.get(key);
  if (v === undefined) {
    v = fitFontSize(item.text, { width: item.w - PAD * 2, height: item.h - PAD * 2 }, measure, { max: 40 });
    if (fitCache.size > 2000) fitCache.clear();
    fitCache.set(key, v);
  }
  return v;
}

type Drag =
  | { kind: "pan"; start: { x: number; y: number }; vp: Viewport }
  | { kind: "move"; start: { x: number; y: number }; orig: Map<string, { x: number; y: number }>; moved: boolean }
  | { kind: "marquee"; start: { x: number; y: number }; current: { x: number; y: number }; additive: boolean; base: string[] };

export function Board({ board, role, user }: { board: { id: string; name: string }; role: BoardRole; user: { id: string; name: string } }) {
  const canEdit = role === "owner" || role === "coowner" || role === "editor";
  const canRename = role === "owner" || role === "coowner";
  const { doc, provider, items, status, peers, undo, ready } = useBoardDoc(board.id, user);

  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [vp, setVp] = useState<Viewport>({ x: 0, y: 0, scale: 1 });
  const [tool, setTool] = useState<Tool>("select");
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const [name, setName] = useState(board.name);
  const fitted = useRef(false);
  // A new sticky opens its editor on pointer-up, so the click that made it does not steal focus.
  const pendingEdit = useRef<string | null>(null);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // Keep selection valid when items are removed by anyone.
  useEffect(() => {
    setSelected((s) => (s.every((id) => byId.has(id)) ? s : s.filter((id) => byId.has(id))));
    if (editing && !byId.has(editing)) setEditing(null);
  }, [byId, editing]);

  // Share what I have selected so others see it.
  useEffect(() => {
    provider?.awareness?.setLocalStateField("selection", selected);
  }, [provider, selected]);

  // Size the stage to the window.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // First view: fit what is on the board, or centre the origin.
  useEffect(() => {
    if (fitted.current || size.w === 0 || !ready) return;
    setVp(fitTo(bounds(items), size));
    fitted.current = true;
  }, [items, size, ready]);

  const fitAll = useCallback(() => setVp(fitTo(bounds(items), size)), [items, size]);
  const center = { x: size.w / 2, y: size.h / 2 };

  const pointer = () => stageRef.current?.getPointerPosition() ?? center;

  // ---------- actions ----------
  const placeSticky = (at: { x: number; y: number }) => {
    const s = addSticky(doc, at, user.id);
    setSelected([s.id]);
    pendingEdit.current = s.id;
    setTool("select");
  };
  const removeSelected = () => {
    if (!canEdit || selected.length === 0) return;
    deleteItems(doc, selected);
    setSelected([]);
  };
  const duplicateSelected = () => {
    if (!canEdit || selected.length === 0) return;
    setSelected(duplicateItems(doc, selected, user.id));
  };
  const nudge = (dx: number, dy: number) => {
    if (!canEdit) return;
    updateItems(doc, selected.flatMap((id) => {
      const i = byId.get(id);
      return i ? [{ id, patch: { x: i.x + dx, y: i.y + dy } }] : [];
    }));
  };

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable=true]")) return;
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
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (!canEdit) return;
        if (e.shiftKey) undo.redo();
        else undo.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        if (canEdit) undo.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelected();
        return;
      }
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(items.map((i) => i.id));
        return;
      }
      if (mod && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        setVp((v) => stepZoom(v, 1, center));
        return;
      }
      if (mod && e.key === "-") {
        e.preventDefault();
        setVp((v) => stepZoom(v, -1, center));
        return;
      }
      if (mod && e.key === "0") {
        e.preventDefault();
        setVp((v) => zoomAt(v, center, 1));
        return;
      }
      if (mod) return;
      if (e.shiftKey && (e.key === "!" || e.code === "Digit1")) return fitAll();
      switch (e.key) {
        case "v":
        case "V":
          return setTool("select");
        case "h":
        case "H":
          return setTool("hand");
        case "n":
        case "N":
          if (canEdit) setTool("sticky");
          return;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          return removeSelected();
        case "Escape":
          setSelected([]);
          return setTool("select");
        case "Enter":
          if (canEdit && selected.length === 1) {
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
  const hitItem = (e: Konva.KonvaEventObject<PointerEvent>): string | null => {
    let node: Konva.Node | null = e.target;
    while (node && node !== stageRef.current) {
      const id = node.getAttr("itemId");
      if (id) return id;
      node = node.getParent();
    }
    return null;
  };

  // Konva reports a double click for any two quick clicks; only count ones in the same spot.
  const lastDown = useRef({ x: 0, y: 0, prev: { x: -999, y: -999 } });

  const onPointerDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    const here = pointer();
    lastDown.current = { ...here, prev: { x: lastDown.current.x, y: lastDown.current.y } };
    if (editing) setEditing(null);
    const tr = trRef.current;
    if (tr && e.target.getParent() === tr) return; // resize handles
    const p = pointer();
    const panning = tool === "hand" || spaceDown || e.evt.button === 1 || e.evt.button === 2;
    if (panning) {
      setDrag({ kind: "pan", start: p, vp });
      return;
    }
    const id = hitItem(e);
    if (tool === "sticky" && canEdit) {
      placeSticky(toBoard(vp, p));
      return;
    }
    if (id) {
      const additive = e.evt.shiftKey;
      let next = selected;
      if (additive) next = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
      else if (!selected.includes(id)) next = [id];
      setSelected(next);
      if (canEdit && next.includes(id)) {
        const orig = new Map(next.flatMap((s) => {
          const i = byId.get(s);
          return i && !i.locked ? [[s, { x: i.x, y: i.y }] as const] : [];
        }));
        setDrag({ kind: "move", start: toBoard(vp, p), orig, moved: false });
      }
      return;
    }
    const b = toBoard(vp, p);
    setDrag({ kind: "marquee", start: b, current: b, additive: e.evt.shiftKey, base: e.evt.shiftKey ? selected : [] });
    if (!e.evt.shiftKey) setSelected([]);
  };

  // Broadcast my cursor from anywhere over the board, toolbars included, at most once per frame.
  const cursorFrame = useRef(0);
  const shareCursor = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const b = toBoard(vp, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    cancelAnimationFrame(cursorFrame.current);
    cursorFrame.current = requestAnimationFrame(() =>
      provider?.awareness?.setLocalStateField("cursor", { x: Math.round(b.x), y: Math.round(b.y) }),
    );
  };

  const onPointerMove = () => {
    const p = pointer();
    const b = toBoard(vp, p);
    if (!drag) return;
    if (drag.kind === "pan") {
      setVp({ ...drag.vp, x: drag.vp.x + (p.x - drag.start.x), y: drag.vp.y + (p.y - drag.start.y) });
    } else if (drag.kind === "move") {
      const dx = Math.round(b.x - drag.start.x);
      const dy = Math.round(b.y - drag.start.y);
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
      // One undo step for the whole drag.
      if (!drag.moved) undo.stopCapturing();
      updateItems(doc, [...drag.orig].map(([id, o]) => ({ id, patch: { x: o.x + dx, y: o.y + dy } })));
      if (!drag.moved) setDrag({ ...drag, moved: true });
    } else {
      const box = rectFrom(drag.start, b);
      const hits = items.filter((i) => intersects(box, { x: i.x, y: i.y, w: i.w, h: i.h })).map((i) => i.id);
      setSelected(Array.from(new Set([...drag.base, ...hits])));
      setDrag({ ...drag, current: b });
    }
  };

  const onPointerUp = () => {
    if (drag?.kind === "move" && drag.moved) undo.stopCapturing();
    setDrag(null);
    if (pendingEdit.current) {
      setEditing(pendingEdit.current);
      pendingEdit.current = null;
    }
  };

  const hideCursor = () => {
    cancelAnimationFrame(cursorFrame.current);
    provider?.awareness?.setLocalStateField("cursor", null);
  };

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const p = pointer();
    if (e.evt.ctrlKey || e.evt.metaKey) {
      // Pinch on a trackpad arrives as ctrl+wheel.
      const factor = Math.exp(-e.evt.deltaY * 0.01);
      setVp((v) => zoomAt(v, p, v.scale * factor));
    } else {
      const dx = e.evt.shiftKey ? e.evt.deltaY : e.evt.deltaX;
      const dy = e.evt.shiftKey ? 0 : e.evt.deltaY;
      setVp((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
    }
  };

  const onDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const { x, y, prev } = lastDown.current;
    if (!canEdit || Math.hypot(x - prev.x, y - prev.y) > 6) return;
    const id = hitItem(e as unknown as Konva.KonvaEventObject<PointerEvent>);
    if (id) {
      setSelected([id]);
      setEditing(id);
    } else {
      placeSticky(toBoard(vp, pointer()));
      setEditing(pendingEdit.current);
      pendingEdit.current = null;
    }
  };

  // ---------- transformer (resize) ----------
  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    const nodes = canEdit && !editing ? selected.map((id) => stage.findOne(`#item-${id}`)).filter((n): n is Konva.Node => Boolean(n)) : [];
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selected, items, canEdit, editing]);

  const onTransformEnd = () => {
    const tr = trRef.current;
    if (!tr) return;
    const changes = tr.nodes().map((n) => {
      const id = n.getAttr("itemId") as string;
      const i = byId.get(id)!;
      const w = Math.max(60, Math.round(i.w * n.scaleX()));
      const h = Math.max(60, Math.round(i.h * n.scaleY()));
      const patch = { x: Math.round(n.x()), y: Math.round(n.y()), w, h };
      n.scale({ x: 1, y: 1 });
      return { id, patch };
    });
    updateItems(doc, changes);
  };

  // ---------- render helpers ----------
  const view = { x: -vp.x / vp.scale, y: -vp.y / vp.scale, w: size.w / vp.scale, h: size.h / vp.scale };
  const visible = items.filter((i) => intersects(view, { x: i.x, y: i.y, w: i.w, h: i.h }));
  const peerSelections = peers.flatMap((p) => p.selection.map((id) => ({ id, color: p.color.fill })));
  const editingItem = editing ? byId.get(editing) : undefined;
  const single = selected.length === 1 ? byId.get(selected[0]) : undefined;
  const selBox = bounds(selected.map((id) => byId.get(id)).filter((i): i is Item => Boolean(i)));
  const gridStep = ZOOM["grid-step"] * vp.scale;
  const cursorStyle = drag?.kind === "pan" ? "grabbing" : tool === "hand" || spaceDown ? "grab" : tool === "sticky" ? "crosshair" : "default";

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-canvas-bg"
      style={{ cursor: cursorStyle }}
      onPointerMove={shareCursor}
      onPointerLeave={hideCursor}
      data-ready={ready || undefined}
    >
      {/* dot grid */}
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
              {visible.map((i) => {
                const pair = stickyPair(i.color);
                const fontSize = stickyFontSize(i);
                return (
                  <Group key={i.id} id={`item-${i.id}`} itemId={i.id} x={i.x} y={i.y} onTransformEnd={onTransformEnd}>
                    <Rect width={i.w} height={i.h} fill={pair.fill} shadowColor="#101828" shadowOpacity={0.12} shadowBlur={8 } shadowOffsetY={3} cornerRadius={2} />
                    {editing !== i.id && (
                      <Text
                        x={PAD}
                        y={PAD}
                        width={i.w - PAD * 2}
                        height={i.h - PAD * 2}
                        text={i.text}
                        fontSize={fontSize}
                        fontFamily={FONT}
                        lineHeight={1.3}
                        fill={pair.text}
                        align="center"
                        verticalAlign="middle"
                        wrap="word"
                        listening={false}
                      />
                    )}
                  </Group>
                );
              })}
              {peerSelections.map(({ id, color }) => {
                const i = byId.get(id);
                return i ? <Rect key={`peer-${id}-${color}`} x={i.x - 3} y={i.y - 3} width={i.w + 6} height={i.h + 6} stroke={color} strokeWidth={2 / vp.scale} listening={false} /> : null;
              })}
              {selBox && selected.length > 1 && (
                <Rect x={selBox.x} y={selBox.y} width={selBox.w} height={selBox.h} stroke={CANVAS.selection} strokeWidth={1 / vp.scale} dash={[4 / vp.scale, 4 / vp.scale]} listening={false} />
              )}
              {drag?.kind === "marquee" && (() => {
                const r = rectFrom(drag.start, drag.current);
                return <Rect x={r.x} y={r.y} width={r.w} height={r.h} fill="rgba(109,40,217,.06)" stroke={CANVAS.selection} strokeWidth={1 / vp.scale} listening={false} />;
              })()}
              <Transformer
                ref={trRef}
                rotateEnabled={false}
                flipEnabled={false}
                keepRatio={false}
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

      {/* text editor overlay */}
      {editingItem && (
        <StickyEditor
          key={editingItem.id}
          item={editingItem}
          vp={vp}
          onChange={(text) => updateItems(doc, [{ id: editingItem.id, patch: { text } }])}
          onDone={() => setEditing(null)}
        />
      )}

      {/* live cursors */}
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

      {/* top bar */}
      <header className="absolute left-3 right-3 top-3 flex items-start justify-between gap-3">
        <div className="flex h-12 items-center gap-1 rounded-md bg-bg px-2 shadow-toolbar">
          <Link href="/" aria-label={t.board.back} className="flex h-10 w-10 items-center justify-center rounded-sm hover:bg-surface-hover">
            <ArrowLeft size={18} aria-hidden />
          </Link>
          <span className="mx-1 text-sm font-semibold">{t.product}</span>
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
            className="h-8 w-48 rounded-sm bg-transparent px-2 hover:bg-surface-hover focus:bg-bg"
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
        </div>
      </header>

      {/* creation toolbar */}
      <nav aria-label="Инструменты" className="absolute left-3 top-1/2 flex -translate-y-1/2 flex-col gap-1 rounded-md bg-bg p-1 shadow-toolbar">
        <ToolButton label={t.board.select} active={tool === "select"} onClick={() => setTool("select")}><MousePointer2 size={20} /></ToolButton>
        <ToolButton label={t.board.hand} active={tool === "hand"} onClick={() => setTool("hand")}><Hand size={20} /></ToolButton>
        {canEdit && (
          <>
            <ToolButton label={t.board.sticky} active={tool === "sticky"} onClick={() => setTool("sticky")}><StickyNote size={20} /></ToolButton>
            <div className="my-1 h-px bg-border" />
            <ToolButton label={t.board.undo} onClick={() => undo.undo()}><Undo2 size={20} /></ToolButton>
            <ToolButton label={t.board.redo} onClick={() => undo.redo()}><Redo2 size={20} /></ToolButton>
          </>
        )}
      </nav>

      {/* context toolbar */}
      {canEdit && selBox && !drag && tool === "select" && (
        <div
          role="toolbar"
          aria-label="Свойства выбранного"
          className="absolute flex max-w-[calc(100%-16px)] flex-wrap items-center gap-1 rounded-md bg-bg p-1 shadow-pop"
          style={{
            left: Math.max(8, Math.min(size.w - 420, selBox.x * vp.scale + vp.x)),
            top: Math.max(68, selBox.y * vp.scale + vp.y - 56),
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div role="radiogroup" aria-label={t.board.colour} className="flex gap-0.5 px-1">
            {STICKY_COLOR_NAMES.map((c) => (
              <button
                key={c}
                role="radio"
                aria-checked={single?.color === c}
                aria-label={c}
                title={c}
                onClick={() => updateItems(doc, selected.map((id) => ({ id, patch: { color: c } })))}
                className={`h-6 w-6 rounded-full border border-border ${single?.color === c ? "ring-2 ring-selection ring-offset-1" : ""}`}
                style={{ background: stickyPair(c).fill }}
              />
            ))}
          </div>
          <div className="mx-1 h-6 w-px bg-border" />
          <ToolButton small label={t.board.duplicate} onClick={duplicateSelected}><Copy size={16} /></ToolButton>
          <ToolButton small label={t.board.front} onClick={() => bringToFront(doc, selected)}><BringToFront size={16} /></ToolButton>
          <ToolButton small label={t.board.back2} onClick={() => sendToBack(doc, selected)}><SendToBack size={16} /></ToolButton>
          <ToolButton small label={t.board.remove} onClick={removeSelected}><Trash2 size={16} /></ToolButton>
        </div>
      )}

      {/* empty state */}
      {items.length === 0 && ready && canEdit && (
        <p className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-bg px-4 py-2 text-text-muted shadow-card">
          {t.board.emptyHint}
        </p>
      )}

      {/* navigation */}
      <div className="absolute bottom-3 right-3 flex h-12 items-center gap-1 rounded-md bg-bg px-1 shadow-toolbar">
        <ToolButton label={t.board.zoomOut} onClick={() => setVp((v) => stepZoom(v, -1, center))}><ZoomOut size={18} /></ToolButton>
        <button
          className="h-10 min-w-14 rounded-sm px-2 text-sm tabular-nums hover:bg-surface-hover"
          onClick={() => setVp((v) => zoomAt(v, center, 1))}
          aria-label="Масштаб 100%"
        >
          {Math.round(vp.scale * 100)}%
        </button>
        <ToolButton label={t.board.zoomIn} onClick={() => setVp((v) => stepZoom(v, 1, center))}><ZoomIn size={18} /></ToolButton>
        <ToolButton label={t.board.fit} onClick={fitAll}><Maximize size={18} /></ToolButton>
      </div>
    </div>
  );
}

function rectFrom(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

function ToolButton({ label, active, small, onClick, children }: { label: string; active?: boolean; small?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex items-center justify-center rounded-sm ${small ? "h-8 w-8" : "h-10 w-10"} ${active ? "bg-accent-subtle text-accent" : "text-text hover:bg-surface-hover"}`}
    >
      <span aria-hidden className="contents">{children}</span>
    </button>
  );
}

function Avatar({ name, color, label }: { name: string; color: string; label: string }) {
  return (
    <span
      title={label}
      aria-label={label}
      role="img"
      className="flex h-8 w-8 items-center justify-center rounded-full border-2 bg-surface text-xs font-semibold"
      style={{ borderColor: color }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function StickyEditor({ item, vp, onChange, onDone }: { item: Item; vp: Viewport; onChange: (t: string) => void; onDone: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pair = stickyPair(item.color);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  return (
    <textarea
      ref={ref}
      aria-label="Текст стикера"
      placeholder={t.board.stickyPlaceholder}
      defaultValue={item.text}
      maxLength={6000}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          onDone();
        }
      }}
      className="absolute resize-none overflow-hidden border-0 bg-transparent text-center outline-none"
      style={{
        left: item.x * vp.scale + vp.x,
        top: item.y * vp.scale + vp.y,
        width: item.w,
        height: item.h,
        padding: PAD,
        transform: `scale(${vp.scale})`,
        transformOrigin: "top left",
        fontFamily: FONT,
        fontSize: stickyFontSize(item),
        lineHeight: 1.3,
        color: pair.text,
        background: pair.fill,
        paddingTop: Math.max(PAD, (item.h - stickyFontSize(item) * 1.3 * Math.max(1, item.text.split("\n").length)) / 2),
      }}
    />
  );
}
