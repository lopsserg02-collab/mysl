"use client";
import { memo, useEffect, useState } from "react";
import { Group, Rect, Text, Ellipse, Line, Arrow, Image as KImage } from "react-konva";
import { connectorPoints, type Box, type Item } from "@/lib/board/model";
import { FRAME, stickyPair } from "@/lib/board/palette";
import { FONT, PAD, fittedFontSize } from "./text";

export interface ItemViewProps {
  item: Item;
  editing: boolean;
  scale: number;
  lookup: (id: string) => Box | undefined;
  onTransformEnd?: () => void;
}

/** One board item drawn with Konva. Every node carries `itemId` so hit-testing can find the item. */
export const ItemView = memo(function ItemView({ item: i, editing, scale, lookup, onTransformEnd }: ItemViewProps) {
  switch (i.type) {
    case "sticky": {
      const pair = stickyPair(i.color);
      return (
        <Group id={`item-${i.id}`} itemId={i.id} x={i.x} y={i.y} onTransformEnd={onTransformEnd}>
          <Rect width={i.w} height={i.h} fill={pair.fill} shadowColor="#101828" shadowOpacity={0.12} shadowBlur={8} shadowOffsetY={3} cornerRadius={2} />
          {!editing && <BoxText item={i} color={pair.text} />}
        </Group>
      );
    }
    case "text":
      return (
        <Group id={`item-${i.id}`} itemId={i.id} x={i.x} y={i.y} onTransformEnd={onTransformEnd}>
          {/* transparent hit area so empty space inside a text box is clickable */}
          <Rect width={i.w} height={i.h} fill="transparent" />
          {!editing && (
            <Text width={i.w} text={i.text} fontSize={i.fontSize} fontFamily={FONT} lineHeight={1.3} fill={i.color} wrap="word" listening={false} />
          )}
        </Group>
      );
    case "shape": {
      const fill = i.fill === "none" ? "transparent" : stickyPair(i.fill).fill;
      const textColor = i.fill === "none" ? i.stroke : stickyPair(i.fill).text;
      const common = { fill, stroke: i.stroke, strokeWidth: 2, strokeScaleEnabled: false };
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
            stroke={i.stroke}
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
            fill={FRAME.title}
            itemId={i.id}
            frameTitle
          />
          <Rect width={i.w} height={i.h} fill={FRAME.fill} stroke={FRAME.border} strokeWidth={1} strokeScaleEnabled={false} />
        </Group>
      );
    case "connector": {
      const pts = connectorPoints(i, lookup);
      const mid = midpoint(pts);
      return (
        <Group id={`item-${i.id}`} itemId={i.id}>
          <Arrow
            points={pts}
            stroke={i.stroke}
            fill={i.stroke}
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
            <Text x={mid.x} y={mid.y} offsetX={60} offsetY={10} width={120} align="center" text={i.label} fontSize={14} fontFamily={FONT} fill={i.stroke} padding={2} />
          )}
        </Group>
      );
    }
  }
});

// Loaded images are shared between every view of the same picture.
const cache = new Map<string, HTMLImageElement>();

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
  if (!img) return <Rect width={w} height={h} fill={failed ? "#fde8e8" : "#eceef2"} stroke="#d0d5dd" strokeWidth={1} strokeScaleEnabled={false} />;
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
