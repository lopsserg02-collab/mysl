// Copying a board's content for "duplicate": a fresh document with the same items and no edit history.
import * as Y from "yjs";

/**
 * Takes a stored board state (Y.encodeStateAsUpdate) and returns the state of a new document holding the same items.
 * Image items point at assets of the source board; `assets` maps those asset ids to the copy's own asset ids.
 */
export function cloneBoardState(state: Uint8Array | null, assets: Map<string, string> = new Map()): Uint8Array {
  const src = new Y.Doc();
  if (state && state.length) Y.applyUpdate(src, state);
  const dst = new Y.Doc();
  const from = src.getMap<Y.Map<unknown>>("items");
  const to = dst.getMap<Y.Map<unknown>>("items");
  dst.transact(() => {
    from.forEach((m, id) => {
      const item = m.toJSON() as Record<string, unknown>;
      if (item.type === "image" && typeof item.assetId === "string" && assets.has(item.assetId)) {
        const next = assets.get(item.assetId)!;
        item.assetId = next;
        item.src = `/api/assets/${next}`;
      }
      const copy = new Y.Map<unknown>();
      for (const [k, v] of Object.entries(item)) copy.set(k, v);
      to.set(id, copy);
    });
    // Board settings (background, grid) come along too.
    const meta = dst.getMap("meta");
    src.getMap("meta").forEach((v, k) => meta.set(k, v));
  });
  return Y.encodeStateAsUpdate(dst);
}

/** Asset ids used by image items in a stored state, for tests and checks. */
export function imageAssetIds(state: Uint8Array): string[] {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const out: string[] = [];
  doc.getMap<Y.Map<unknown>>("items").forEach((m) => m.get("type") === "image" && out.push(String(m.get("assetId"))));
  return out;
}
