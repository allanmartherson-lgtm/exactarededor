// Piso mínimo de repasse por hospital.
// Regra híbrida (C): sempre preservar max(pct% do líquido, R$ mínimo) para que a PJ
// receba algo do lote e emita NF, mesmo quando a glosa "caberia" no líquido total.
// Consumido por supabase/functions/apply-company-deductions/index.ts.
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { resolveActiveHospitalId } from "@/lib/resolveActiveHospitalId";
import { toast } from "sonner";
import { Save, ShieldCheck } from "lucide-react";

export default function PisoRepasse() {
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [pct, setPct] = useState<number>(0);
  const [brl, setBrl] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    document.title = "Piso de Repasse | Exacta";
    (async () => {
      setLoading(true);
      try {
        const hid = await resolveActiveHospitalId();
        setHospitalId(hid);
        if (!hid) return;
        const { data, error } = await supabase
          .from("hospital_settings")
          .select("min_payout_pct, min_payout_brl")
          .eq("hospital_id", hid)
          .maybeSingle();
        if (error) throw error;
        setPct(Number(data?.min_payout_pct ?? 0));
        setBrl(Number(data?.min_payout_brl ?? 0));
      } catch (err: any) {
        toast.error(`Falha ao carregar: ${err?.message ?? String(err)}`);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const save = async () => {
    if (!hospitalId) return;
    if (pct < 0 || pct > 100) { toast.error("Percentual deve estar entre 0 e 100."); return; }
    if (brl < 0) { toast.error("Valor mínimo não pode ser negativo."); return; }
    setSaving(true);
    try {
      const { error } = await supabase
        .from("hospital_settings")
        .upsert({ hospital_id: hospitalId, min_payout_pct: pct, min_payout_brl: brl }, { onConflict: "hospital_id" });
      if (error) throw error;
      toast.success("Piso de repasse salvo. Novas aplicações já respeitam a regra.");
    } catch (err: any) {
      toast.error(`Falha ao salvar: ${err?.message ?? String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const exemplo10k = Math.max(10000 * (pct / 100), brl);
  const exemplo1500 = Math.max(1500 * (pct / 100), brl);

  return (
    <>
      <PageHeader
        title="Piso mínimo de repasse"
        description="Nunca descontar glosas ao ponto de zerar o líquido da PJ. Garante que a clínica sempre receba algum valor e emita NF."
        icon={ShieldCheck}
      />
      <div className="p-8 max-w-2xl space-y-6">
        <Card>
          <CardContent className="p-6 space-y-5">
            <div className="text-sm text-muted-foreground">
              A cada aplicação de glosa, o motor calcula:
              <div className="mt-2 rounded-md bg-muted px-3 py-2 font-mono text-xs">
                piso = max( <span className="text-primary">percentual</span> × líquido do lote, <span className="text-primary">valor mínimo</span> )<br />
                capacidade de desconto = líquido − piso
              </div>
              Se a glosa não coube dentro da capacidade, a tela de Créditos e Débitos oferece <strong>parcelar</strong> ou <strong>adiar</strong> — nada é aplicado silenciosamente.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="pct">Percentual do líquido a preservar (%)</Label>
                <Input
                  id="pct" type="number" min={0} max={100} step={1}
                  value={pct} onChange={(e) => setPct(Number(e.target.value))}
                  disabled={loading || saving}
                />
                <p className="text-[11px] text-muted-foreground">Ex.: 20% preserva sempre 1/5 do líquido.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="brl">Valor mínimo em R$ a preservar</Label>
                <Input
                  id="brl" type="number" min={0} step={50}
                  value={brl} onChange={(e) => setBrl(Number(e.target.value))}
                  disabled={loading || saving}
                />
                <p className="text-[11px] text-muted-foreground">Ex.: R$ 500 garante NF mínima mesmo em lote pequeno.</p>
              </div>
            </div>

            <div className="rounded-md border p-3 text-xs text-muted-foreground bg-muted/40">
              <div className="font-medium text-foreground mb-1.5">Simulação com estes valores</div>
              <div>Lote com líquido de R$ 10.000 → preservados <strong className="text-foreground">R$ {exemplo10k.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong> · capacidade de desconto <strong className="text-foreground">R$ {(10000 - exemplo10k).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong></div>
              <div>Lote com líquido de R$ 1.500 → preservados <strong className="text-foreground">R$ {exemplo1500.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong> · capacidade de desconto <strong className="text-foreground">R$ {Math.max(0, 1500 - exemplo1500).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong></div>
            </div>

            <div className="flex justify-end">
              <Button onClick={save} disabled={loading || saving || !hospitalId}>
                <Save className="h-4 w-4 mr-1" />
                {saving ? "Salvando…" : "Salvar piso"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          Configuração é <strong>por hospital ativo</strong>. Só admin/diretor podem alterar.
          Piso 0/0 significa "sem piso" — o comportamento antigo, glosa pode zerar o líquido.
        </p>
      </div>
    </>
  );
}
