# Separação de status: Confecção × Análise

Hoje `em_confeccao` mora dentro do enum `payment_status` e divide o mesmo ciclo da Análise, distinguido só por `analysis_mode`. Vamos isolar Confecção em seu próprio enum + colunas dedicadas, com guards de banco que impedem mistura.

## 1. Banco — migração principal

**Novo enum**
```sql
CREATE TYPE confeccao_status AS ENUM (
  'em_confeccao',
  'confeccao_concluida',
  'cancelada'
);
```

**Novas colunas** (em `payments` e `payment_company_groups`):
- `confeccao_status confeccao_status NULL`
- `confeccao_finalized_at timestamptz NULL`
- `confeccao_finalized_by uuid NULL`

`payments.status` (enum atual) continua sendo a fonte de verdade do ciclo de **Análise**. Em modo confecção, `status` fica em `NULL`-equivalent operacional: usaremos `rascunho` como placeholder até a finalização (não aparece em telas de Análise por causa do filtro de mode).

**Trigger de coerência** (`enforce_mode_status_separation`):
- Se `analysis_mode = 'confeccao'`: `confeccao_status` é obrigatório; `status` só pode ser `rascunho`, `arquivado` ou `cancelado`. Bloqueia setar `em_analise_ia`, `revisao_analista`, etc.
- Se `analysis_mode <> 'confeccao'`: `confeccao_status` deve ser `NULL`; `status` segue o enum de Análise.
- Bloqueia voltar de Análise para Confecção (transição unidirecional).

**Backfill** (mesma migração):
- Lotes/grupos com `analysis_mode='confeccao'` e `status='em_confeccao'` → `confeccao_status='em_confeccao'`, `status='rascunho'`.
- Lotes em modo confecção que já avançaram para `em_analise_ia`/`revisao_analista` (transição já feita pelo botão "Encaminhar para análise") → `confeccao_status='confeccao_concluida'`, `analysis_mode` muda para `padrao` e `status` é preservado.

**Remoção do valor `em_confeccao` do enum `payment_status`**: NÃO faremos agora (Postgres não permite drop de valor de enum sem recriar). Em vez disso, o trigger impede novos usos; deixamos uma TODO de limpeza futura.

## 2. Transição Confecção → Análise

Nova função SQL `finalize_confeccao(payment_id uuid)`:
1. Verifica `confeccao_status='em_confeccao'`.
2. Seta `confeccao_status='confeccao_concluida'`, `confeccao_finalized_at=now()`, `confeccao_finalized_by=auth.uid()`.
3. Faz `analysis_mode := 'padrao'`, `status := 'em_analise_ia'`.
4. Replica nos `payment_company_groups` filhos.
5. Registra em `audit_log` e `payment_status_history`.

O botão "Finalizar Confecção" (lote) passa a chamar esta RPC em vez de mexer em `status`/`analysis_mode` direto pelo cliente.

## 3. Código (frontend + edge functions)

- `src/lib/status.ts`: adicionar `ConfeccaoStatus` type + labels; remover `em_confeccao` dos mapas de Análise (mantendo fallback de label para histórico).
- `src/lib/paymentFlow.ts` e `src/lib/companyGroupGuards.ts`: tirar `em_confeccao` dos sets `ANALYST_EDITABLE_STATUSES` / `EDITABLE_COMPANY_GROUP_STATUSES`; criar `CONFECCAO_EDITABLE` separado. Helpers passam a aceitar `{ status, confeccaoStatus, analysisMode }`.
- `src/pages/PaymentDetail.tsx`, `CompanyAnalysis.tsx`, `ItemsDataGrid.tsx`: ler `confeccao_status` para decidir banners, edição, botões. `isConfeccao` deriva de `analysis_mode==='confeccao' || confeccao_status!=null` (cobre histórico).
- Botão "Finalizar Confecção" → chama `rpc('finalize_confeccao', …)`.
- `supabase/functions/dispatch-payment-analysis/index.ts` e `analyze-payment/index.ts`: gate de `EDITABLE_STATUSES` em modo confecção passa a olhar `confeccao_status='em_confeccao'` em vez de `status='em_confeccao'`.
- `NewPayment.tsx`: ao criar lote em modo confecção, inserir `confeccao_status='em_confeccao'` + `status='rascunho'`.

## 4. Testes

- Atualizar `CompanyAnalysis.confeccao.contract.test.ts` e `ItemsDataGrid.confeccao.test.ts` para a nova forma.
- Novo teste de contrato: trigger rejeita `status='em_analise_ia'` quando `analysis_mode='confeccao'`; rejeita `confeccao_status` setado em modo padrão.
- Novo teste do RPC `finalize_confeccao` (transição completa).

## 5. Rollout

Migração e código vão juntos. Como há apenas 1 payment + 9 grupos em `em_confeccao` em produção e 0 fluxos pendentes de validação a partir de confecção, o backfill é seguro em uma única janela.

## Riscos
- Telas legadas que ainda esperam `status='em_confeccao'` precisam ler `confeccao_status`. O passo 3 cobre as conhecidas, mas pode existir filtro avulso — vou rodar `rg` final antes de fechar.
- Não conseguimos remover `em_confeccao` do enum sem recriar o tipo (impactaria muitas views/funções). Mantemos como valor legado bloqueado por trigger.

Posso seguir com a migração?