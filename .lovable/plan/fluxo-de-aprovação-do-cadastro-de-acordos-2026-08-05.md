# Fluxo de aprovação do Cadastro de Acordos

Supervisor → Diretores (por hospital) → Analista de regras → PDF do acordo.
Reuso total do design atual: `PageHeader`, `Tabs`, `Table`, `Badge`, `FormDialog`, filtros inline compactos (mesmo padrão da listagem de acordos já existente). Nenhum card/tabela novo é inventado.

## Banco (1 migration)

1. `agreement_registrations`: liberar os status novos e o campo `pdf_url` já existente (nada a criar), apenas
   índice em `status` já existe.
2. Trigger `sync_agreement_status_from_hospitals()` em `agreement_registration_hospitals`
   (AFTER INSERT/UPDATE):
   - qualquer linha `rejeitado` → acordo vira `rejeitado`;
   - todas `aprovado` → acordo vira `aprovado`;
   - todas `aprovado` **e** todas com `linked_rule_id` → acordo vira `cadastrado` e grava `analyst_registered_at`.
   Fica no banco (e não no cliente) para não depender de o navegador terminar o fluxo.
3. Função `agreement_director_queue()` — não necessária; a fila usa `select` direto com RLS.
4. Bucket de PDF: reuso do bucket privado `approval-pdfs` já existente (download por URL assinada).

## Arquivos

| Arquivo | Mudança |
| --- | --- |
| `src/lib/agreementRegistrations.ts` | tipos `AgreementHospitalRow`, status por hospital + rótulos, checklist de campos obrigatórios (`buildAgreementChecklist`), mapeamento acordo → campos de `rules` (`buildRulePrefillFromAgreement`) |
| `src/lib/agreementPdf.ts` (novo) | geração do PDF único do acordo (jsPDF + autoTable, mesmo estilo de `groupValidationPdf.ts`), upload em `approval-pdfs`, gravação de `pdf_url` e helper de download por URL assinada |
| `src/components/relacionamento/AgreementDetailDialog.tsx` (novo) | visão read-only completa do acordo + checklist + timeline + botão de PDF; recebe `mode: "supervisor" \| "diretor" \| "analista" \| "leitura"` e renderiza as ações daquele papel |
| `src/components/relacionamento/AgreementTimeline.tsx` (novo) | quem preencheu, supervisor que validou, e uma linha por hospital com diretor, status e data |
| `src/pages/AgreementRegistrations.tsx` | passa a ter abas: **Todos** (listagem atual, intacta) · **Supervisor** · **Diretores** · **Cadastro de regras**; coluna/botão de download do PDF; filtros mantidos compactos |
| `src/pages/Rules.tsx` | (arquivo compartilhado) lê `?novo=1&acordo=<id>&acordoHospital=<rowId>` para abrir o formulário de regra já pré-preenchido e, após salvar, gravar `linked_rule_id` na linha do acordo |

## Filas

- **Supervisor** — acordos `aguardando_supervisor`. Ações: *Validar e enviar para Diretores*
  (status → `aguardando_diretor`, grava `supervisor_id`, `supervisor_validated_at`, `supervisor_notes`)
  e *Devolver para Contratos* (status → `rascunho`, motivo obrigatório em `supervisor_notes`).
  A validação só é liberada com o checklist de campos obrigatórios completo.
- **Diretores** — linhas de `agreement_registration_hospitals` com status `aguardando_diretor`
  nos hospitais do usuário, cujo acordo esteja `aguardando_diretor`. Ações *Aprovar* / *Rejeitar*
  (motivo obrigatório). Cada linha mostra também os demais hospitais do acordo com o status de cada um.
- **Cadastro de regras** — acordos `aprovado`. Uma linha por hospital com botão *Cadastrar Regra*
  (desabilitado quando já existe `linked_rule_id`, com link para a regra criada).

## Detalhes técnicos

- Pré-preenchimento da regra: `target_company_id`, `apply_access_route`, `include_auxiliaries`,
  `convenio_percentage`, `valid_from`, `valid_until`, `agreement_name`, e `time_mode`/`weekdays`/
  `includes_holidays` quando o acordo tiver diferenciação de urgência ou fim de semana/feriado.
  O `hospital_id` usado é o do hospital daquela linha (uma regra por hospital).
- O PDF é gerado automaticamente na transição para `aprovado` (última aprovação de diretor) e
  regerado em `cadastrado`; também há botão manual *Gerar/baixar PDF* caso a geração automática falhe.
  Conteúdo: identificação, abrangência, tabela, regras especiais, itens extras, observações e o bloco
  de assinaturas (preenchedor, supervisor e cada diretor com data/hora).
- Nomes de pessoas vêm de `profiles`; nomes de hospital de `hospitals`.
- Toda escrita captura `{ error }` e nunca reporta sucesso em falha.

## Fora do escopo

Nenhuma alteração no wizard de 6 etapas, no motor de regras ou em outras telas.
