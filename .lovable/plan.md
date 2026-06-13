
# Re-aprovação pós-aprovação (por empresa)

Objetivo: quando um grupo de empresa já aprovado sofre alteração relevante (valor acima do limiar do hospital, ou troca de PJ), aquele grupo (e o destino, no caso de troca) volta sozinho ao diretor para nova aprovação — sem reabrir o lote inteiro — gerando uma nova versão do "de acordo" e mantendo histórico auditável.

## Decisões já fechadas

- **Unidade**: `payment_company_group`. Outros grupos do lote seguem rumo a NF/pago.
- **Gatilho de valor**: configurável por hospital (`hospital_settings.reapproval_threshold_pct` e `reapproval_threshold_brl`; default 0% / R$ 0,01).
- **Troca de PJ**: re-aprovação total dos **dois** grupos afetados (origem + destino).
- **Granularidade**: re-aprova o **grupo inteiro** (novo "de acordo" completo substitui o anterior).
- **Versionamento**: ativo desde o MVP; documento vigente é sempre a última versão; anteriores ficam como histórico.

## Mudanças no banco

### 1. `hospital_settings` (estender, criar se não existir)
- `reapproval_threshold_pct` numeric default 0
- `reapproval_threshold_brl` numeric default 0.01
- `reapproval_require_reason` boolean default true

### 2. `payment_company_groups` (estender)
- `approval_version` int default 0 — incrementado a cada novo "de acordo".
- `reapproval_pending` boolean default false
- `reapproval_reason` text — preenchido pelo analista ou trigger automático.
- `reapproval_triggered_at` timestamptz
- `reapproval_trigger_source` enum (`analyst_edit`, `invoice_pendency`, `company_change_source`, `company_change_destination`)
- `last_approved_bruto`, `last_approved_liquido` numeric — snapshot do último de acordo (para o trigger comparar).
- `last_approved_company_id` uuid — idem para detectar troca.

### 3. Nova tabela `company_group_approvals` (histórico imutável)
```
id, payment_company_group_id, version, approved_by, approved_at,
bruto_total, liquido_total, company_id, items_snapshot jsonb,
pdf_url text, magic_link_token_id uuid,
superseded_at timestamptz, superseded_by_version int,
reason text, hospital_id uuid
```
- GRANT padrão (authenticated SELECT/INSERT/UPDATE/DELETE, service_role ALL).
- RLS: usuários do hospital ativo + service_role.

### 4. Triggers
- `trg_detect_group_reapproval` (AFTER UPDATE em `payment_company_groups` quando `approval_version > 0`): compara `bruto_total`/`liquido_total`/`company_id` contra os `last_approved_*`. Se delta acima do threshold do hospital ou troca de empresa → `reapproval_pending = true`, registra `reapproval_trigger_source` e enfileira notificação.
- `trg_block_group_advance_on_reapproval` (BEFORE UPDATE em `payment_company_groups`): impede avançar para `pedido_nf_enviado`, `nf_conciliada`, `lancado`, `pago` enquanto `reapproval_pending = true`.
- `trg_company_change_dual` (AFTER UPDATE em `payment_items` quando muda `company_id` e o grupo origem está aprovado): marca ambos os grupos (origem + destino) como pendentes.
- `trg_approval_snapshot` (AFTER INSERT em `company_group_approvals`): atualiza `payment_company_groups.last_approved_*`, incrementa `approval_version`, zera `reapproval_pending`, marca versão anterior como `superseded`.

## Edge functions

### Novas
- `regenerate-de-acordo` — gera novo PDF para a versão N do grupo, salva em storage, retorna `pdf_url` para inserir em `company_group_approvals`.
- `notify-director-reapproval` — variação do `notify-director-approval` com payload de diff (antes vs depois, motivo, link para versão anterior). Reusa magic link existente, action = `approve_reapproval`.

### Alterar
- `approve-via-magic-link` — aceitar action `approve_reapproval`/`reject_reapproval`. Em aprovação: insere row em `company_group_approvals` (trigger faz o resto) e dispara `regenerate-de-acordo`. Em rejeição: devolve para analista com observação obrigatória.
- `dispatch-payment-analysis` / fluxo de NF: respeitar gate de `reapproval_pending` (já bloqueado em trigger, mas evita 500 silencioso).

## Frontend

### `CompanyAnalysis.tsx` e modal de pagamento
- Badge **"Re-aprovação pendente"** quando `reapproval_pending=true` — cor âmbar, ao lado do status.
- Painel de diff: tabela "Versão N (atual) vs Versão N-1 (aprovada)" com bruto/líquido/empresa.
- Campo de motivo obrigatório quando analista altera valor/empresa de grupo aprovado (popup antes de salvar).
- Aba "Histórico de aprovações" no grupo: lista `company_group_approvals` com link para cada PDF.

### `Payments.tsx`
- Filtro/coluna nova: "Grupos pendentes de re-aprovação" (contagem).
- Indicador visual no card de pagamento quando há ≥1 grupo pendente.

### Aprovação por magic link (`ApproveMagicLink.tsx`)
- Renderizar diff antes/depois quando `act = approve_reapproval`.
- Mostrar motivo do analista + link para PDF da versão anterior.

### Conexão com fluxo de NF/pendência
- `InvoicePortal.tsx` / fluxo de pendência da empresa: quando analista aceita uma correção significativa que altera valor, marcar `reapproval_trigger_source = 'invoice_pendency'` ao salvar.

## Notificações

- Reusar `notification_queue` com novo `kind = 'director_reapproval'`.
- Handler novo em `notification-queue-worker/handlers/directorReapproval.ts`.
- Debounce idêntico ao `director_approval` (60s) — alterações múltiplas no mesmo grupo agregam.
- E-mail/WhatsApp com diff resumido e botão único de magic link.

## Memória do projeto
Adicionar `mem://features/reapproval-flow` cobrindo: unidade = grupo, threshold por hospital, versionamento obrigatório, troca de PJ afeta dois grupos, gate de avanço.

## Testes
- Contract test: alteração de bruto acima do threshold marca pendente; abaixo, não.
- Contract test: troca de `company_id` em item aprovado marca origem + destino.
- Contract test: tentativa de avançar para `pedido_nf_enviado` com pendência → erro.
- E2E magic link: aprovar re-aprovação gera versão N+1, supersede versão anterior, libera avanço.

## Ordem de implementação
1. Migration: `hospital_settings` + colunas em `payment_company_groups` + tabela `company_group_approvals` + triggers.
2. Edge functions: `regenerate-de-acordo`, `notify-director-reapproval`, ajustes em `approve-via-magic-link`.
3. Handler `directorReapproval` no worker.
4. Frontend: badge, diff, motivo obrigatório, aba de histórico, filtro em Payments.
5. Atualização do `ApproveMagicLink` para o novo action.
6. Testes + memória.

## Pontos técnicos (skip se não quiser detalhe)
- Snapshot de itens em `items_snapshot jsonb` guarda hash + valores por item para auditoria, sem duplicar payment_items.
- `approval_version` é monotônico por grupo; nunca decrementa mesmo em rejeição (a rejeição cria evento em `payment_observations`, não nova versão).
- Trigger de detecção compara contra `last_approved_*`, não contra versão anterior em `company_group_approvals`, para evitar lock cross-table em hot path.
