"use client";

import { useEffect } from "react";

/** Dang ky Service Worker (chi luu /faq, /guide va tep tinh, xem public/sw.js) va cho phep cai app len man hinh chinh. */
export function PwaRegistrar() {
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      process.env.NODE_ENV === "test"
    ) {
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("Service worker registration failed:", err);
    });
  }, []);

  return null;
}
