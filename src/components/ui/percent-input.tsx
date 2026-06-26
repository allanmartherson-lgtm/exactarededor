import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Input para percentuais no padrão BR (aceita vírgula decimal).
 *
 * Armazena/expõe `number | null` (ex.: 12.5 representa 12,5%). Mostra
 * sufixo "%" opcional. Aceita digitação livre com vírgula ou ponto.
 */
export interface PercentInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value?: number | string | null;
  onChange?: (v: number | null) => void;
  /** Casas decimais máximas (default 4). */
  maxDecimals?: number;
}

const numToBr = (v: number | string | null | undefined, maxDecimals: number): string => {
  if (v == null || v === "") return "";
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (!Number.isFinite(n)) return "";
  // Mantém o que o usuário escreveu se for um inteiro simples.
  const str = String(n);
  if (!str.includes(".")) return str.replace(".", ",");
  const [int, dec] = str.split(".");
  return `${int},${dec.slice(0, maxDecimals)}`;
};

const brToNum = (s: string): number | null => {
  if (!s) return null;
  const normalized = s.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
};

export const PercentInput = React.forwardRef<HTMLInputElement, PercentInputProps>(
  ({ value, onChange, className, maxDecimals = 4, placeholder = "0,00", ...rest }, ref) => {
    const [text, setText] = React.useState<string>(() => numToBr(value, maxDecimals));

    React.useEffect(() => {
      const incoming = numToBr(value, maxDecimals);
      if (incoming !== text && brToNum(text) !== (value == null ? null : Number(value))) {
        setText(incoming);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      let raw = e.target.value.replace(/[^\d.,-]/g, "");
      // Apenas um separador decimal — prioriza vírgula; converte ponto solto.
      const commas = (raw.match(/,/g) ?? []).length;
      const dots = (raw.match(/\./g) ?? []).length;
      if (commas > 1) raw = raw.replace(/,(?=.*,)/g, "");
      if (commas === 0 && dots === 1) raw = raw.replace(".", ",");
      else if (commas >= 1 && dots >= 1) raw = raw.replace(/\./g, "");
      // Limita decimais
      if (raw.includes(",")) {
        const [i, d = ""] = raw.split(",");
        raw = `${i},${d.slice(0, maxDecimals)}`;
      }
      setText(raw);
      onChange?.(brToNum(raw));
    };

    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
      const n = brToNum(text);
      if (n != null) setText(numToBr(n, maxDecimals));
      rest.onBlur?.(e);
    };

    return (
      <div className={cn("relative", className)}>
        <Input
          ref={ref}
          inputMode="decimal"
          autoComplete="off"
          placeholder={placeholder}
          {...rest}
          value={text}
          onChange={handleChange}
          onBlur={handleBlur}
          className="pr-7"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          %
        </span>
      </div>
    );
  },
);
PercentInput.displayName = "PercentInput";
