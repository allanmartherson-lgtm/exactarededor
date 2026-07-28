## Contexto apurado no código

`supabase/functions/analyze-payment/index.ts`, bloco **4.1 PACOTES** (linhas ~1035–1392):

- Monta `packageCalcs` a partir de `rule_calculations` com `package_main_code` (aceita lista separada por vírgula).
- Para cada atendimento monta `fullCodeSet` (cross-PJ) e cria `candidates` = todo calc cujo `main_code` aparece no atendimento.
- Agrupa por `triggerCode` (`byTrigger`) e escolhe 1 vencedor **por trigger** — ou seja, **dois códigos-alavanca diferentes no mesmo atendimento geram DOIS pacotes aplicados**, exatamente o caso THORAX (30803217 e 30803233).
- Se **nenhum** `main_code` está presente, o atendimento simplesmente não entra em pacote — caso AGATHA (nenhuma sugestão é oferecida ao analista).
- `access_route` é lido do item (linha ~833, ~1543) mas **não participa** de nenhum desempate de pacote.
- Itens absorvidos ficam `expected=0 / gross=0`, e o delta (`gross − expected`) alimenta `intervention_ledger` → aparece como economia/perda. Não existe hoje conceito de item "neutro por ambiguidade".

---

## Caso A — THORAX: dois códigos-alavanca no mesmo atendimento

### Regra nova (determinística)
Ao final da montagem de `winners`, se houver **2+ vencedores com `triggerCode` distinto no mesmo atendimento**:

1. Classifica a via de acesso do item que carrega cada `triggerCode`, usando o normalizador canônico já existente (`normAccessRoute` de `_shared/rulesEngine.ts`, espelho em `src/lib/normAccessRoute.ts`).
2. Prioridade: `unica_principal` > `outra_via` > `mesma_via` > `sem_via`/vazio.
3. Se **exatamente um** candidato tem a maior prioridade → ele vence; os demais viram **candidatos ambíguos** (não aplicados).
4. Se houver empate na melhor prioridade → **nenhum** dos empatados é aplicado automaticamente; todos viram ambíguos.

Isso resolve o atendimento 9321191: 30803217 (Única/principal) prevalece; 30803233 (Mesma via) vira decisão do analista.

### Estado "ambíguo" (neutro)
Item âncora não-vencedor recebe:
- `expected_amount = gross_amount` (delta zero → **não gera economia nem perda**)
- `status = 'alerta'`, `needs_ai_review = false` (não gasta IA)
- `package_ambiguity` (coluna nova, jsonb) com:
  ```
  { kind: "multi_anchor", att, chosen_calc_id, chosen_code,
    options: [{ calc_id, rule_name, code, package_amount, access_route }] }
  ```
- `calculation_explanation` explicando o empate.

---

## Caso B — AGATHA: só códigos secundários chegam

Novo passo, após o loop de `winners`, apenas para atendimentos **sem nenhum `triggerCode` presente**:

1. Procura calcs cujo `package_included_codes` cobre ≥1 código do `fullCodeSet` (respeitando `rule_scope='grupo'` / `rule_company_ids`, igual ao matching atual).
2. Ordena por cobertura (nº de included presentes) e pega os top 3 como sugestões.
3. **Não altera valor nenhum**: os itens seguem com o cálculo normal que o motor já produziu (avulso). Apenas grava:
   - `package_ambiguity = { kind: "no_anchor", att, suggestions: [...] }`
   - `status = 'alerta'`, `needs_ai_review = false`
   - explicação: "Códigos deste atendimento pertencem ao pacote X, mas o código-alavanca não foi faturado. Decisão do analista."
4. Enquanto `package_ambiguity` estiver pendente, o item é **excluído** do cálculo de economia/perda.

---

## Neutralidade em economia/perda

