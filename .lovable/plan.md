# Evolução do cadastro de médicos

Vou executar em 4 fases, na ordem abaixo. Posso pausar entre fases se quiser revisar.

---

## Fase 1 — Form de edição (CPF + Nascimento + layout)

Tela `Médicos → Editar/Novo médico`:
- Adicionar campos **CPF** (com máscara `000.000.000-00` e validação dos dígitos verificadores) e **Data de nascimento** (input `date`).
- Reagrupar visualmente: **Identificação** (nome, CPF, nascimento) → **Conselho** (CRM, UF) → **Contato** (e-mail, telefone) → **Atuação** (especialidades, vínculo) → **Empresas/PJs** → **Observações**.
- Mostrar contagem de empresas vinculadas e badge "X pagamentos" (lookup leve por CRM/UF).

Backend já tem `cpf`, `birth_date`, `vinculo` na tabela `doctors` — sem migração necessária.

---

## Fase 2 — Reimportar planilha enriquecendo a base

Script de backfill (rodado uma vez via `supabase--insert`) que para cada linha da planilha:

1. Casa por **CRM + UF** (campo `CRM` = `28923/DF` → split).
2. Se encontrar médico existente:
   - Preenche `cpf` (se vazio), `birth_date` (se vazio), `email` (se vazio), `phone` (se vazio), `vinculo` (campo `Vínculo`).
   - Marca `active = false` se `Situação Médico = 'I'` (conforme decidido).
3. Se **`Ds Terceiro` + `CNPJ Terc.`** preenchidos:
   - Procura empresa por CNPJ (normalizado).
   - Se não existir, cria `companies` (nome + document).
   - Cria vínculo em `doctor_companies` (upsert).
4. Se médico não existe na base atual, **cria novo** com todos os campos.
5. Relatório final no console: `X atualizados, Y criados, Z vínculos PJ adicionados, W empresas novas`.

Vou rodar como query única em transação, sem edge function (mais simples para one-shot).

---

## Fase 3 — Vincular `payment_items` ao `doctor_id` (FK real)

- Migration: adicionar coluna `payment_items.doctor_id uuid` + FK + index. (Mantém `doctor_name` e `doctor_document` como texto para fallback histórico.)
- Função `enrich_doctor_documents` já existe — vou estendê-la (ou criar `enrich_doctor_ids`) para popular `doctor_id` casando por:
  1. `doctor_document` (formato `CRM/UF`) → match exato com `doctors.crm || '/' || doctors.crm_uf`
  2. fallback por `LOWER(doctor_name)` + `LOWER(full_name)` exato
- Backfill em todos os `payment_items` existentes.
- **Não toco no motor de regras agora** — ele continua usando `doctor_name`/`doctor_document` como hoje. A FK é só para queries de relatório e para o app do médico saber exatamente quais itens são dele (substituindo o match por nome).
- Atualizar `DoctorCombobox` e telas de relatório por médico para preferir `doctor_id` quando presente.

---

## Fase 4 — App do médico: login/match por CPF além de CRM

- App do médico (projeto `b4be2018-...`) hoje vincula por CRM. Vou adicionar fallback por CPF:
  - Tela "Meu perfil" passa a exibir CPF (read-only se já preenchido pelo cadastro mestre).
  - Ao logar via `doctor_portal_users`, se houver `cpf` no `doctors`, query também por CPF.
- Garantir que `doctor_portal_users` tem `doctor_id` correto (já tem FK).
- **Não muda lógica de extrato** — extrato continua puxando por `doctor_id`, agora confiável graças à Fase 3.

---

## Ordem de entrega

Entrego Fase 1+2 juntas (uma rodada de chat), depois Fase 3, depois Fase 4. Cada fase termina com verificação no banco e print do resultado.

Quer começar? Se quiser inverter ordem ou pular alguma, só falar.
