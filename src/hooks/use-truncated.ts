import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Detecta se o conteúdo de um elemento está sendo truncado
 * (line-clamp, text-overflow, etc.). Reavalia ao redimensionar.
 */
export function useTruncated<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // scrollHeight > clientHeight pega line-clamp; scrollWidth > clientWidth pega ellipsis em 1 linha.
    const truncated =
      el.scrollHeight - el.clientHeight > 1 || el.scrollWidth - el.clientWidth > 1;
    setIsTruncated(truncated);
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  return { ref, isTruncated };
}
