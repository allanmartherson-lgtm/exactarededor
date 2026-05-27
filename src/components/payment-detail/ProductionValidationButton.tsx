import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { Send } from "lucide-react";
import { formatCurrency } from "@/lib/status";
import type { GroupRow } from "@/hooks/usePaymentDetailData";

interface Props {
  paymentId: string;
  groups: GroupRow[];
  currentUserId: string;
  onDone: () => void;
  /** Quando fornecido, esconde o trigger interno e controla a abertura do diálogo externamente. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ProductionValidationButton({ paymentId, groups, currentUserId, onDone, open: openProp, onOpenChange }: Props) {
  const [openInternal, setOpenInternal] = useState(false);
  const isControlled = openProp !== undefined;
  const open = isControlled ? openProp : openInternal;
  const setOpen = (v: boolean) => {
    if (!isControlled) setOpenInternal(v);
    onOpenChange?.(v);
  };
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const eligible = groups.filter(g =>
    ["revisao_analista", "concluida_analista", "devolvido_analista"].includes(String(g.status))
  );

  if (eligible.length === 0) return null;

  const toggle = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const handleOpen = () => {
    setSelected(new Set(eligible.map(g => g.id)));
    setOpen(true);
  };

  const handleSend = async () => {
    if (selected.size === 0) {
      toast({ title: "Selecione ao menos uma empresa", variant: "destructive" });
      return;
    }
    setBusy(true);
    const targets = eligible.filter(g => selected.has(g.id));
    let ok = 0;
    for (const g of targets) {
      if (!g.company_id) continue;
      const { error } = await supabase.from("production_validations").insert({
        payment_id: paymentId,
        company_id: g.company_id,
        company_name: g.company_name,
        sent_by: currentUserId,
      });
      if (!error) ok++;
      else console.warn("Falha ao criar validação para", g.company_name, error.message);
    }
    setBusy(false);
    setOpen(false);
    if (ok > 0) {
      toast({ title: `Validação enviada para ${ok} empresa(s)`, description: "A empresa receberá um link para revisar a produção antes da NF." });
      onDone();
    } else {
      toast({ title: "Nenhuma validação criada", description: "Verifique se as empresas têm company_id cadastrado.", variant: "destructive" });
    }
  };

  // Pré-seleciona todas as elegíveis quando o diálogo é aberto externamente.
  useEffect(() => {
    if (open && selected.size === 0 && eligible.length > 0) {
      setSelected(new Set(eligible.map((g) => g.id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      {!isControlled && (
        <Button variant="outline" size="sm" onClick={handleOpen}>
          <Send className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
          Validação prévia da empresa
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Enviar para validação da empresa</DialogTitle>
            <DialogDescription>
              A empresa receberá um link para revisar a lista de produção e sinalizar exclusões ou itens ausentes antes da emissão da NF.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 min-h-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground px-1">
              <span>{selected.size} de {eligible.length} selecionada(s)</span>
              <div className="flex gap-3">
                <button type="button" className="underline" onClick={() => setSelected(new Set(eligible.map(g => g.id)))}>Todas</button>
                <button type="button" className="underline" onClick={() => setSelected(new Set())}>Nenhuma</button>
              </div>
            </div>
            <ul className="flex-1 min-h-0 overflow-y-auto rounded border divide-y">
              {eligible.map(g => (
                <li key={g.id}>
                  <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/40">
                    <Checkbox checked={selected.has(g.id)} onCheckedChange={() => toggle(g.id)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{g.company_name}</p>
                      <p className="text-xs text-muted-foreground">{g.items_count} itens · {formatCurrency(Number(g.total_amount ?? 0))}</p>
                    </div>
                    {!g.company_id && <span className="shrink-0 text-[10px] text-destructive">sem company_id</span>}
                  </label>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground px-1">
              ⏱ Prazo padrão: 5 dias úteis. Configurável em Sistema → Configurações.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={handleSend} disabled={busy || selected.size === 0}>
              {busy ? "Enviando..." : `Enviar para ${selected.size} empresa(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>

      </Dialog>
    </>
  );
}
