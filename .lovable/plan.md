## Objetivo
Adicionar rastreabilidade, pré-validação e clareza visual ao passo de vínculo de empresas (hospital → Exacta) na Conciliação de Produção.

---

## 1. Histórico versionado do mapeamento empresa→empresa

**Nova tabela** `reconciliation_company_mappings` (uma linha viva por par hospital_company_raw + run/payment, com versão):
- `payment_id`, `reconciliation_run_id` (nullable até rodar)
- `hospital_company_raw` (texto da planilha)
- `exacta_company_id` (nullable se "Ignorar")
- `decision` enum: `auto` | `manual` | `ignored` | `unmatched`
- `version` (int, incrementa por chave), `is_current` (bool)
- `changed_by`, `changed_at`, `previous_exacta_company_id`, `reason` (texto livre opcional)

Cada alteração do dropdown na tela atual cria nova linha (não UPDATE in-place), marcando a anterior `is_current=false`. Render no PaymentDetail: novo painel **"Histórico de vínculos de empresas"** com timeline (analista, de → para, motivo).

**Onde editar:** PaymentConciliationModal — interceptar `onChange` do dropdown para gravar via `supabase.from('reconciliation_company_mappings').insert(...)` antes de atualizar estado local.

---

## 2. Relatório pré-validação

Botão **"Ver relatório antes de conciliar"** ao lado de "Conciliar N empresa(s)". Abre dialog mostrando:

- **Empresas sem match Exacta** (decision=`unmatched`): lista com nome bruto + quantidade de itens/atendimentos vinculados na planilha hospitalar.
- **Empresas marcadas como Ignorar** (decision=`ignored`): mesma lista, separada.
- **Total de itens hospitalares que ficarão fora do cruzamento** (soma dos itens das duas listas acima).
- **Divergências esperadas** = preview da diferença total: para cada empresa vinculada, calcular (mesma lógica do `scopedStats.diferenca_total` por empresa) usando os items Exacta já mapeados; somar em três buckets: pago a mais, pago a menos, conciliado.
- Botão "Exportar CSV" para o relatório.

Renderiza apenas em memória (não persiste) — usa os dados já carregados em `payment_items` + mapeamento atual.

---

## 3. Rótulos e tooltips nas colunas

No header da lista de vínculos (acima do primeiro item), adicionar duas labels:

```
[Base de conciliação (hospital)]              [Base do pagamento (lote Exacta)]
 178 empresas do extrato hospitalar            empresas cadastradas neste lote
```

Cada label com `<Tooltip>` (shadcn) explicando:
- Esquerda (cinza): "Empresas como aparecem no extrato/planilha hospitalar enviada. São a base do cruzamento — para cada uma, escolha a empresa equivalente do lote Exacta."
- Direita (verde): "Empresas cadastradas neste pagamento/lote do Exacta. É o universo permitido para vinculação. 'Ignorar' exclui a linha da conciliação."

Também adicionar legenda discreta no topo do bloco confirmando o sentido do mapeamento: `hospital → Exacta`.

---

## Detalhes técnicos

- Migration: `reconciliation_company_mappings` + GRANTs (authenticated R/W, service_role ALL) + RLS por hospital_id do payment via has_role/payment ownership.
- Versionamento: trigger BEFORE INSERT que: (a) busca max(version) para a chave (payment_id, hospital_company_raw), (b) seta version = max+1, (c) marca anteriores `is_current=false`.
- Audit: já temos `audit_log` — registrar action `company_mapping_changed` com payload {from, to, hospital_raw}.
- Bump `RECONCILIATION_LOGIC_VERSION_DATE` para 2026-06-04T13:00:00Z.
- Sem mudança no motor de conciliação em si — só captura de decisão + UI.

## Arquivos afetados
- `supabase/migrations/2026XXXX_company_mappings_audit.sql` (novo)
- `src/components/payment-detail/PaymentConciliationModal.tsx` (header com tooltips, hook nos dropdowns, botão relatório)
- `src/components/payment-detail/CompanyMappingHistory.tsx` (novo — timeline)
- `src/components/payment-detail/PreReconciliationReport.tsx` (novo — dialog do relatório)

## Fora de escopo
- Não altera matching engine, chaves de lookup, nem cálculos de diff.
- Não muda fluxo de aprovação/notificação.
- Não toca em `payment_items` schema.
