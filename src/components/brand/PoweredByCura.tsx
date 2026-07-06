import type { CSSProperties } from "react";

/**
 * Selo institucional "por Rede D'Or" usando o grid mark do CURA.
 *
 * O `logoCura.svg` completo tem o wordmark "CURA" com `fill="white"` — invisível
 * em fundos claros. Reaproveitamos apenas o grid mark (paths coloridos à direita
 * do wordmark: navy #003DA5, azul claro #71C5E8, teal #2CD5C4) que funciona em
 * qualquer fundo. Uso: co-branding compacto no header ao lado do ExactaLogo.
 */
export const PoweredByCura = ({
  size = 22,
  title = "por Rede D'Or",
  className,
  style,
}: {
  size?: number;
  title?: string;
  className?: string;
  style?: CSSProperties;
}) => (
  <svg
    role="img"
    aria-label={title}
    width={size}
    height={size}
    viewBox="287 41 63 63"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={style}
  >
    <title>{title}</title>
    <path d="M308.454 96.6122L294.507 96.6122C290.723 96.6122 287.655 93.5447 287.655 89.7614L287.655 48.1687C287.655 44.388 290.723 41.3206 294.507 41.3206L336.103 41.3206C339.887 41.3206 342.952 44.388 342.952 48.1687L342.952 62.1169C342.952 65.9002 339.884 68.9677 336.103 68.9677L322.154 68.9677C318.37 68.9677 315.305 72.0352 315.305 75.8185L315.305 89.7667C315.305 93.55 312.237 96.6175 308.454 96.6175" fill="#003DA5" />
    <path d="M319.729 103.66L307.491 103.66C304.171 103.66 301.479 100.969 301.479 97.6492L301.479 61.1537C301.479 57.8363 304.171 55.1448 307.491 55.1448L343.99 55.1448C347.31 55.1448 350 57.8363 350 61.1537L350 73.3925C350 76.7122 347.308 79.4038 343.99 79.4038L331.75 79.4038C328.43 79.4038 325.741 82.0953 325.741 85.415L325.741 97.6539C325.741 100.974 323.049 103.665 319.729 103.665" fill="#71C5E8" />
    <g style={{ mixBlendMode: "multiply" }}>
      <path fillRule="evenodd" clipRule="evenodd" d="M301.511 96.6121L308.454 96.6121L308.454 96.6174C312.237 96.6174 315.305 93.5499 315.305 89.7666L315.305 75.8184C315.305 72.0351 318.37 68.9676 322.154 68.9676L336.103 68.9676C339.884 68.9676 342.952 65.9001 342.952 62.1168L342.952 55.1447L307.524 55.1447C304.204 55.1447 301.511 57.8368 301.511 61.1549L301.511 96.6121Z" fill="#003DA5" fillOpacity="0.4" />
    </g>
    <path d="M350 89.5699C350 86.7255 347.695 84.4197 344.85 84.4197H333.466C331.968 84.4197 330.755 85.6333 330.755 87.1303V98.515C330.755 101.359 333.061 103.665 335.905 103.665H344.85C347.695 103.665 350 101.359 350 98.515V89.5699Z" fill="#2CD5C4" />
  </svg>
);
