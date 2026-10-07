"use client";
import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { itemsMap, readAll, type Item } from "@/lib/board/model";
import { colorForUser } from "@/lib/board/palette";

export type ConnStatus = "connecting" | "connected" | "offline";

export interface Peer {
  clientId: number;
  userId: string;
  name: string;
  color: { fill: string; label: string };
  cursor: { x: number; y: number } | null;
  selection: string[];
}

async function fetchToken(boardId: string): Promise<string> {
  const res = await fetch("/api/realtime-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ boardId }),
  });
  if (!res.ok) throw new Error(`token ${res.status}`);
  return (await res.json()).token;
}

export function useBoardDoc(boardId: string, user: { id: string; name: string }) {
  const doc = useMemo(() => new Y.Doc(), [boardId]);
  const [provider, setProvider] = useState<HocuspocusProvider | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [peers, setPeers] = useState<Peer[]>([]);
  // True once the board content is loaded, from this browser's copy or from the server.
  const [ready, setReady] = useState(false);
  const undo = useMemo(() => new Y.UndoManager(itemsMap(doc), { captureTimeout: 400 }), [doc]);

  useEffect(() => {
    // Offline first: the board opens from the browser's copy, then merges with the server.
    const local = new IndexeddbPersistence(`mysl-board-${boardId}`, doc);
    let localLoaded = false;
    local.whenSynced.then(() => {
      localLoaded = true;
      // An empty local copy says nothing; wait for the server unless we are offline.
      if (itemsMap(doc).size > 0) setReady(true);
    });
    const url = process.env.NEXT_PUBLIC_REALTIME_URL ?? "ws://localhost:1234";
    const p = new HocuspocusProvider({
      url,
      name: `board:${boardId}`,
      document: doc,
      token: () => fetchToken(boardId),
      onStatus: ({ status }) => {
        setStatus(status === "connected" ? "connected" : status === "connecting" ? "connecting" : "offline");
        if (status === "disconnected" && localLoaded) setReady(true);
      },
      onSynced: () => setReady(true),
    });
    const color = colorForUser(user.id);
    p.awareness?.setLocalStateField("user", { userId: user.id, name: user.name, color });

    const readPeers = () => {
      const out: Peer[] = [];
      p.awareness?.getStates().forEach((s, clientId) => {
        if (clientId === doc.clientID || !s.user) return;
        out.push({ clientId, ...s.user, cursor: s.cursor ?? null, selection: s.selection ?? [] });
      });
      setPeers(out);
    };
    p.awareness?.on("change", readPeers);

    const sync = () => setItems(readAll(doc));
    itemsMap(doc).observeDeep(sync);
    sync();
    setProvider(p);

    return () => {
      itemsMap(doc).unobserveDeep(sync);
      p.awareness?.off("change", readPeers);
      p.destroy();
      local.destroy();
    };
  }, [boardId, doc, user.id, user.name]);

  return { doc, provider, items, status, peers, undo, ready };
}
