import { CSSProperties } from "react";

interface ExactaIconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Cor de fundo do círculo. Default = azul institucional Rede D'Or */
  bg?: string;
  /** Cor do check. Default = bronze */
  check?: string;
  /** Renderiza anel dourado ao redor do círculo (para fundos azuis). */
  ring?: boolean;
  title?: string;
}

/**
 * Ícone oficial do Exacta — círculo azul Rede D'Or com check bronze.
 * SVG inline para escalar sem perda e herdar tokens facilmente.
 */
export const ExactaIcon = ({
  size = 32,
  className,
  style,
  bg = "#003DA5",
  check = "#C6A27C",
  ring = false,
  title = "Exacta",
}: ExactaIconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 512 512"
    xmlns="http://www.w3.org/2000/svg"
    role="img"
    aria-label={title}
    className={className}
    style={style}
  >
    <title>{title}</title>
    {ring ? (
      <circle
        cx="256"
        cy="256"
        r="234"
        fill={bg}
        stroke="#C6A27C"
        strokeWidth="36"
      />
    ) : (
      <circle cx="256" cy="256" r="236" fill={bg} />
    )}
    <polyline
      points="148,272 223,348 374,180"
      fill="none"
      stroke={check}
      strokeWidth="42"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);


export default ExactaIcon;
