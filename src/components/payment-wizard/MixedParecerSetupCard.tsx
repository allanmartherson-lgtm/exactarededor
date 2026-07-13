import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Info } from "lucide-react";
import { useItemTypes } from "@/hooks/useItemTypes";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Lote misto = lote de produção (cirurgia/exame/etc.) que TAMBÉM contém
 * atendimentos de parecer/visita misturados nos códigos TUSS de consulta.
 *
 * Quando marcado, o analista escolhe o subtipo de parecer destino e anexa o
 * relatório do Tasy. A edge `cross-reference-parecer` cruza SÓ os itens cujo
 * TUSS está cadastrado como Parecer/Visita/Consulta — procedimentos puros
 * (cirurgia/exame) ficam intocados.
 *
 * D3.e.2: passa a ler do catálogo canônico `item_types` (antes lia de
 * `payment_types` filtrando por `code`). O id selecionado é gravado em
 * `payments.mixed_parecer_item_type_id`; o trigger de sync mantém a coluna
 * legada `mixed_parecer_payment_type_id` em paralelo durante a transição.
 */
export type MixedParecerSetup = {
  enabled: boolean;
  item_type_id: string | null; // subtipo parecer destino (item_types.id)
};

export function MixedParecerSetupCard({
  value,
  onChange,
  ambiguousTussCount,
}: {
  value: MixedParecerSetup;
  onChange: (v: MixedParecerSetup) => void;
  ambiguousTussCount?: number;
}) {
  const { list: itemTypes } = useItemTypes({ onlyActive: true });
  const parecerSubtypes = itemTypes.filter((t) => t.code.startsWith("parecer"));

  // Default — primeiro parecer ativo
  useEffect(() => {
    if (value.enabled && !value.item_type_id && parecerSubtypes.length > 0) {
      onChange({ ...value, item_type_id: parecerSubtypes[0].id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.enabled, parecerSubtypes.length]);

  return (
    <Card className="shadow-card border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Info className="h-4 w-4 text-muted-foreground" />
          Lote misto (Parecer + Visita no mesmo arquivo)?
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Marque aqui se o relatório do Tasy deste mês inclui <strong>Parecer e Visita misturados</strong> —
          ou se este é um lote de <strong>procedimentos</strong> com pareceres/visitas embutidos nos mesmos códigos TUSS.
          O sistema classifica cada item automaticamente pelo TUSS + relatório do Tasy.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start gap-3">
          <Checkbox
            id="mixed-parecer"
            checked={value.enabled}
            onCheckedChange={(c) =>
              onChange({ ...value, enabled: !!c, item_type_id: c ? value.item_type_id : null })
            }
            className="mt-0.5"
          />
          <div className="flex-1">
            <Label htmlFor="mixed-parecer" className="cursor-pointer text-sm font-medium">
              Sim, este lote é misto — anexar relatório do Tasy para classificar automaticamente
            </Label>
            <p className="text-xs text-muted-foreground mt-1">
              Use quando o mesmo lote paga <strong>Parecer + Visita</strong> juntos, ou quando um lote de
              procedimentos (cirurgia/exame) também traz consultas/visitas/pareceres compartilhando códigos TUSS.
              O cruzamento só afeta itens cujo TUSS está cadastrado como Parecer/Visita/Consulta —
              procedimentos puros ficam intocados.
            </p>
          </div>
        </div>

        {value.enabled && (
          <div className="space-y-2 pl-7">
            <div>
              <Label className="text-xs">Subtipo de parecer para itens cruzados *</Label>
              <Select
                value={value.item_type_id ?? ""}
                onValueChange={(v) => onChange({ ...value, item_type_id: v })}
              >
                <SelectTrigger className="h-9 mt-1">
                  <SelectValue placeholder="Selecione o subtipo de parecer" />
                </SelectTrigger>
                <SelectContent>
                  {parecerSubtypes.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Itens que baterem no relatório viram esse subtipo. Itens ambíguos sem batida viram Visita.
              </p>
            </div>
            {typeof ambiguousTussCount === "number" && ambiguousTussCount === 0 && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  Nenhum payment_type cadastrado nas categorias Parecer/Visita/Consulta — sem isso o cruzamento
                  não tem TUSS ambíguo para filtrar. Cadastre em <strong>Configurações → Tipos de pagamento</strong> antes.
                </span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Hook auxiliar: conta os TUSS ambíguos cadastrados (Parecer/Visita/Consulta) */
export function useAmbiguousTussCount() {
  const [count, setCount] = useState<number>(0);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("payment_types")
        .select("tuss_default, tuss_codes_extra, category, code")
        .eq("active", true);
      const set = new Set<string>();
      for (const t of (data ?? []) as any[]) {
        const cat = String(t.category ?? "").toLowerCase();
        const code = String(t.code ?? "").toLowerCase();
        const isAmb =
          cat === "parecer" || cat === "visita" || cat === "consulta" ||
          code.startsWith("parecer") || code === "visita" || code === "consulta";
        if (!isAmb) continue;
        if (t.tuss_default) set.add(String(t.tuss_default).trim());
        for (const c of (t.tuss_codes_extra ?? []) as string[]) {
          if (c) set.add(String(c).trim());
        }
      }
      setCount(set.size);
    })();
  }, []);
  return count;
}
