import { CSSProperties } from "react";
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
}: ExactaLogoProps) => {
  const resolvedIconSize = iconSize ?? (variant === "icon" ? 40 : variant === "full" ? 40 : 34);
  const resolvedWordmarkSize = wordmarkSize ?? (variant === "full" ? 22 : 18);

  const textColor = onDark ? "#FFFFFF" : "hsl(var(--foreground))";
  const taglineColor = onDark ? "rgba(255,255,255,0.6)" : "hsl(var(--muted-foreground))";
  const taglineColorSecondary = onDark ? "rgba(255,255,255,0.38)" : "hsl(var(--muted-foreground))";
  // Wordmark accent: dourado #C6A27C sobre navy; token theme-aware caso contrário
  const accentColor = onDark ? "#C6A27C" : "hsl(var(--brand-wordmark-accent))";

  const content = (
    <>
      <ExactaIcon
        size={resolvedIconSize}
        // Versão branca (monocromática) sobre header navy: círculo transparente
        // com contorno branco sutil + check branco. Sobre fundo claro mantém o
        // lockup oficial (círculo navy + check bronze).
        bg={onDark ? "rgba(255,255,255,0.14)" : undefined}
        check={onDark ? "#FFFFFF" : undefined}
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
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: textColor,
              lineHeight: 1,
              margin: 0,
            }}
          >
            E<span style={{ color: accentColor }}>x</span>acta
          </p>
          {variant === "full" && (
            <p
              style={{
                fontSize: Math.max(9, Math.round(resolvedWordmarkSize * 0.42)),
                textTransform: "uppercase",
                letterSpacing: "0.14em",
                color: taglineColor,
                marginTop: 4,
                marginBottom: 0,
                lineHeight: 1.2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: "100%",
              }}
              title="Pagamento Médico · Rede D'Or"
            >
              Pagamento Médico · Rede D'Or
            </p>
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
