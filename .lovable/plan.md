## Contexto

O `PaymentDetail` hoje mostra alguns blocos para qualquer usuário que tenha o papel **analista** acumulado, mesmo quando a pessoa está logada também como **validador** ou **diretor**. Resultado: o supervisor e o diretor veem ações que são da rotina do analista (selecionar empresas, concluir em massa, enviar lote para validação, sugerir aceites em lote). Confunde papéis e segregação de funções.

E falta o canal certo para o supervisor/diretor **fazer um questionamento dentro do lote** e devolver para a fila do analista (ou analista + supervisor, quando vem do diretor). A infraestrutura de "pergunta interna" já existe — `recordObservation({ is_question: true })` + edge function `notify-internal-question` — com este roteamento, exatamente o que você descreveu:

- analista pergunta → validador (em validação) ou diretor (em aprovação)
- validador pergunta → analista
- diretor pergunta → analista + validador

Falta só expor um **botão dedicado e visível** dentro do lote.

## Parte 1 — Tirar da visão do supervisor/diretor o que é do analista

Regra: quando o usuário está com **perspectiva** de validador ou diretor (mesmo que acumule o papel analista), os blocos de atuação do analista ficam ocultos. Quem é **apenas** analista continua vendo tudo. Admin segue vendo tudo (visão completa).

Itens a esconder quando `isValidador || isDiretor` (e o usuário não está executando ação especificamente do analista):

- Faixa **"Concluir análise em massa — N empresa(s) ainda em revisão"** + botão **Selecionar empresas** (≈ linha 2368 e 2391 de `PaymentDetail.tsx`).
- Faixa verde **"Empresas concluídas pelo analista — pronta(s) para envio"** + botão **Enviar lote para validação** (≈ linha 2485-2524).
- Diálogo/atalho de **concluir em massa**.
- Painel **BatchSuggestPanel** (já feito para esconder).
- Botões/atalhos do analista nos cards por empresa (revisar, concluir empresa).

Onde aplicar:
- Centralizar uma flag `showAnalystActions = isAnalista && !isValidador && !isDiretor` (admin pode ser tratado à parte com `showAnalystActions = isAnalista || isAdmin` se você quiser que o admin enxergue tudo — recomendo sim).
- Trocar os atuais `isAnalista &&` por `showAnalystActions &&` nos blocos listados.

## Parte 2 — Botão "Fazer questionamento" no lote

UX:

- **Cabeçalho do lote** (quando aplicável a todo o lote): botão `❓ Fazer questionamento` visível para validador, diretor e analista.
- **Card de cada empresa** dentro do lote: mesmo botão, escopado àquela empresa (passa `company_group_id` no payload da pergunta).
- Ao clicar, abre um modal:
  - Campo de texto (mín. 10 caracteres).
  - Auto-mostra **para quem vai** com base no papel do autor (`Você perguntando como Diretor → vai para Analista + Supervisor`).
  - Opção "ligar a um item específico" (dropdown opcional para escolher um `payment_item`, útil quando o questionamento é sobre uma linha).
  - Botão **Enviar questionamento**.
- Ao enviar:
  - Chama `recordObservation({ payment_id, item_id?, author_type, message, is_question: true, observation_type: "questionamento" })`.
  - A própria função `recordObservation` já dispara `notify-internal-question` com roteamento por papel.
  - Toast: "Questionamento enviado para Analista e Supervisor" (texto dinâmico).

Como o destinatário enxerga:

- Já existe `PaymentInternalQuestionsPanel` na página do pagamento listando as perguntas abertas (com link para responder). Vamos garantir que:
  - O painel apareça também para validador e diretor (perguntas abertas que eles fizeram).
  - O sino de notificações já recebe `notify-internal-question`.
- A resposta usa o fluxo existente (`recordObservation` com `answers_question_id`) — sem mudança nesta etapa.

## Onde mexer no código

- `src/pages/PaymentDetail.tsx`
  - Adicionar `showAnalystActions` e trocar gates dos blocos citados.
  - Adicionar botão `Fazer questionamento` no cabeçalho do lote e no card de cada empresa.
- `src/components/payment-detail/AskQuestionDialog.tsx` (novo)
  - Modal reutilizável (lote inteiro ou empresa específica).
  - Mostra preview do roteamento (texto computado a partir do papel do autor + status do lote).
  - Usa `recordObservation` (sem nova RPC).
- Sem migration: tudo persiste em `payment_observations` (já existe), com `is_question=true` e `observation_type='questionamento'`. Para escopar por empresa, gravamos `metadata` simples na mensagem (campo já existente em `payment_observations` se houver — caso contrário, usamos `item_id` quando a pergunta for sobre item, e o `company_group_id` vai numa coluna extra opcional só se você confirmar que quer rastreabilidade por empresa no histórico).
- Sem mudanças no `notify-internal-question` (roteamento já está como você descreveu).

## O que **não** muda

- Fluxos de Aprovar/Devolver/Questionar em lote do `PaymentBatchActionsFooter` continuam iguais (questionamento de lote ali ainda funciona). O botão novo é o atalho rápido **por empresa** que faltava.
- Nenhuma alteração no motor de cálculo, status, glosas ou regras.
- Observações comuns (não-pergunta) continuam funcionando como hoje.

## Decisões para você confirmar

1. **Admin enxerga tudo** (analista + supervisor + diretor) ou tratamos admin igual ao validador/diretor (oculta blocos do analista)?
2. O botão **"Fazer questionamento"** deve aparecer **por empresa** (card de cada empresa do lote) **e** no cabeçalho do lote, ou só por empresa?
3. Quando o **analista** clica em "Fazer questionamento", queremos que ele também tenha esse atalho rápido (vai para validador/diretor conforme o estágio), ou esse botão é exclusivo de supervisor/diretor?
4. Precisa rastrear o questionamento por **empresa específica** no banco (nova coluna `company_group_id` em `payment_observations`) ou basta deixar isso só na descrição/contexto da mensagem por enquanto?
