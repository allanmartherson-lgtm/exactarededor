# Cruzamento obrigatório com bases de cadastro

Auditoria identificou 16 pontos onde o sistema ainda compara por texto livre em vez de cruzar com as tabelas de cadastro (`convenios`, `sectors`, `doctors`, `companies`). Proposta em 3 ondas, priorizando os pontos onde regras falham silenciosamente.

---

## Onda 1 — P1: pontos onde regras silenciosamente não disparam

### 1.1 Médico por ID (não por nome)
- `rule_calculations.group_doctors[]` e `group_company_links[].doctors[]` passam a guardar `{ id, name, crm }`.
- `MultiSelectChips.tsx` / `DoctorCombobox` injetam `id` no payload.
- `rulesEngine.ts` (linhas 580, 619–679): comparar por `doctor_id` primeiro; nome só como fallback com aviso em log.
- `rules.target_doctor_id` adicionada (já existe `target_company_id` análogo) e usada quando `scope=especifica/medico`.

### 1.2 Empresa por ID no analyze-payment
- `analyze-payment/index.ts` (182–202): receber `company_id` do payload em vez de resolver por `.eq("name", company_name)`. Cair para resolução por nome só se id não vier.
- Backfill: migration que popula `rules.target_company_id` a partir de `target_name` quando vazio (matching exato + alias de `companies.aliases`).

### 1.3 Simulador puxa da tabela de convênios
- `RuleSimulator.tsx` (460–510): `AgreementCombobox` consulta `convenios` (slug + nome) em vez de `payment_items.agreement_text`. Usuário escolhe um convênio cadastrado; simulador normaliza item via `CONVENIO_MAP` antes de comparar.

---

## Onda 2 — P2: travar UI para não sobrescrever escolha do cadastro

### 2.1 Rules.tsx — campos read-only após combobox
- `CompanyCombobox` (1863–1895): CNPJ + Nome ficam `readOnly` após seleção. Botão "limpar" para reescolher.
- `DoctorCombobox` (1895, 1916, 1919): mesmo tratamento para Nome + CRM.
- Import draft (linha 2624): substituir `<Input target_name>` por `CompanyCombobox`.

### 2.2 SectorMultiSelect — só aceitar slug cadastrado
- Bloquear adição de texto livre; texto legado entra como badge âmbar (igual ConvenioMultiSelect).

---

## Onda 3 — P3: limpeza de fallbacks permissivos

### 3.1 Convênio — legacy `agreement_name`
- Em `convert-rules` e save de regra, coagir `agreement_name`/`agreement_aliases` para slug oficial quando houver match no registro; manter texto livre só quando nenhum convênio bate (com alerta visível no editor).
- `targetsAgreement()` (rulesEngine 767–790): remover fallback `startsWith`; exigir match exato de slug após normalização (o `CONVENIO_MAP` já cobre aliases). Reduz falsos positivos.

### 3.2 Setor — reduzir heurística regex
- `inferItemSector()` (443–457): manter passos 1–3 (campo direto, alias, `procedure_classifications`); remover regex hardcoded das etapas 4–6 — itens não classificados viram `sem_setor` com alerta, forçando cadastro no `procedure_classifications`.

### 3.3 Import wizard — empresa por CNPJ
- `import-wizard/index.ts` (186–265): tentar match por `document` (CNPJ) antes de `name.toLowerCase()`.

---

## Migrations necessárias

1. `ALTER TABLE rules ADD COLUMN target_doctor_id uuid REFERENCES doctors(id)` + index.
2. Backfill `rules.target_company_id` por nome/alias.
3. Backfill `rules.target_doctor_id` por nome+CRM.
4. (Opcional) Backfill `rule_calculations.group_doctors[].id` via match nome+CRM.

---

## Arquivos a editar

**Edge functions:** `supabase/functions/_shared/rulesEngine.ts`, `supabase/functions/analyze-payment/index.ts`, `supabase/functions/import-wizard/index.ts`, `supabase/functions/convert-rules/index.ts`

**UI:** `src/pages/Rules.tsx`, `src/pages/RuleSimulator.tsx`, `src/components/MultiSelectChips.tsx`, `src/components/rules/SectorMultiSelect.tsx`, `src/components/rules/RuleCalculationsEditor.tsx`

---

## O que NÃO muda

- ConvenioMultiSelect (já migrado).
- Estrutura de `payment_items` (a base tratada continua chegando como texto — só a interpretação cruza com cadastro).
- Lógica de cálculo de regras (só o matching alvo/escopo muda).

---

Quer que eu execute as 3 ondas em sequência, ou prefere aprovar onda por onda (cada uma fecha uma classe de bug)?