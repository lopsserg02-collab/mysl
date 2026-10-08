"use client";
import { memo, useEffect, useState } from "react";
import { Group, Rect, Shape, Text, Ellipse, Line, Arrow, Image as KImage } from "react-konva";
import { connectorPoints, type Box, type Item } from "@/lib/board/model";
import { CANVAS, inkOn, stickyPair, type BoardLook } from "@/lib/board/palette";
import { FONT, PAD, fittedFontSize, fontStyleOf } from "./text";

const SHADOW = CANVAS.shadow;

export interface ItemViewProps {
  item: Item;
  editing: boolean;
  /** Only frames, connectors and drawings draw differently with zoom; the board passes 1 to the rest so zooming skips them. */
  scale: number;
  /** "low" when the board is zoomed far out: no shadows and no text, which is unreadable there anyway. */
  detail: Detail;
  /** The items a connector's ends are attached to. */
  from?: Box;
  to?: Box;
  onTransformEnd?: () => void;
  /** The board's background colours: the default ink and frames follow it. */
  look: BoardLook;
}
export type Detail = "full" | "low";


/** One board item drawn with Konva. Every node carries `itemId` so hit-testing can find the item. */
export const ItemView = memo(function ItemView({ item: i, editing, scale, detail, from, to, onTransformEnd, look }: ItemViewProps) {
  const low = detail === "low";
  if (low && (i.type === "sticky" || i.type === "text" || i.type === "shape")) {
    // Far out, one plain node per item: thousands of them are on screen and every node costs a little to draw.
    const fill = i.type === "sticky" ? stickyPair(i.color).fill : i.type === "text" ? inkOn(look, i.color) : i.fill === "none" ? "transparent" : stickyPair(i.fill).fill;
    return (
      <Rect
        id={`item-${i.id}`}
        itemId={i.id}
        x={i.x}
        y={i.y}
        width={i.w}
        height={i.h}
        fill={fill}
        opacity={i.type === "text" ? 0.2 : 1}
        stroke={i.type === "shape" ? inkOn(look, i.stroke) : undefined}
        strokeWidth={i.type === "shape" ? 1 : 0}
        strokeScaleEnabled={false}
        perfectDrawEnabled={false}
        onTransformEnd={onTransformEnd}
      />
    );
  }
  switch (i.type) {
    case "sticky": {
      const pair = stickyPair(i.color);
      return (
        <Group id={`item-${i.id}`} itemId={i.id} x={i.x} y={i.y} onTransformEnd={onTransformEnd}>
          {/* A soft shadow from two offset translucent layers: a canvas blur on every note costs more than the rest
              of the frame. Its own size is the note's, so selection handles hug the note, not the shadow. */}
          <Shape
            width={i.w}
            height={i.h}
            listening={false}
            perfectDrawEnabled={false}
            sceneFunc={(ctx) => {
              ctx.setAttr("fillStyle", SHADOW);
              ctx.setAttr("globalAlpha", 0.05);
              ctx.fillRect(-1, 2, i.w + 2, i.h + 4);
              ctx.setAttr("globalAlpha", 0.08);
              ctx.fillRect(0, 1, i.w, i.h + 1);
            }}
          />
          <Rect width={i.w} height={i.h} fill={pair.fill} cornerRadius={2} perfectDrawEnabled={false} />
          {!editing && <BoxText item={i} color={pair.text} />}
        </Group>
      );
    }
    case "text":
      return (
        <Group id={`item-${i.id}`} itemId={i.id} x={i.x} y={i.y} onTransformEnd={onTransformEnd}>
          {/* transparent hit area so empty space inside a text box is clickable */}
          <Rect width={i.w} height={i.h} fill="transparent" perfectDrawEnabled={false} />
          {!editing && (
            <Text
              width={i.w}
              text={i.text}
              fontSize={i.fontSize}
              fontFamily={FONT}
              fontStyle={fontStyleOf(i) || "normal"}
              textDecoration={i.underline ? "underline" : ""}
              lineHeight={1.3}
              fill={inkOn(look, i.color)}
              wrap="word"
              listening={false}
            />
          )}
        </Group>
      );
    case "shape": {
      const fill = i.fill === "none" ? "transparent" : stickyPair(i.fill).fill;
      const stroke = inkOn(look, i.stroke);
      const textColor = i.fill === "none" ? stroke : stickyPair(i.fill).text;
      const common = { fill, stroke, strokeWidth: 2, strokeScaleEnabled: false, perfectDrawEnabled: false };
      return (
        <Group id={`item-${i.id}`} itemId={i.id} x={i.x} y={i.y} onTransformEnd={onTransformEnd}>
          {i.kind === "ellipse" ? (
            <Ellipse x={i.w / 2} y={i.h / 2} radiusX={i.w / 2} radiusY={i.h / 2} {...common} />
          ) : i.kind === "triangle" ? (
            <Line points={[i.w / 2, 0, i.w, i.h, 0, i.h]} closed {...common} />
          ) : i.kind === "diamond" ? (
            <Line points={[i.w / 2, 0, i.w, i.h / 2, i.w / 2, i.h, 0, i.h / 2]} closed {...common} />
          ) : (
            <Rect width={i.w} height={i.h} cornerRadius={i.kind === "round" ? Math.min(i.w, i.h) * 0.15 : 0} {...common} />
          )}
          {!editing && <BoxText item={i} color={textColor} />}
        </Group>
      );
    }
    case "drawing":
      return (
        <Group id={`item-${i.id}`} itemId={i.id} x={i.x} y={i.y} onTransformEnd={onTransformEnd}>
          <Line
            points={i.points}
            stroke={inkOn(look, i.stroke)}
            strokeWidth={i.width}
            opacity={i.highlighter ? 0.35 : 1}
            lineCap="round"
            lineJoin="round"
            tension={0.4}
            hitStrokeWidth={Math.max(i.width, 12 / scale)}
          />
        </Group>
      );
    case "image":
      return (
        <Group id={`item-${i.id}`} itemId={i.id} x={i.x} y={i.y} onTransformEnd={onTransformEnd}>
          <BoardImage src={i.src} w={i.w} h={i.h} />
        </Group>
      );
    case "frame":
      return (
        <Group id={`item-${i.id}`} itemId={i.id} x={i.x} y={i.y} onTransformEnd={onTransformEnd}>
          <Text
            y={-22 / scale}
            text={i.title || "Рамка"}
            fontSize={13 / scale}
            fontFamily={FONT}
            fill={look["frame-title"]}
            itemId={i.id}
            frameTitle
          />
          <Rect width={i.w} height={i.h} fill={look["frame-fill"]} stroke={look["frame-border"]} strokeWidth={1} strokeScaleEnabled={false} />
        </Group>
      );
    case "connector": {
      const pts = connectorPoints(i, (id) => (id === i.from.itemId ? from : id === i.to.itemId ? to : undefined));
      const mid = midpoint(pts);
      const stroke = inkOn(look, i.stroke);
      return (
        <Group id={`item-${i.id}`} itemId={i.id}>
          <Arrow
            points={pts}
            stroke={stroke}
            fill={stroke}
            strokeWidth={2}
            strokeScaleEnabled={false}
            pointerLength={10}
            pointerWidth={10}
            pointerAtEnding={i.endArrow}
            pointerAtBeginning={i.startArrow}
            hitStrokeWidth={14 / scale}
            lineJoin="round"
          />
          {i.label && (
            <Text x={mid.x} y={mid.y} offsetX={60} offsetY={10} width={120} align="center" text={i.label} fontSize={14} fontFamily={FONT} fill={stroke} padding={2} />
          )}
        </Group>
      );
    }
  }
});

