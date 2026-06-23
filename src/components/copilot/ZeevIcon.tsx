import { cn } from "@/lib/utils";

/**
 * Zeev — Ícone oficial (Zayin + checkmark).
 * Fonte: ZeevIcon.jsx enviado pelo time de marca.
 *
 * Variantes:
 *  - "mark": só as linhas (zayin+check) em currentColor. Use em badges/botões
 *    onde o container já tem cor de fundo (ex.: FAB primário, avatares).
 *  - "circle": versão selada com círculo azul Zeev (#003D7A) + traços brancos.
 *    Use como logo standalone (headers de chat, cards).
 */
export interface ZeevIconProps extends React.SVGAttributes<SVGSVGElement> {
  size?: number;
  variant?: "mark" | "circle";
}

function ZeevStrokes({ color = "currentColor", width = 2.6 }: { color?: string; width?: number }) {
  return (
    <g
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      fill="none"
    >
      <line x1="8" y1="10" x2="24" y2="10" />
      <line x1="24" y1="10" x2="24" y2="21" />
      <line x1="24" y1="21" x2="18" y2="27" />
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
        <circle cx="20" cy="20" r="20" fill="#003D7A" />
        <g transform="translate(4, 3)">
          <ZeevStrokes color="#FFFFFF" />
        </g>
      </svg>
    );
  }
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
      <g transform="translate(4, 3)">
        <ZeevStrokes />
      </g>
    </svg>
  );
}

export default ZeevIcon;
