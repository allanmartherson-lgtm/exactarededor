import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Search, Calculator } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PaymentModeSelectModal({ open, onOpenChange }: Props) {
  const navigate = useNavigate();

  const select = (modo: "analise" | "confeccao") => {
    onOpenChange(false);
    navigate(`/pagamentos/novo?modo=${modo}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-[min(95vw,720px)] max-h-[90vh] overflow-y-auto p-6 sm:p-8">
        <DialogHeader className="space-y-2">
          <DialogTitle className="text-xl sm:text-2xl leading-tight">Como deseja criar a base?</DialogTitle>
          <DialogDescription className="text-sm sm:text-base leading-relaxed">
            Escolha o modo antes de continuar
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-5">
          <button
            type="button"
            onClick={() => select("analise")}
            className="flex flex-col items-start gap-4 rounded-lg border border-border p-5 text-left hover:border-primary hover:bg-primary/5 transition-colors"
          >
            <div className="flex w-full items-center justify-between">
              <div className="rounded-md bg-muted p-2.5">
                <Search className="h-6 w-6 text-muted-foreground" />
              </div>
              <Badge variant="outline" className="text-xs">Modo atual</Badge>
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
            onClick={() => select("confeccao")}
            className="flex flex-col items-start gap-4 rounded-lg border border-border p-5 text-left hover:border-primary hover:bg-primary/5 transition-colors"
          >
            <div className="flex w-full items-center justify-between">
              <div className="rounded-md bg-primary/10 p-2.5">
                <Calculator className="h-6 w-6 text-primary" />
              </div>
              <Badge className="text-xs bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100">Novo</Badge>
            </div>
            <div className="space-y-2">
              <p className="font-semibold text-base sm:text-lg leading-snug">Confecção de pagamento</p>
              <p className="text-sm sm:text-[15px] text-muted-foreground leading-relaxed">
                Você sobe a base com o valor do convênio. O sistema aplica as regras e calcula o repasse automaticamente.
              </p>
            </div>
          </button>
        </div>

      </DialogContent>
    </Dialog>
  );
}
