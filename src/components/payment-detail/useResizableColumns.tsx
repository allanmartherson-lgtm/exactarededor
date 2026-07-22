import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Hook para colunas redimensionáveis estilo Excel.
// Persiste larguras em localStorage por `storageKey`.
// Uso:
//   const { colStyle, ResizeHandle } = useResizableColumns("items-grid");
//   <col style={colStyle("data", 108)} />
//   <th className="relative">Data <ResizeHandle colKey="data" defaultWidth={108} /></th>

type WidthMap = Record<string, number>;

export function useResizableColumns(storageKey: string, scale: number = 1) {
  const [widths, setWidths] = useState<WidthMap>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as WidthMap) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(widths));
    } catch {
      // ignore quota
    }
  }, [storageKey, widths]);

  // getWidth retorna a largura base (não escalada) — usado pelo handle de
  // redimensionamento para que o usuário arraste em pixels reais.
  const getWidth = useCallback(
    (key: string, def: number) => widths[key] ?? def,
    [widths],
  );

  const setWidth = useCallback((key: string, w: number) => {
    setWidths((prev) => ({ ...prev, [key]: Math.max(40, Math.round(w)) }));
  }, []);

  const resetWidth = useCallback((key: string) => {
    setWidths((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  // colStyle já aplica o fator de escala (zoom) na largura final, para que as
  // colunas cresçam junto com a fonte e o scroll horizontal acompanhe.
  const colStyle = useCallback(
    (key: string, def: number): React.CSSProperties => ({
      width: Math.round(getWidth(key, def) * scale),
    }),
    [getWidth, scale],
  );

  const ResizeHandle = useMemo(() => {
    const Component: React.FC<{ colKey: string; defaultWidth: number }> = ({
      colKey,
      defaultWidth,
    }) => {
      const startRef = useRef<{ x: number; w: number } | null>(null);

      const onMouseDown = (e: React.MouseEvent<HTMLSpanElement>) => {
        e.preventDefault();
        e.stopPropagation();
        startRef.current = { x: e.clientX, w: getWidth(colKey, defaultWidth) };
        const prevCursor = document.body.style.cursor;
        document.body.style.cursor = "col-resize";
        const onMove = (ev: MouseEvent) => {
          if (!startRef.current) return;
          const delta = ev.clientX - startRef.current.x;
          setWidth(colKey, startRef.current.w + delta);
        };
        const onUp = () => {
          startRef.current = null;
          document.body.style.cursor = prevCursor;
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      };

      const onDoubleClick = (e: React.MouseEvent<HTMLSpanElement>) => {
        e.stopPropagation();
        resetWidth(colKey);
      };

      return (
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label="Redimensionar coluna (duplo clique para restaurar)"
          onMouseDown={onMouseDown}
          onDoubleClick={onDoubleClick}
          className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize select-none hover:bg-primary/40 active:bg-primary/60"
        />
      );
    };
    return Component;
  }, [getWidth, setWidth, resetWidth]);

  return { getWidth, setWidth, resetWidth, colStyle, ResizeHandle };
}
