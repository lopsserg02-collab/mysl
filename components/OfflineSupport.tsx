"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

const BOARD = /^\/board\/[0-9a-f-]{36}$/;

/**
 * Production only: registers the service worker (app/sw.js) so a board opened before loads with no network.
 * On a board page it asks the worker to keep that page and the build files it used; on the sign-in page
 * (signing in or out) it asks the worker to forget every kept page.
 */
export function OfflineSupport() {
  const path = usePathname();

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const forget = path === "/login";
    // Guest links carry the secret in the query string: never kept.
    const remember = BOARD.test(path) && !location.search;
    if (!forget && !remember) return;
    let cancelled = false;
    // A moment after the board appears, so the files it loads on demand (the canvas) are in the list too.
    const timer = setTimeout(() => {
      navigator.serviceWorker.ready.then((reg) => {
        if (cancelled || !reg.active) return;
        if (forget) return reg.active.postMessage({ type: "forget-pages" });
        const assets = performance
          .getEntriesByType("resource")
          .map((e) => e.name)
          .filter((n) => n.startsWith(`${location.origin}/_next/static/`));
        reg.active.postMessage({ type: "remember-board", path, assets });
      });
    }, forget ? 0 : 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [path]);

  return null;
}
