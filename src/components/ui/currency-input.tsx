import * as React from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Input mascarado para valores em Reais (R$ 1.234,56).
 *
 * Armazena/expõe `number | null`, mas o usuário sempre vê e digita no
 * padrão BR. Aceita vírgula decimal e ponto como separador de milhar.
 *
 * Estratégia: a cada tecla, mantém apenas dígitos e divide por 100 para
 * exibir como moeda — isso evita conflitos de cursor com vírgula/ponto.
 */
export interface CurrencyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value?: number | string | null;
  onChange?: (v: number | null) => void;
  /** Mostra o prefixo "R$" dentro do input (default true). */
  showPrefix?: boolean;
  /** Permite valores negativos (default false). */
  allowNegative?: boolean;
}

const fmt = (n: number, withPrefix: boolean) =>
  n.toLocaleString("pt-BR", {
    style: withPrefix ? "currency" : "decimal",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const numToCents = (v: number | string | null | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
};

export const CurrencyInput = React.forwardRef<HTMLInputElement, CurrencyInputProps>(
  (
    { value, onChange, className, showPrefix = true, allowNegative = false, placeholder, ...rest },
    ref,
  ) => {
    const [cents, setCents] = React.useState<number | null>(() => numToCents(value));
    const [neg, setNeg] = React.useState<boolean>(() => Number(value ?? 0) < 0);

    // Sincroniza com value externo (sem perder edição em andamento).
    React.useEffect(() => {
      const incoming = numToCents(value);
      const current = neg && cents != null ? -cents : cents;
      if (incoming !== current) {
        setCents(incoming == null ? null : Math.abs(incoming));
        setNeg((incoming ?? 0) < 0);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    const display = React.useMemo(() => {
      if (cents == null) return "";
      const signed = neg ? -cents : cents;
      return fmt(signed / 100, showPrefix);
    }, [cents, neg, showPrefix]);

    const emit = (nextCents: number | null, nextNeg: boolean) => {
      if (nextCents == null) {
        onChange?.(null);
        return;
      }
      const signed = nextNeg ? -nextCents : nextCents;
      onChange?.(signed / 100);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      const hasMinus = allowNegative && /-/.test(raw);
      const digits = raw.replace(/\D/g, "").slice(0, 13); // até ~99 bilhões
      if (!digits) {
        setCents(null);
        setNeg(false);
        emit(null, false);
        return;
      }
      const nextCents = Number(digits);
      setCents(nextCents);
      setNeg(hasMinus);
      emit(nextCents, hasMinus);
    };

    return (
      <Input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder ?? (showPrefix ? "R$ 0,00" : "0,00")}
        className={cn(className)}
        {...rest}
        value={display}
        onChange={handleChange}
      />
    );
  },
);
CurrencyInput.displayName = "CurrencyInput";
