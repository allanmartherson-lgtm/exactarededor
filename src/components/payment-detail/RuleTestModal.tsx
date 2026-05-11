import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { GitCompare, Loader2, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency, TONE_CLASSES } from "@/lib/status";
import { toast } from "@/hooks/use-toast";

interface RuleTestModalProps {
  paymentId: string;
  paymentReference: string;
  isOpen: boolean;
  onClose: () => void;
  items: any[];
}

export function RuleTestModal({ paymentId, paymentReference, isOpen, onClose, items }: RuleTestModalProps) {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[] | null>(null);

  const runTest = async () => {
    setLoading(true);
    setResults(null);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-payment", {
        body: { payment_id: paymentId, is_dry_run: true },
      });

      if (error) throw error;

      // Mapeia resultados para facilitar comparação
      const testResults = data.results.map((res: any) => {
        const originalItem = items.find(it => it.id === res.item_id);
        return {
          ...res,
          procedure_code: originalItem?.procedure_code,
          procedure_name: originalItem?.procedure_name,
          access_route: originalItem?.access_route,
          doctor_name: originalItem?.doctor_name,
          original_status: originalItem?.ai_status,
          original_expected: originalItem?.ai_findings?.expected_amount,
        };
      });

      setResults(testResults);
      toast({ title: "Simulação concluída", description: `${testResults.length} itens analisados.` });
    } catch (err: any) {
      console.error(err);
      toast({ title: "Erro na simulação", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const changedCount = results?.filter(r => 
    r.status !== r.original_status || 
    r.expected_amount !== r.original_expected
  ).length ?? 0;

  return (
    <Dialog open={isOpen} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="h-5 w-5 text-primary" />
            Teste de Regras: {paymentReference}
          </DialogTitle>
          <DialogDescription>
            Simule a execução do motor de cálculo sem alterar os dados reais para validar ajustes nas regras e normalização de vias.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 py-4">
          {!results && !loading && (
            <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed rounded-lg bg-muted/30">
              <Play className="h-12 w-12 text-muted-foreground mb-4 opacity-20" />
              <p className="text-sm text-muted-foreground mb-4">Pronto para iniciar a simulação do lote.</p>
              <Button onClick={runTest} className="gap-2">
                <Play className="h-4 w-4" />
                Iniciar Teste
              </Button>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center h-64">
              <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" />
              <p className="text-sm font-medium">Processando motor determinístico...</p>
              <p className="text-xs text-muted-foreground mt-1">Carregando regras e tabelas de referência</p>
            </div>
          )}

          {results && (
            <div className="flex flex-col h-full space-y-4">
              <div className="flex items-center gap-4 px-4 py-2 bg-primary/5 border rounded-md">
                <div className="text-sm">
                  <span className="text-muted-foreground">Itens analisados:</span> <span className="font-bold">{results.length}</span>
                </div>
                <div className="text-sm border-l pl-4">
                  <span className="text-muted-foreground">Mudanças detectadas:</span> <span className={cn("font-bold", changedCount > 0 ? "text-orange-600" : "text-success")}>{changedCount}</span>
                </div>
              </div>

              <ScrollArea className="flex-1 border rounded-md">
                <Table>
                  <TableHeader className="bg-muted/50 sticky top-0 z-10">
                    <TableRow>
                      <TableHead className="w-[120px]">Item / Código</TableHead>
                      <TableHead>Via / Médico</TableHead>
                      <TableHead className="text-center">Status (Antes → Depois)</TableHead>
                      <TableHead className="text-right">Esperado (Antes → Depois)</TableHead>
                      <TableHead>Regra / Explicação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((res) => {
                      const isChanged = res.status !== res.original_status || res.expected_amount !== res.original_expected;
                      return (
                        <TableRow key={res.item_id} className={cn(isChanged && "bg-orange-50/50")}>
                          <TableCell>
                            <div className="text-xs font-bold">{res.procedure_code}</div>
                            <div className="text-[10px] text-muted-foreground truncate max-w-[150px]" title={res.procedure_name}>{res.procedure_name}</div>
                          </TableCell>
                          <TableCell>
                            <div className="text-[10px] font-medium uppercase text-muted-foreground">{res.access_route}</div>
                            <div className="text-[10px]">{res.doctor_name}</div>
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Badge variant="outline" className={cn("text-[9px] h-4", TONE_CLASSES[res.original_status as keyof typeof TONE_CLASSES] || "bg-muted")}>
                                {res.original_status}
                              </Badge>
                              <span className="text-muted-foreground">→</span>
                              <Badge variant="outline" className={cn("text-[9px] h-4 font-bold", TONE_CLASSES[res.status as keyof typeof TONE_CLASSES] || "bg-muted")}>
                                {res.status}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell className="text-right whitespace-nowrap">
                            <div className="text-[10px] text-muted-foreground line-through">{formatCurrency(res.original_expected ?? 0)}</div>
                            <div className={cn("text-[11px] font-bold", res.expected_amount !== res.original_expected && "text-orange-600")}>
                              {formatCurrency(res.expected_amount ?? 0)}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="text-[10px] font-medium text-primary">{res.matched_rule_name || "—"}</div>
                            <div className="text-[10px] text-muted-foreground italic leading-tight">{res.calculation_explanation}</div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter className="border-t pt-4">
          <Button variant="outline" onClick={onClose}>Fechar</Button>
          {results && (
            <Button onClick={runTest} variant="secondary" disabled={loading} className="gap-2">
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              Rodar Novamente
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
