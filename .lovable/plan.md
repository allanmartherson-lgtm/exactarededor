## Objetivo
Acabar com vínculos médico↔PJ em texto livre. Toda menção vira linha em `doctor_companies` (quando o CNPJ existe no cadastro) ou fila de revisão (quando não existe). Cadastros de médico e empresa passam a refletir um ao outro.

## 1. Edge function `sync-doctor-company-from-notes` (one-shot + on-save)
- Lê `doctors.notes` (todos), extrai CNPJs com regex (`\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}`) e CRMs.
- Para cada CNPJ encontrado:
  - Se existe em `companies.document` → cria linha em `doctor_companies` (idempotente, `ON CONFLICT DO NOTHING`).
  - Se não existe → grava em nova tabela `doctor_link_suggestions` (status `pending`) para o admin tratar em `/medicos`.
- Roda uma vez agora (botão "Migrar agora" no painel admin) e em todo `UPDATE doctors.notes` via trigger leve (queue na mesma tabela de sugestões).

## 2. Tabela `doctor_link_suggestions`
Colunas: `doctor_id`, `raw_text`, `detected_kind` (cnpj/crm), `detected_value`, `matched_company_id`/`matched_doctor_id` (nullable), `status` (pending/approved/rejected), `resolved_by`, `resolved_at`.
RLS: admin + diretor.
Painel em `/medicos` → aba "Pendências de cadastro" recebe novo grupo "Vínculos sugeridos por texto".

## 3. Espelho no modal de empresa (`src/pages/Companies.tsx`)
Adicionar seção "MÉDICOS VINCULADOS" idêntica em comportamento à do médico:
- Busca + checkbox lendo/escrevendo `doctor_companies`.
- Mesmo aviso: "Alterações refletem em tempo real no cadastro do médico."
- Histórico de vínculos encerrados (mesma fonte usada hoje em `Doctors.tsx`).

## 4. Aba "Vínculos" em ambos os cadastros
Tab nova no modal de médico **e** no de empresa:
- Médico → lista de PJs com período (start/end), motivo de encerramento, origem (manual/observação/import).
- PJ → mesma tabela espelhada com médicos.
- Reaproveita componente `DoctorCompanyLinksTable` (criar).

## 5. Renomear "Observações internas" → "Notas operacionais"
- Label e placeholder alterados.
- Validador no submit: se detectar CNPJ ou CRM no texto, **abre dialog** "Detectamos uma PJ/CRM. Crie o vínculo formal antes de salvar." com botão "Criar vínculo agora" (abre modal de seleção) ou "É só um lembrete, ignorar" (registra `notes_validated_at` para não avisar de novo no mesmo texto).
- Renderiza CNPJs/CRMs detectados como chips clicáveis que abrem o modal de vínculo.

## 6. Documentação
- Atualizar `mem://constraints/vinculos-estruturados.md` com os novos pontos de entrada.
- README curto da edge function.

## Ordem de execução
1. Migration: tabela `doctor_link_suggestions` + grants + RLS.
2. Edge function de varredura/sync + botão "Migrar agora" no painel admin.
3. Painel de revisão das sugestões.
4. Espelho na tela de empresa.
5. Aba "Vínculos" reutilizável.
6. Renomeação + validador de notas.

## Notas técnicas
- Trigger de inserção automática roda **somente quando CNPJ bate exatamente** no `companies.document` (sem fuzzy) — respeita a regra "Lookup estrito".
- O texto original em `doctors.notes` **não é apagado**; só recebe um marcador `[vinculado em YYYY-MM-DD]` ao lado do CNPJ promovido, para o analista entender a origem.
- Edge function reaproveita `src/lib/cnpj.ts` (`onlyDigits`, `formatCNPJ`).
- Sem default hardcoded: se houver CNPJ ambíguo (ex: empresa inativa, múltiplas matches), vai para sugestão, nunca cria silenciosamente.

## Fora de escopo (próxima onda)
- Mesma varredura em `companies.notes` e em `payment_observations` (fica para depois).
- Inferência de CRM em notas (priorizamos CNPJ; CRM em texto livre é raro).
