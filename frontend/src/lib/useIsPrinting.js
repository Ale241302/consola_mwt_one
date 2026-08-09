// MWT.ONE · lib/useIsPrinting.js
// Detecta @media print vía matchMedia + beforeprint/afterprint.
// Ola 3 · 3.27 · Virtualización.
import { useEffect, useState } from "react";

export function useIsPrinting() {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("print");
    const on = (e) => setPrinting(e.matches);
    const onBefore = () => setPrinting(true);
    const onAfter = () => setPrinting(false);
    on(mq);
    mq.addEventListener?.("change", on);
    window.addEventListener("beforeprint", onBefore);
    window.addEventListener("afterprint", onAfter);
    return () => {
      mq.removeEventListener?.("change", on);
      window.removeEventListener("beforeprint", onBefore);
      window.removeEventListener("afterprint", onAfter);
    };
  }, []);
  return printing;
}
