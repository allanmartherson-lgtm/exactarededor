/**
 * PoolAnalysis — tela unificada para lotes de pool.
 *
 * REGRA-CHAVE: em pagamento de pool, o item não pertence a uma PJ específica.
 * Os itens são coletivos do pool (is_pool_item = true, company_id = NULL). O
 * rateio financeiro entre as PJs participantes é feito pelo cálculo do pool
 * (payment_company_financials por PJ), não pela soma direta dos itens.
 *
 * Esta página renderiza:
 *  - Header do lote (status, pool, ações)
 *  - N cards por PJ participante (bruto/descontos/líquido/participação)
 *  - Cálculo do pool (recalc)
 *  - Quarentena (itens promovidos ao pool sem dono)
 *  - Lista única de atendimentos (sem coluna empresa, sem filtro por PJ)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Building2, Layers } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { ItemsDataGrid } from "@/components/payment-detail/ItemsDataGrid";
import { UnmatchedItemsPanel } from "@/components/payment-detail/UnmatchedItemsPanel";
import { PoolCalculationCard } from "@/components/payment-detail/PoolCalculationCard";
import { EngineSourcesCard } from "@/components/payment-detail/EngineSourcesCard";
import { MixedParecerRetroAction } from "@/components/payment-detail/MixedParecerRetroAction";

import { confirmDialog } from "@/lib/confirm";
import { usePaymentDetailData } from "@/hooks/usePaymentDetailData";
import { usePaymentTypeMeta } from "@/hooks/usePaymentTypeMeta";
import { HospitalScopedGuard } from "@/components/HospitalScopedGuard";


const brl = (n: number | null | undefined) =>
  Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type PoolInfo = { id: string; nome: string; base_calculo: string | null };
type Financial = {
  company_id: string;
  bruto: number;
  debitos: number;
  creditos: number;
  glosas: number;
  pool: number;
  conciliacao: number;
  liquido: number;
  pool_aplicado: boolean | null;
  pool_detalhes: any;
};
type CompanyRow = { id: string; name: string };

export default function PoolAnalysis() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { payment, items, obs, rulesIndex, rulesByName, profiles, load } =
    usePaymentDetailData(id);
  const paymentTypeMeta = usePaymentTypeMeta((payment as any)?.payment_model_id ?? null);

  const [pool, setPool] = useState<PoolInfo | null>(null);
  const [financials, setFinancials] = useState<Financial[]>([]);
  const [companies, setCompanies] = useState<Record<string, CompanyRow>>({});

  // Se o pagamento NÃO é pool, volta para a tela do lote (regra arquitetural).
  if (payment && !payment.pool_id) {
    return <Navigate to={`/pagamentos/${id}`} replace />;
  }

  const reloadFinancials = useCallback(async () => {
    if (!id || !payment?.pool_id) return;
    const [poolRes, finRes] = await Promise.all([
      supabase.from("pools").select("id,nome,base_calculo").eq("id", payment.pool_id!).maybeSingle(),
      supabase
        .from("payment_company_financials")
        .select("company_id,bruto,debitos,creditos,glosas,pool,conciliacao,liquido,pool_aplicado,pool_detalhes")
        .eq("payment_id", id),
    ]);
    if (poolRes.data) setPool(poolRes.data as PoolInfo);
    const fin = (finRes.data ?? []) as Financial[];
    setFinancials(fin);
    const ids = Array.from(new Set(fin.map((f) => f.company_id))).filter(Boolean);
    if (ids.length) {
      const { data: cs } = await supabase
        .from("companies")
        .select("id,name")
        .in("id", ids);
      const map: Record<string, CompanyRow> = {};
      (cs ?? []).forEach((c: any) => {
        map[c.id] = c;
      });
      setCompanies(map);
    }
  }, [id, payment?.pool_id]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!active) return;
      await reloadFinancials();
    })();
    return () => {
      active = false;
    };
  }, [reloadFinancials]);

  // Lista única de itens — só os do pool (sem dono).
  const poolItems = useMemo(
    () => items.filter((it: any) => it.is_pool_item === true),
    [items],
  );

  const totals = useMemo(() => {
    const bruto = financials.reduce((s, f) => s + Number(f.bruto || 0), 0);
    const liquido = financials.reduce((s, f) => s + Number(f.liquido || 0), 0);
    const descontos = financials.reduce(
      (s, f) =>
        s +
        Number(f.debitos || 0) +
        Number(f.glosas || 0) +
        Number(f.pool || 0) +
        Number(f.conciliacao || 0) -
        Number(f.creditos || 0),
      0,
    );
    return { bruto, liquido, descontos };
  }, [financials]);

  if (!payment) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;
  }

  return (
    <HospitalScopedGuard
      recordHospitalId={(payment as { hospital_id?: string | null } | null)?.hospital_id ?? null}
      entityLabel="pool"
      fallbackHub="/pagamentos"
    >
    <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">

      <PageHeader
        title={`Lote em pool · ${pool?.nome ?? "Pool"}`}
        description="Itens são coletivos do pool. O rateio financeiro é distribuído entre as PJs participantes."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to={`/pagamentos/${id}?voltarDoPool=1`}>
              <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Voltar ao lote
            </Link>
          </Button>
        }
      />

      <Card>
        <CardContent className="pt-4 flex flex-wrap items-center gap-3">
          <StatusBadge status={payment.status as any} />
          <Badge variant="outline" className="gap-1">
            <Layers className="h-3 w-3" /> {financials.length} PJ(s) no pool
          </Badge>
          <Badge variant="outline">{poolItems.length} item(ns)</Badge>
          <div className="ml-auto text-xs text-muted-foreground">
            Bruto <span className="font-mono text-foreground">{brl(totals.bruto)}</span> ·
            Descontos <span className="font-mono text-foreground">{brl(totals.descontos)}</span> ·
            Líquido <span className="font-mono text-foreground">{brl(totals.liquido)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Cards por PJ participante — fonte: payment_company_financials */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {financials.length === 0 && (
          <Card className="col-span-full">
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              Cálculo do pool ainda não rodou. Use o card abaixo para recalcular.
            </CardContent>
          </Card>
        )}
        {financials.map((f) => {
          const c = companies[f.company_id];
          const share = totals.liquido > 0 ? (Number(f.liquido) / totals.liquido) * 100 : 0;
          const det = Array.isArray(f.pool_detalhes) ? f.pool_detalhes[0] : null;
          const base = det ? Number(det.base ?? 0) : 0;
          const bolo = det ? Number(det.bolo ?? 0) : 0;
          const impacto = det ? Number(det.impacto ?? 0) : Number(f.pool || 0);
          const outrosDescontos = Number(f.debitos) + Number(f.glosas) + Number(f.conciliacao) - Number(f.creditos);
          return (
            <Card key={f.company_id} className="shadow-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  {c?.name ?? f.company_id.slice(0, 8)}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-xs">
                <Row label="Bruto (pago)" value={brl(f.bruto)} />
                {det && (
                  <>
                    <Row label="Base rateio (pool)" value={brl(base)} muted />
                    <Row label="Bolo líquido (pool)" value={brl(bolo)} muted />
                    <Row label="(−) Impacto do pool" value={`−${brl(impacto)}`} />
                  </>
                )}
                {outrosDescontos !== 0 && (
                  <Row label="(−) Outros descontos" value={`−${brl(outrosDescontos)}`} />
                )}
                <Row label="Quota / Líquido" value={brl(f.liquido)} strong />
                <Row label="Participação" value={`${share.toFixed(1)}%`} muted />
                {f.pool_aplicado && (
                  <Badge variant="outline" className="mt-2 text-[10px]">
                    Pool aplicado
                  </Badge>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <EngineSourcesCard paymentId={id!} />

      <MixedParecerRetroAction
        paymentId={id!}
        paymentTypeId={(payment as any)?.payment_model_id ?? null}
        paymentTypeCode={paymentTypeMeta?.code ?? null}
        paymentTypeCategory={paymentTypeMeta?.category ?? null}
        competenceMonths={((payment as any)?.competence_months ?? []).map((d: string) => d.slice(0, 7))}
        hasMixedParecer={!!(payment as any)?.has_mixed_parecer}
        allowPureType
        onApplied={async () => { await load(); await reloadFinancials(); }}
      />

      <PoolCalculationCard paymentId={id!} onRecalculated={async () => { await load(); await reloadFinancials(); }} />


      <UnmatchedItemsPanel paymentId={id!} onChanged={() => load()} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Atendimentos do pool ({poolItems.length})</CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <ItemsDataGrid
            items={poolItems as any}
            groupStatus={payment.status as any}
            rulesIndex={rulesIndex}
            rulesByName={rulesByName}
            observations={obs as any}
            profiles={profiles}
            storageKey={`poolAnalysis.${id}`}
            mode={payment.analysis_mode === "confeccao" ? "confeccao" : "analise"}
            canEdit
            onAcceptItem={async (it: any) => {
              const justification = window.prompt(
                "Justificativa para acatar a divergência (mín. 20 caracteres):",
                "",
              );
              if (!justification || justification.trim().length < 20) {
                toast.error("Justificativa muito curta", {
                  description: "Mínimo de 20 caracteres.",
                });
                return;
              }
              const { data, error } = await supabase.rpc("accept_payment_item", {
                _item_id: it.id,
                _justification: justification.trim(),
              });
              if (error) {
                toast.error("Erro ao acatar", { description: error.message });
                return;
              }
              const res = data as { ok: boolean; error?: string } | null;
              if (!res?.ok) {
                toast.error("Erro ao acatar", { description: res?.error ?? "Falha desconhecida" });
                return;
              }
              toast.success("Item acatado");
              await load();
              await reloadFinancials();
            }}
            onAcceptItemKeepPaid={async (it: any) => {
              const justification = window.prompt(
                "Justificativa para acatar MANTENDO o valor pago (mín. 20 caracteres):",
                "",
              );
              if (!justification || justification.trim().length < 20) {
                toast.error("Justificativa muito curta", { description: "Mínimo de 20 caracteres." });
                return;
              }
              const { data, error } = await supabase.rpc("accept_payment_item_keep_paid", {
                _item_id: it.id,
                _justification: justification.trim(),
              });
              if (error) {
                toast.error("Erro ao acatar", { description: error.message });
                return;
              }
              const res = data as { ok: boolean; error?: string } | null;
              if (!res?.ok) {
                toast.error("Erro ao acatar", { description: res?.error ?? "Falha desconhecida" });
                return;
              }
              toast.success("Item acatado (valor pago mantido)");
              await load();
              await reloadFinancials();
            }}
            onUndoAcceptItem={async (it: any) => {
              const ok = await confirmDialog({
                title: "Desfazer acate?",
                description: `O item voltará para "${it.acatado_status_original ?? "reprovado"}" e o valor pago original será restaurado.`,
                confirmText: "Desfazer",
                tone: "warning",
              });
              if (!ok) return;
              const { data, error } = await supabase.rpc("undo_accept_payment_item", {
                _item_id: it.id,
              });
              if (error) {
                toast.error("Erro ao desfazer", { description: error.message });
                return;
              }
              const res = data as { ok: boolean; error?: string } | null;
              if (!res?.ok) {
                toast.error("Erro ao desfazer", {
                  description: res?.error ?? "Falha desconhecida",
                });
                return;
              }
              toast.success("Acate desfeito");
              await load();
              await reloadFinancials();
            }}
            onRefresh={() => load()}
          />
        </CardContent>
      </Card>
    </div>
    </HospitalScopedGuard>
  );
}


function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={muted ? "text-muted-foreground" : ""}>{label}</span>
      <span className={`tabular-nums font-mono ${strong ? "font-semibold" : ""} ${muted ? "text-muted-foreground" : ""}`}>
        {value}
      </span>
    </div>
  );
}
