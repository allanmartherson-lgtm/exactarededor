import { cn } from "@/lib/utils";

/**
 * Zeev — Ícone oficial (sparkle 4-pontas + acento "+").
 * Usado como identidade visual do assistente Zeev em todo o app.
 *
 * Variantes:
 *  - "mark": só o sparkle, em currentColor. Use em badges/botões onde o
 *    container já tem cor de fundo (ex.: FAB primário, avatares).
 *  - "circle": versão selada com círculo azul Zeev (#2D7BF4) + sparkle branco.
 *    Use como logo standalone (headers de chat, cards).
 */
export interface ZeevIconProps extends React.SVGAttributes<SVGSVGElement> {
  size?: number;
  variant?: "mark" | "circle";
}

/** Path do sparkle 4-pontas (losango com cinturas côncavas), centrado em (cx, cy). */
function sparklePath(cx: number, cy: number, r: number) {
  // controle das "cinturas" do sparkle (quanto menor, mais fino o losango)
  const k = r * 0.32;
  return [
    `M${cx} ${cy - r}`,
    `C${cx + k} ${cy - k} ${cx + k} ${cy - k} ${cx + r} ${cy}`,
    `C${cx + k} ${cy + k} ${cx + k} ${cy + k} ${cx} ${cy + r}`,
    `C${cx - k} ${cy + k} ${cx - k} ${cy + k} ${cx - r} ${cy}`,
    `C${cx - k} ${cy - k} ${cx - k} ${cy - k} ${cx} ${cy - r}`,
    "Z",
  ].join(" ");
}

function ZeevMark({ color = "currentColor" }: { color?: string }) {
  // sparkle principal + "+" acento no canto superior-direito
  return (
    <g fill={color}>
      <path d={sparklePath(14, 16, 10)} />
      {/* acento "+" */}
      <rect x="24" y="6.5" width="2" height="7" rx="1" />
      <rect x="21.5" y="9" width="7" height="2" rx="1" />
    </g>
  );
}

export function ZeevIcon({ size = 20, variant = "mark", className, ...rest }: ZeevIconProps) {
  if (variant === "circle") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn("inline-block", className)}
        aria-hidden="true"
        {...rest}
      >
        <defs>
          <linearGradient id="zeev-grad" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#4A90F5" />
            <stop offset="1" stopColor="#2563EB" />
          </linearGradient>
        </defs>
        <circle cx="20" cy="20" r="20" fill="url(#zeev-grad)" />
        <g transform="translate(6, 4)">
          <ZeevMark color="#FFFFFF" />
        </g>
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("inline-block", className)}
      aria-hidden="true"
      {...rest}
    >
      <ZeevMark />
    </svg>
  );
}

export default ZeevIcon;
