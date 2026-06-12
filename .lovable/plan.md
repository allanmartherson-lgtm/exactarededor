# Importação histórica (Caminho B)

Objetivo: subir as bases de pagamento de **jan–abr/2026** rodando o motor por completo (regras, repasses, glosas, aliases, KPIs, DRE), mas **sem** disparar fluxo operacional (validador, diretor, NF, magic link, SLA, notificações).

## Decisões confirmadas
- Caminho B — motor roda e gera divergência retroativa
- Escopo: só pagamentos (glosas/NFs ficam fora nesta fase)
- Permissão: admin/diretor + analista sênior (flag `is_senior` ou role `analista_senior`)
- Janela travada: `competencia` entre `2026-01-01` e `2026-04-30`

## Mudanças

### 1. Banco
Migração adicionando em `payments`:
- `import_mode text not null default 'normal'` — `'normal' | 'historico'`
- `origem text not null default 'fluxo'` — `'fluxo' | 'historico'`
- `historico_window_start date`, `historico_window_end date` (auditoria)
- check: `import_mode='historico'` ⇒ `competencia` dentro da janela global `[2026-01-01, 2026-04-30]`

Em `payment_company_groups`:
- coluna virtual via view? não — basta herdar via FK; UI lê do `payments`.

Nova role: `app_role` ganha valor `analista_senior` (ou flag `profiles.is_senior boolean`). Vou usar **flag** `profiles.is_senior` para não fragmentar enum.

Trigger `trg_payments_historico_guard`:
- bloqueia transições de status em pagamentos com `import_mode='historico'` que saiam de `pago`/`arquivado`
- bloqueia criação de pendência, observation, magic link, NF request, notificação para payment histórico
- libera somente leitura + reabrir (admin) + soft cancel

### 2. Motor (`analyze-payment`)
- Recebe `import_mode` no contexto do job
- Se `historico`: roda cálculo (gross/expected/diff/aliases) e marca cada item `ai_status='processado_historico'`
- **Pula**: criação de `pendencias`, `payment_director_notifications`, `notification_queue`, `comm_*`, `magic_link_tokens`
- Ao final: seta `payments.status='pago'`, `origem='historico'`, `analysis_mode='historico'`
- `rule_calculations` é gravado normal (alimenta DRE/KPIs)
- Aprendizado de alias (`learnCompanyAlias`, doctor/convenio/sector) **roda igual**

### 3. UI
- `src/pages/Payments.tsx`: badge "Histórico" + filtro `origem`
- `src/components/payment-upload/*`: novo toggle "Importação histórica" (visível só pra admin/diretor/senior); ao ligar, mostra alerta "este lote pula validação/aprovação/NF e fica em status PAGO"
- `src/lib/paymentFlow.ts`: `isHistorico(payment) ⇒` todos os `can*` retornam false exceto leitura/relatório
- `CompanyAnalysis.tsx`: banner amarelo no topo "Pagamento histórico — somente leitura"
- Dashboard/KPIs: adicionar toggle "incluir histórico" (default ligado para indicadores de aprendizado, desligado para fila operacional)

### 4. Permissão
- `profiles.is_senior boolean default false`
- página `/usuarios`: admin liga/desliga flag
- gate no upload: `isAdmin || isDiretor || (isAnalista && isSenior)`

### 5. KPIs retroativos
- View `vw_intervention_savings_historico` mostrando soma de `diferenca_regra` dos pagamentos `origem='historico'` — "quanto a Exacta teria pego no período pré-go-live"
- Card no `ExecutiveDashboard`: "Divergência retroativa identificada — R$ X em 4 meses"

## Detalhes técnicos

```text
upload (admin/senior)
  └─> payments {import_mode:'historico', competencia:in_window}
      └─> orchestrate-analysis (passa flag)
          └─> analyze-payment
              ├── rule_calculations  ✅
              ├── aliases learned    ✅
              ├── diferenca_regra    ✅
              ├── pendencias         ⏭️ skip
              ├── notifications      ⏭️ skip
              ├── magic links        ⏭️ skip
              └── status = 'pago', origem='historico'
```

## Arquivos a tocar
- `supabase/migrations/2026xxxx_historico_mode.sql` (novo)
- `supabase/functions/analyze-payment/index.ts`
- `supabase/functions/orchestrate-analysis/index.ts`
- `supabase/functions/dispatch-payment-analysis/index.ts`
- `src/lib/paymentFlow.ts`
- `src/pages/Payments.tsx` (filtro + badge)
- `src/components/payment-upload/` (toggle + validação janela)
- `src/pages/CompanyAnalysis.tsx` (banner read-only)
- `src/pages/ExecutiveDashboard.tsx` (card divergência retroativa)
- `src/pages/Users.tsx` (toggle is_senior)
- `src/integrations/supabase/types.ts` (auto)

## Fora de escopo desta fase
- Glosas históricas
- NFs históricas
- Aprovação retroativa por diretor
- Reabrir pagamento histórico para reprocessamento (admin pode via SQL se necessário)

Confirma que posso seguir?