- `payment_items.package_ambiguity IS NOT NULL AND package_ambiguity->>'resolved' IS NULL` → item **neutro**.
- Aplicado em dois pontos:
  - RPC `get_intervention_savings` / `materialize_intervention_ledger`: filtro que ignora esses itens (classificação `neutro`).
  - `src/lib/interventionSavings.ts`: `classifyDelta` já suporta `"neutro"`; só precisa receber a flag.

---

## UI — card de decisão (neutro)

Em `src/components/payment-detail/ItemsDataGrid.tsx`, dentro do bloco de pacote já existente (~linha 3839–4040, onde hoje vive "absorver manualmente"):

- Badge âmbar **"Pacote ambíguo — decisão pendente"** na linha do item.
- Painel expandido com as opções vindas de `package_ambiguity`:
  1. **Absorver no pacote X** → reutiliza `absorverItem()` já existente (linha 1509), passando `calc_id` escolhido; marca `package_ambiguity.resolved = 'absorbed'`.
  2. **Pagar avulso (manter cálculo atual)** → `resolved = 'standalone'`; item volta a contar em economia/perda normalmente.
  3. **Outro valor** → input de valor + motivo obrigatório (reaproveita o gate de `manual_intervention_reasons` já em vigor); grava override e `resolved = 'manual'`.
- Toda decisão grava em `audit_log` (mesmo padrão do bloco `audit_package_absorbed`).
- Decisão do analista é **soberana**: reanálise não sobrescreve item com `package_ambiguity.resolved` preenchido (mesma guarda do `package_absorbed_by`).

---

## Banco — a única mudança de schema

```sql
ALTER TABLE public.payment_items
  ADD COLUMN IF NOT EXISTS package_ambiguity jsonb;
```

**Efeito prático:** uma coluna opcional em `payment_items` que guarda, quando o motor não conseguiu decidir sozinho, quais pacotes eram candidatos e qual foi a decisão do analista. Não altera nenhum registro existente (fica `NULL`), não muda RLS, não muda cálculo de quem já está aprovado. Sem novos valores de enum.

---

## Arquivos que serão alterados

| Arquivo | Mudança |
|---|---|
| `supabase/migrations/<data>_add_package_ambiguity.sql` | nova coluna jsonb |
| `supabase/functions/analyze-payment/index.ts` | desempate por via de acesso; detecção sem-alavanca; gravação de `package_ambiguity`; guarda de decisão soberana; persistência da coluna |
| `supabase/functions/_shared/packagePicker.ts` | novo helper puro `rankAnchorsByAccessRoute()` + `findPackagesWithoutAnchor()` (**arquivo compartilhado — aviso prévio conforme REGRA 2; hoje é usado por `analyze-payment` e pelos testes `packageAbsorbedEngine.contract.test.ts`; a mudança é aditiva, nenhuma assinatura existente muda**) |
| `src/components/payment-detail/ItemsDataGrid.tsx` | badge + painel de decisão do pacote ambíguo |
| `src/lib/interventionSavings.ts` | tratar item ambíguo pendente como `neutro` |
| RPC `get_intervention_savings` (migration) | excluir itens ambíguos pendentes de economia/perda |
| `supabase/functions/_shared/__tests__/packagePicker.test.ts` | testes do desempate por via e do caso sem-alavanca |

**Edge function:** `analyze-payment` será reimplantada e eu informarei explicitamente o deploy.

---

## Ordem de execução
1. Migration da coluna (após seu OK).
2. Helpers puros + testes.
3. `analyze-payment` + deploy.
4. UI do card de decisão.
5. Neutralidade em economia/perda (lib + RPC).

## Confirmações que preciso antes de codar
1. **Coluna `package_ambiguity` jsonb** em `payment_items` — aprovado?
2. **Caso B (AGATHA):** confirmo que o item deve continuar com o cálculo avulso atual (só sinaliza a sugestão), e **não** ser zerado à espera da decisão?
3. **Empate real de via** (dois âncoras ambos "Única/principal"): confirmo que nenhum pacote é aplicado automaticamente e ambos ficam pendentes?
