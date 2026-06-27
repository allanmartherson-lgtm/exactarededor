import { CSSProperties } from "react";

interface ExactaIconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Cor de fundo do círculo. Default = azul institucional Rede D'Or */
  bg?: string;
  /** Cor do check. Default = bronze */
  check?: string;
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
    <circle cx="256" cy="256" r="256" fill={bg} />
    <polyline
      points="128,272 213,358 384,170"
      fill="none"
      stroke={check}
      strokeWidth="44"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export default ExactaIcon;
