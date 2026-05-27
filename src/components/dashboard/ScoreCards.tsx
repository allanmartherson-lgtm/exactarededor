import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";

export type ScoreTone = "action" | "transit" | "alert";

export type ScoreItemData = {
  label: string;
  value: number | string;
  to?: string;
  icon?: LucideIcon;
  accent?: "amber" | "rose" | "success";
  hint?: string;
};

const OUTFIT = "'Outfit', 'Inter', system-ui, sans-serif";
const FIGTREE = "'Figtree', 'Inter', system-ui, sans-serif";

function toneAccent(tone: ScoreTone) {
  return tone === "action"
    ? "var(--primary)"
    : tone === "alert"
    ? "var(--info)"
    : "var(--muted-foreground)";
}

export function ScoreCard({ item, tone }: { item: ScoreItemData; tone: ScoreTone }) {
  const isZero = item.value === 0 || item.value === "0";
  const accentVar = toneAccent(tone);
  const valueColor = isZero
    ? "hsl(var(--muted-foreground))"
    : item.accent === "rose"
    ? "hsl(var(--destructive))"
    : item.accent === "amber"
    ? "hsl(var(--warning))"
    : item.accent === "success"
    ? "hsl(var(--success))"
    : "hsl(var(--foreground))";

  const inner = (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span
          className="medpay-score-label"
          style={{
            fontFamily: OUTFIT,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "hsl(var(--muted-foreground))",
            transition: "color 0.3s",
          }}
        >
          {item.label}
        </span>
        {tone === "action" ? (
          <svg
            viewBox="0 0 40 10"
            width={36}
            height={14}
            aria-hidden
            className="medpay-score-spark"
            style={{ opacity: 0.35, transition: "opacity 0.4s, transform 0.4s" }}
          >
            <path
              d="M0 8 L5 4 L10 6 L15 2 L20 5 L25 1 L30 7 L35 3 L40 5"
              fill="none"
              stroke={`hsl(${accentVar})`}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : tone === "alert" && !isZero ? (
          <span style={{ position: "relative", display: "inline-flex" }}>
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: 9999,
                background: `hsl(${accentVar})`,
                boxShadow: `0 0 10px hsl(${accentVar} / 0.5)`,
                display: "inline-block",
              }}
            />
            <span
              className="animate-ping"
              style={{
                position: "absolute",
                inset: 0,
                width: 9,
                height: 9,
                borderRadius: 9999,
                background: `hsl(${accentVar})`,
                opacity: 0.4,
              }}
            />
          </span>
        ) : null}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
        <span
          style={{
            fontFamily: OUTFIT,
            fontSize: String(item.value).length > 6 ? 22 : String(item.value).length > 4 ? 28 : 38,
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: "-0.02em",
            color: valueColor,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
            maxWidth: "100%",
          }}
        >
          {item.value}
        </span>

        {tone === "alert" && !isZero && (
          <span
            style={{
              fontFamily: OUTFIT,
              fontSize: 9,
              fontWeight: 800,
              letterSpacing: "0.04em",
              color: "hsl(var(--info-foreground))",
              background: `hsl(${accentVar})`,
              padding: "2px 6px",
              borderRadius: 4,
            }}
          >
            ATENÇÃO
          </span>
        )}
      </div>
      <span
        style={{
          fontFamily: FIGTREE,
          fontSize: 11,
          fontWeight: 500,
          color: "hsl(var(--muted-foreground))",
        }}
      >
        {item.hint ??
          (tone === "action" && !isZero
            ? "aguardando você"
            : tone === "alert" && !isZero
            ? "pendentes de revisão"
            : "sem pendências")}
      </span>
      <span
        className="medpay-score-underline"
        aria-hidden
        style={{
          position: "absolute",
          bottom: 0,
          left: 16,
          right: 16,
          height: 3,
          borderRadius: 9999,
          background: `hsl(${accentVar})`,
          transform: "scaleX(0)",
          transformOrigin: "left",
          transition: "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      />
    </>
  );

  const baseStyle = {
    position: "relative" as const,
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    padding: "18px 18px 20px",
    background: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: 16,
    boxShadow: "var(--shadow-card)",
    textDecoration: "none",
    color: "inherit",
    overflow: "hidden" as const,
    transition:
      "transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.4s, border-color 0.3s",
  };

  if (item.to) {
    return (
      <Link to={item.to} className="group medpay-score-card" style={baseStyle}>
        {inner}
      </Link>
    );
  }
  return (
    <div className="medpay-score-card" style={baseStyle}>
      {inner}
    </div>
  );
}

export function ScoreSection({
  title,
  items,
  tone,
}: {
  title: string;
  items: ScoreItemData[];
  tone: ScoreTone;
}) {
  if (items.length === 0) return null;
  const headColor =
    tone === "action"
      ? "hsl(var(--primary))"
      : tone === "alert"
      ? "hsl(var(--info))"
      : "hsl(var(--muted-foreground))";
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <h3
          style={{
            fontFamily: OUTFIT,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.28em",
            textTransform: "uppercase",
            color: headColor,
            whiteSpace: "nowrap",
            margin: 0,
          }}
        >
          {title}
        </h3>
        <span
          style={{
            height: 1,
            flex: 1,
            background: "linear-gradient(to right, hsl(var(--border)), transparent)",
          }}
        />
      </header>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${Math.max(items.length, 2)}, minmax(0, 1fr))`,
          gap: 16,
        }}
      >
        {items.map((item) => (
          <ScoreCard key={item.label} item={item} tone={tone} />
        ))}
      </div>
    </div>
  );
}
