# Reabertura de acordo rejeitado (Corrigir e reenviar)

Hoje um acordo rejeitado por um diretor fica travado no status `rejeitado`. O objetivo é devolver o acordo ao Setor de Contratos, permitir correção e reiniciar o ciclo completo, sem perder o histórico da rejeição.

## Banco (1 migration)

**Nova tabela `agreement_registration_events`** — histórico imutável do fluxo:
`id`, `agreement_id` (FK, on delete cascade), `hospital_id` (nulo quando o evento é do acordo todo), `cycle` (int, número do ciclo de aprovação), `event_type` (`rejeicao_diretor` | `reenvio_contratos`), `actor_id`, `notes`, `created_at`.
GRANTs para `authenticated`/`service_role`, RLS de leitura via a função `can_access_agreement()` já existente; escrita somente pela função abaixo.

**Nova função `resubmit_agreement_after_rejection(p_agreement_id uuid)`** (security definer):
1. Confere que o acordo está em `rejeitado` e que quem chama é o `filled_by`, ou tem papel `admin`/`analista`/`gestao_medica`.
2. Grava em `agreement_registration_events` uma linha por hospital rejeitado (motivo, diretor, data) + uma linha `reenvio_contratos`, antes de limpar qualquer campo.
3. Zera nas linhas de `agreement_registration_hospitals`: `status = 'aguardando_diretor'`, `director_id`, `director_approved_at`, `director_notes`, `rejection_reason` nulos.
4. Zera no acordo: `supervisor_id`, `supervisor_validated_at`, `supervisor_notes`, `rejection_reason` e coloca `status = 'aguardando_supervisor'`.

Efeito prático: o acordo volta ao início do ciclo (supervisor → diretores → analista) e o motivo antigo continua consultável.

## Frontend

**`src/lib/agreementRegistrations.ts`**
- Tipo `AgreementEventRow` e rótulos dos tipos de evento.
- `buildAgreementTimeline` passa a aceitar os eventos e acrescenta ao final as entradas históricas ("Rejeitado por diretor — hospital, motivo" e "Reenviado pelo Contratos").

**`src/components/relacionamento/AgreementDetailDialog.tsx`**
- Carrega `agreement_registration_events` junto dos hospitais.
- Banner destacado quando `status = 'rejeitado'`: lista hospital, motivo (`rejection_reason`) e diretor/data de cada linha rejeitada.
- Botão **"Corrigir e reenviar"** visível nesse status para `filled_by` ou papéis contratos/admin: abre o wizard editável com os dados atuais (via novo callback `onEdit`).
- Timeline mostra o histórico de ciclos anteriores.

**`src/components/relacionamento/AgreementWizardDialog.tsx`**
- Aceita abrir um registro em `rejeitado` (hoje só rascunho chega aqui).
- Ao concluir um acordo que estava rejeitado, chama a função `resubmit_agreement_after_rejection` em vez de apenas gravar o status, garantindo o log e a limpeza atômica das linhas de hospital.

**`src/pages/AgreementRegistrations.tsx`**
- Carrega os motivos de rejeição dos acordos listados e mostra, abaixo do badge "Rejeitado", o hospital e o motivo (truncado, com tooltip).
- `openRecord` continua abrindo o detalhe; a edição passa a ser disparada pelo botão do detalhe.

## Fora do escopo

- Não altera as regras de aprovação do supervisor/diretor/analista.
- Não altera o PDF do acordo.