// Loaded images are shared between every view of the same picture.
const cache = new Map<string, HTMLImageElement>();

/** The picture if it has loaded already (starts loading it otherwise): for drawing far out without a node per image. */
export function loadedImage(src: string): HTMLImageElement | undefined {
  let el = cache.get(src);
  if (!el) {
    el = new window.Image();
    el.src = src;
    cache.set(src, el);
  }
  return el.complete && el.naturalWidth ? el : undefined;
}

/** Resolves once every picture has loaded (or failed), so an export does not catch placeholders. */
export function preloadImages(srcs: string[]): Promise<void> {
  return Promise.all(
    srcs.map((src) => {
      let el = cache.get(src);
      if (!el) {
        el = new window.Image();
        el.src = src;
        cache.set(src, el);
      }
      const img = el;
      return img.complete ? Promise.resolve() : new Promise<void>((done) => {
        img.addEventListener("load", () => done(), { once: true });
        img.addEventListener("error", () => done(), { once: true });
      });
    }),
  ).then(() => undefined);
}

function BoardImage({ src, w, h }: { src: string; w: number; h: number }) {
  const [img, setImg] = useState<HTMLImageElement | null>(() => (cache.get(src)?.complete ? cache.get(src)! : null));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let el = cache.get(src);
    if (!el) {
      el = new window.Image();
      el.src = src;
      cache.set(src, el);
    }
    if (el.complete && el.naturalWidth) return setImg(el);
    const ok = () => setImg(el!);
    const bad = () => setFailed(true);
    el.addEventListener("load", ok);
    el.addEventListener("error", bad);
    return () => {
      el!.removeEventListener("load", ok);
      el!.removeEventListener("error", bad);
    };
  }, [src]);
  // Placeholder while loading (or if the file is gone) keeps the item visible and clickable.
  if (!img) return <Rect width={w} height={h} fill={failed ? CANVAS.placeholderFailed : CANVAS.placeholder} stroke={CANVAS.placeholderBorder} strokeWidth={1} strokeScaleEnabled={false} />;
  return <KImage image={img} width={w} height={h} />;
}

function BoxText({ item, color }: { item: Extract<Item, { type: "sticky" | "shape" }>; color: string }) {
  return (
    <Text
      x={PAD}
      y={PAD}
      width={item.w - PAD * 2}
      height={item.h - PAD * 2}
      text={item.text}
      fontSize={fittedFontSize(item)}
      fontFamily={FONT}
      lineHeight={1.3}
      fill={color}
      align="center"
      verticalAlign="middle"
      wrap="word"
      listening={false}
    />
  );
}

function midpoint(pts: number[]) {
  // Middle of the polyline by length.
  let total = 0;
  const seg: number[] = [];
  for (let k = 0; k < pts.length - 2; k += 2) {
    const l = Math.hypot(pts[k + 2] - pts[k], pts[k + 3] - pts[k + 1]);
    seg.push(l);
    total += l;
  }
  let half = total / 2;
  for (let s = 0; s < seg.length; s++) {
    if (half <= seg[s]) {
      const t = seg[s] ? half / seg[s] : 0;
      return { x: pts[s * 2] + (pts[s * 2 + 2] - pts[s * 2]) * t, y: pts[s * 2 + 1] + (pts[s * 2 + 3] - pts[s * 2 + 1]) * t };
    }
    half -= seg[s];
  }
  return { x: pts[0], y: pts[1] };
}
