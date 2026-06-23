import { cn } from "@/lib/utils";

/**
 * Zeev — Ícone oficial (Zayin + checkmark).
 * Usado como identidade visual do assistente Zeev em todo o app.
 *
 * Variantes:
 *  - "mark": só o traço (Zayin/check), em currentColor. Use em badges/botões
 *    onde o container já tem cor de fundo (ex: FAB primário, avatares).
 *  - "circle": versão selada com círculo azul Zeev (#003D7A) + traço branco.
 *    Use como logo standalone (headers de chat, cards).
 */
export interface ZeevIconProps extends React.SVGAttributes<SVGSVGElement> {
  size?: number;
  variant?: "mark" | "circle";
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
          <line x1="8" y1="10" x2="24" y2="10" stroke="white" strokeWidth="2.6" strokeLinecap="round" />
          <line x1="24" y1="10" x2="24" y2="21" stroke="white" strokeWidth="2.6" strokeLinecap="round" />
          <line x1="24" y1="21" x2="18" y2="27" stroke="white" strokeWidth="2.6" strokeLinecap="round" />
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
      <line x1="8" y1="10" x2="24" y2="10" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <line x1="24" y1="10" x2="24" y2="21" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <line x1="24" y1="21" x2="18" y2="27" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export default ZeevIcon;
