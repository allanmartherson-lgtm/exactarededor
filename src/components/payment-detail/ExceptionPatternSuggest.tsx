import { useState } from "react";
import { Lightbulb } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useExceptionPatterns, type ExceptionPattern } from "@/hooks/useExceptionPatterns";

interface Props {
  paymentId: string;
}

const formatBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function ExceptionPatternSuggest({ paymentId }: Props) {
  const { patterns, loading } = useExceptionPatterns(paymentId);
  const [selected, setSelected] = useState<ExceptionPattern | null>(null);
  const [note, setNote] = useState("");
  const navigate = useNavigate();

  if (loading || patterns.length === 0) return null;

  const openDialog = (p: ExceptionPattern) => {
    setSelected(p);
    setNote(p.sample_note ?? "");
  };

  const handleCopy = () => {
    if (!selected) return;
    const params = new URLSearchParams({
      new: "1",
      code: selected.procedure_code,
      company: selected.company_name,
      note,
    });
    navigate(`/regras/pagamento?${params.toString()}`);
  };

  return (
    <>
      <Card className="border-amber-300/60 bg-amber-50/30 dark:bg-amber-950/10">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            Padrões recorrentes detectados — sugestão de regra
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {patterns.map((p) => (
            <div
              key={`${p.procedure_code}-${p.company_name}`}
              className="flex items-start justify-between gap-3 rounded-md border bg-background p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  Código TUSS {p.procedure_code} · {p.company_name} acatado {p.count} vezes como exceção
                </div>
                {p.sample_note && (
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">
                    {p.sample_note.length > 80 ? `${p.sample_note.slice(0, 80)}…` : p.sample_note}
                  </div>
                )}
              </div>
              <Button size="sm" variant="outline" onClick={() => openDialog(p)}>
                Sugerir como regra
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Criar sugestão de regra</DialogTitle>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border bg-muted/30 p-3 space-y-1">
                <div>
                  <span className="text-muted-foreground">Nome sugerido:</span>{" "}
                  <span className="font-medium">
                    Exceção autorizada — {selected.procedure_code} {selected.company_name}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">Tipo:</span>{" "}
                  <span className="font-medium">valor_fixo</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Valor:</span>{" "}
                  <span className="font-medium">{formatBRL(selected.avg_gross)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Escopo:</span>{" "}
                  <span className="font-medium">específica ({selected.company_name})</span>
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Justificativa</label>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  className="mt-1"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelected(null)}>
              Fechar
            </Button>
            <Button onClick={handleCopy}>Copiar para regras</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
