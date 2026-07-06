import type { CSSProperties } from "react";
import { NavLink } from "react-router-dom";
import { ExactaIcon } from "./ExactaIcon";

interface ExactaLogoProps {
  /** "full" = ícone + wordmark + tagline; "compact" = ícone + wordmark; "icon" = só ícone. */
  variant?: "full" | "compact" | "icon";
  /** Tamanho do ícone em px. Default 36. */
  iconSize?: number;
  /** Tamanho do wordmark em px. Default 22 (full) / 18 (compact). */
  wordmarkSize?: number;
  /** Renderiza como link para "/". Default true. */
  asLink?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Força esquema escuro (texto branco). Útil em fundos azul institucional como o painel de login. */
  onDark?: boolean;
  /** Mantém o ícone oficial azul + check dourado mesmo quando o texto usa versão escura. */
  preserveIconColors?: boolean;
}

/**
 * Logo oficial Exacta — ícone (círculo azul + check bronze) + wordmark "Exacta" com
 * "x" bronze + tagline "PAGAMENTO MÉDICO · REDE D'OR".
 *
 * Theme-aware: o texto usa tokens `--foreground` / `--muted-foreground`, então
 * acompanha automaticamente light/dark mode. Use `onDark` para fundos azul-marinho
 * quando o componente não está dentro da árvore tematizada.
 *
 * SEMPRE use este componente — nunca recrie o lockup inline em outra tela.
 */
export const ExactaLogo = ({
  variant = "full",
  iconSize,
  wordmarkSize,
  asLink = true,
  className,
  style,
  onDark = false,
  preserveIconColors = false,
}: ExactaLogoProps) => {
  const resolvedIconSize = iconSize ?? (variant === "icon" ? 40 : variant === "full" ? 40 : 34);
  const resolvedWordmarkSize = wordmarkSize ?? (variant === "full" ? 22 : 18);

  const textColor = onDark ? "#FFFFFF" : "hsl(var(--foreground))";
  // Aumentado opacidade das taglines em fundo escuro (antes 0.6/0.38 gerava
  // aparência "borrada" à distância). Mantém hierarquia visual sem perder nitidez.
  const taglineColor = onDark ? "rgba(255,255,255,0.92)" : "hsl(var(--muted-foreground))";
  const taglineColorSecondary = onDark ? "rgba(255,255,255,0.72)" : "hsl(var(--muted-foreground))";
  // Wordmark accent: dourado #C6A27C sobre navy; token theme-aware caso contrário
  const accentColor = onDark ? "#C6A27C" : "hsl(var(--brand-wordmark-accent))";

  // Renderização nítida em displays HiDPI e fundos coloridos — evita o efeito
  // "burr" das taglines pequenas em uppercase sobre navy.
  const crispText: CSSProperties = {
    WebkitFontSmoothing: "antialiased",
    MozOsxFontSmoothing: "grayscale",
    textRendering: "geometricPrecision",
  };

  // Em fundos azuis (sidebar navy #002855 e topbar #003DA5) o badge oficial
  // ganha um anel dourado desenhado no próprio SVG, garantindo contraste.
  const showGoldRing = onDark && preserveIconColors;

  const content = (
    <>
      <ExactaIcon
        size={resolvedIconSize}
        bg={onDark && !preserveIconColors ? "rgba(255,255,255,0.14)" : undefined}
        check={onDark && !preserveIconColors ? "#FFFFFF" : undefined}
        ring={showGoldRing}
      />


      {variant !== "icon" && (
        <div className="min-w-0 leading-tight">
          <p
            className="font-wordmark"
            style={{
              // Hanken Grotesk é a família tipográfica oficial CURA — substitui
              // Playfair para alinhar o wordmark do Exacta ao Design System.
              fontFamily: "'Hanken Grotesk', 'DM Sans', system-ui, sans-serif",
              fontSize: resolvedWordmarkSize,
              // Peso 700 dá presença mais firme sobre o navy sem parecer pesado.
              fontWeight: 700,
              letterSpacing: "-0.005em",
              color: textColor,
              lineHeight: 1,
              margin: 0,
              ...crispText,
            }}
          >
            E<span style={{ color: accentColor, fontWeight: 700 }}>x</span>acta
          </p>
          {variant === "full" && (
            <div style={{ marginTop: 4 }}>
              <p
                style={{
                  // Piso mínimo maior (10px) para taglines legíveis mesmo em
                  // wordmark reduzido; peso 600 dá contorno sem borrar.
                  fontSize: Math.max(10, Math.round(resolvedWordmarkSize * 0.44)),
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.16em",
                  color: taglineColor,
                  margin: 0,
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                  ...crispText,
                }}
              >
                Pagamento Médico
              </p>
              <p
                style={{
                  fontSize: Math.max(9, Math.round(resolvedWordmarkSize * 0.44 * 0.82)),
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.14em",
                  color: taglineColorSecondary,
                  margin: 0,
                  marginTop: 2,
                  lineHeight: 1.2,
                  whiteSpace: "nowrap",
                  ...crispText,
                }}
              >
                Rede D'Or
              </p>
            </div>
          )}
        </div>
      )}
    </>
  );


  const baseClass =
    "inline-flex items-center gap-3 flex-shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md";

  if (asLink) {
    return (
      <NavLink
        to="/"
        aria-label="Exacta — início"
        className={`${baseClass} ${className ?? ""}`.trim()}
        style={style}
      >
        {content}
      </NavLink>
    );
  }

  return (
    <div
      aria-label="Exacta"
      className={`${baseClass} ${className ?? ""}`.trim()}
      style={style}
    >
      {content}
    </div>
  );
};

export default ExactaLogo;
