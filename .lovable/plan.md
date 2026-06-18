## Problema

1. Códigos como Toracostomia (30804132) e Pleuroscopia estão sendo tratados como "pacote excedente" só porque o motor reaproveitou o método `pacote*` para casos com valor fixo por função. Isso polui visualmente a tela (toda linha vira PACOTE 📦) e bagunça o conceito.
2. Conceitualmente:
   - **Pacote** = vários códigos pagos com um único valor.
   - **Valor fixo** = valor por código, independente do convênio, podendo variar por função (Cirurgião, 1º Aux, 2º Aux, Anestesista...).
3. A regra precisa esgotar internamente: **pacote → valor fixo → CBHPM 2018 × 2 + 20% (catch-all)**, sem fallback silencioso para a regra geral.

## Mudanças

### 1. Backend — `valor_fixo` ganha "valores por função" (igual ao pacote)
- Schema `rule_calculations.config`:
  - `valor_fixo`: `{ valor: number, valores_por_funcao?: { cirurgiao_principal?, primeiro_auxiliar?, segundo_auxiliar?, terceiro_auxiliar?, anestesista?, instrumentador?, ... }, procedure_codes?, procedure_keywords?, is_catch_all? }`
  - Resolução do valor: `valores_por_funcao[funcao_normalizada] ?? valor` (fallback global).
- `rulesEngine.applyCalculation`:
  - Cadeia explícita de tentativas dentro da regra: ordenar por `priority ASC, is_catch_all ASC`, percorrer e usar a primeira que casa (código/keyword OU catch-all).
  - Para `valor_fixo`, ler valor por função do item antes do `valor` global.
  - Se nenhum cálculo bate e `prevent_external_fallback=true` → `sem_regra` com alerta atual.

### 2. Migrar dados existentes
- Migration: para todo `rule_calculations` com método `pacote_excedente` / `pacote_fora` cujo único papel era "valor fixo por função sem código principal", **converter para `valor_fixo`** preservando `valores_por_funcao`. Critério: pacote sem `codigo_principal` configurado OU criados como workaround. Listar e confirmar antes de aplicar — gerar relatório `SELECT` primeiro, só converter após aprovação manual via UI/CSV.
- Não mexer em pacotes legítimos (com código principal + códigos absorvidos).

### 3. UI — Editor de cálculo (`RuleCalculationsEditor.tsx`)
- No tipo `valor_fixo`, adicionar seção "Valores por função (opcional)" com inputs por função (mesmo componente já usado em pacote). Se preenchido, sobrepõe `valor` global.
- Mensagem: "Use quando o pagamento muda por função (ex: principal R$ 2.000 / 1º aux R$ 600)."

### 4. UI — Sinalização visual de pacote no PaymentConciliationModal
- **Remover** o badge 📦 PACOTE de TODO atendimento que tenha qualquer item com método pacote. Mostrar somente quando o atendimento é de fato um pacote consolidado (>1 código vinculado ao mesmo `package_group_id` ou bloco de regra pacote real).
- Linha de cabeçalho do grupo de regra: trocar ícone 📦 por ícone neutro (🧮) quando for valor fixo/catch-all. 📦 reservado para pacote real.
- Badge "PACOTE" no nível do atendimento só aparece se `items.some(i => i.applied_calc_method?.startsWith('pacote') && i.package_group_id)`.
- Limpar `COM ALERTAS` duplicado e reduzir altura visual da faixa âmbar (padding compacto).

### 5. Catch-all CBHPM continua funcionando
- Já implementado (`is_catch_all`). Após a conversão, a regra Cirurgia Torácica fica: `[valor_fixo Toracostomia/Pleuroscopia por função] → [catch-all CBHPM 2018 × 2 + 20%]`.

## Ordem de execução

1. Migration: adicionar suporte a `valores_por_funcao` em `valor_fixo` (apenas docs/comment — config é JSONB, não muda schema). Script de auditoria SQL listando `pacote_*` candidatos a conversão.
2. Motor: `rulesEngine.ts` lê `valores_por_funcao` no `valor_fixo`.
3. UI editor: novos campos por função em valor_fixo.
4. UI modal: badge PACOTE só para pacote real + ícone neutro p/ regras não-pacote + faixa mais compacta.
5. Testes: novo caso `valorFixoPorFuncao_test.ts` + atualizar `catchAllAndFallbackBlock_test.ts` para cobrir cadeia pacote→fixo→catch-all.
6. Após aprovação, rodar conversão dos cálculos atuais via UI (não em migration automática) — listar via SQL e usuário decide.

## Detalhes técnicos

- Funções normalizadas: reutilizar util já existente em `_shared/functionNormalize` (se não existir, criar — extrair do `packagePicker.ts`).
- `valor_fixo` mantém compat: `valor` continua sendo o default quando `valores_por_funcao` vazio.
- Display: tag de método na linha do item passa a mostrar "Valor fixo (por função)" quando `valores_por_funcao` não vazio.
- Nada muda em `payment_items.applied_calc_method` ='valor_fixo' (já existente).

## Riscos
- Conversão automática de pacotes para valor_fixo pode quebrar pacotes legítimos. Mitigação: NÃO automatizar — só listar candidatos e converter manualmente após revisão.
- Mudança visual no badge PACOTE pode esconder pacote real se a heurística de `package_group_id` estiver ausente em dados antigos. Mitigação: fallback — se `applied_calc_method` contém 'pacote' e tem >1 item no mesmo atendimento+regra, ainda mostra badge.
