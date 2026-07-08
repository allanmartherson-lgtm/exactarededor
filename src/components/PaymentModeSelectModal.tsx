import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Search, Calculator, ArrowLeft, FileEdit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePaymentTypes } from "@/hooks/usePaymentTypes";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = "mode" | "type";
type Mode = "analise" | "confeccao" | "manual";

export function PaymentModeSelectModal({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const { list: paymentTypes, loading } = usePaymentTypes({ onlyActive: true });
  const [step, setStep] = useState<Step>("mode");
  const [modo, setModo] = useState<Mode>("analise");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (open) {
      setStep("mode");
      setSearch("");
    }
  }, [open]);

  const selectMode = (m: Mode) => {
    if (m === "manual") {
      onOpenChange(false);
      navigate("/pagamentos/novo-manual");
      return;
    }
    setModo(m);
    try {
      sessionStorage.setItem("newPaymentMode", m === "confeccao" ? "confeccao" : "padrao");
    } catch { /* storage indisponível */ }
    setStep("type");
  };

  const selectType = (typeId: string | null) => {
    onOpenChange(false);
    try {
      if (typeId) sessionStorage.setItem("newPaymentTypeId", typeId);
      else sessionStorage.removeItem("newPaymentTypeId");
    } catch { /* ignore */ }
    const params = new URLSearchParams({ modo });
    if (typeId) params.set("tipo", typeId);
    navigate(`/pagamentos/novo?${params.toString()}`);
  };

  const filtered = paymentTypes.filter((pt) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return pt.label.toLowerCase().includes(q) || (pt.description ?? "").toLowerCase().includes(q);
  });

  // Agrupa por categoria
  const grouped: Record<string, typeof paymentTypes> = {};
  for (const pt of filtered) {
    const cat = (pt as any).category || "Outros";
    (grouped[cat] ||= []).push(pt);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-[min(95vw,960px)] sm:!max-w-[min(95vw,960px)] p-4 sm:p-8">
        {step === "mode" ? (
          <>
            <DialogHeader className="space-y-2">
              <DialogTitle className="text-xl sm:text-2xl leading-tight">Como deseja criar a base?</DialogTitle>
              <DialogDescription className="text-sm sm:text-base leading-relaxed">
                Escolha o modo antes de continuar
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-5">
              <button
                type="button"
                onClick={() => selectMode("analise")}
                className="flex flex-col items-start gap-4 rounded-lg border border-border p-5 text-left hover:border-primary hover:bg-primary/5 transition-colors"
              >
                <div className="rounded-md bg-muted p-2.5">
                  <Search className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="space-y-2">
                  <p className="font-semibold text-base sm:text-lg leading-snug">Análise de pagamento</p>
                  <p className="text-sm sm:text-[15px] text-muted-foreground leading-relaxed">
                    Você já calculou o repasse. O sistema verifica se está correto conforme as regras cadastradas.
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => selectMode("confeccao")}
                className="flex flex-col items-start gap-4 rounded-lg border border-border p-5 text-left hover:border-primary hover:bg-primary/5 transition-colors"
              >
                <div className="rounded-md bg-primary/10 p-2.5">
                  <Calculator className="h-6 w-6 text-primary" />
                </div>
                <div className="space-y-2">
                  <p className="font-semibold text-base sm:text-lg leading-snug">Confecção de pagamento</p>
                  <p className="text-sm sm:text-[15px] text-muted-foreground leading-relaxed">
                    Você sobe a base com o valor do convênio. O sistema aplica as regras e calcula o repasse automaticamente.
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => selectMode("manual")}
                className="flex flex-col items-start gap-4 rounded-lg border border-border p-5 text-left hover:border-primary hover:bg-primary/5 transition-colors"
              >
                <div className="rounded-md bg-amber-500/10 p-2.5">
                  <FileEdit className="h-6 w-6 text-amber-600" />
                </div>
                <div className="space-y-2">
                  <p className="font-semibold text-base sm:text-lg leading-snug">Lançamento manual</p>
                  <p className="text-sm sm:text-[15px] text-muted-foreground leading-relaxed">
                    Para pagamentos que vêm de planilha externa (nefrologia, plantão fechado, coordenação). Você informa o valor por médico/empresa e anexa a fonte.
                  </p>
                </div>
              </button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader className="space-y-2">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 -ml-2"
                  onClick={() => setStep("mode")}
                >
                  <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
                </Button>
                <span className="text-xs text-muted-foreground">
                  Modo: <span className="font-medium">{modo === "confeccao" ? "Confecção" : "Análise"}</span>
                </span>
              </div>
              <DialogTitle className="text-xl sm:text-2xl leading-tight">Qual o tipo de pagamento desta base?</DialogTitle>
              <DialogDescription className="text-sm sm:text-base leading-relaxed">
                O tipo define o TUSS padrão, função do médico, mapeamento de colunas e quais regras o motor vai considerar.
              </DialogDescription>
            </DialogHeader>

            <div className="pt-4 space-y-3">
              <Input
                placeholder="Buscar tipo (ex.: parecer, cirurgia, sadt…)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoFocus
              />

              {loading ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Carregando tipos…</p>
              ) : Object.keys(grouped).length === 0 ? (
                <div className="space-y-3 py-2">
                  <p className="text-sm text-muted-foreground">Nenhum tipo encontrado.</p>
                  <button
                    type="button"
                    onClick={() => selectType(null)}
                    className="w-full rounded-md border border-dashed border-border p-3 text-sm text-left hover:bg-muted/40"
                  >
                    Continuar sem definir tipo (não recomendado — regras com tipo específico não vão filtrar)
                  </button>
                </div>
              ) : (
                <div className="space-y-4 max-h-[55vh] overflow-y-auto pr-1">
                  {Object.entries(grouped).map(([cat, items]) => (
                    <div key={cat} className="space-y-1.5">
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{cat}</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {items.map((pt) => (
                          <button
                            key={pt.id}
                            type="button"
                            onClick={() => selectType(pt.id)}
                            className="rounded-md border border-border p-3 text-left hover:border-primary hover:bg-primary/5 transition-colors"
                          >
                            <div className="font-medium text-sm">{pt.label}</div>
                            {pt.description && (
                              <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{pt.description}</div>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => selectType(null)}
                    className="w-full rounded-md border border-dashed border-border p-2.5 text-xs text-muted-foreground text-center hover:bg-muted/40"
                  >
                    Pular e definir depois
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
