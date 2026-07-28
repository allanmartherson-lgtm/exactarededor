# Prévia de intervenções — corrigir cobertura e evitar contaminação por pacotes

## Diagnóstico

Rodei a RPC `get_intervention_preview` para o hospital DF Star:

- 15 lotes elegíveis no status certo (`revisao_analista`, `aguardando_aprovacao`, etc.).
- 8 desses lotes têm dezenas de itens acatados (63, 53, 50, 18…).
- A prévia devolve **apenas 2 lotes / 5 itens** — bate exatamente com o print do usuário.

Duas causas independentes:

### 1. Lotes acatados como "manter pago" ficam invisíveis

`accept_payment_item_keep_paid` faz:

```
gross_amount     = valor pago
expected_amount  = valor pago      ← alinha ao pago
```

Depois disso `delta = expected - gross = 0`, então o filtro
`ABS(delta) > 0.005` do `get_intervention_preview` corta o item. O `esperado`
original só é registrado no `audit_log`, não no row. Não há coluna
`expected_amount_original`.

O lote onde o analista acatou 63 itens "manter pago" desaparece da tela mesmo
tendo intervenção real (rule dizia X, analista decidiu manter Y ≠ X).

### 2. Pacotes ambíguos resolvidos entram como Perda/Economia

Quando o analista escolhe uma linha portadora de pacote:

- Linha portadora recebe `expected_amount = valor do pacote`, `gross_amount`
  permanece igual ao pago (que já era o valor do pacote).
- Linhas absorvidas ficam com `expected_amount = 0`, `gross_amount = valor pago`,
  `package_absorbed = true`.

O `PackageAmbiguityPanel` grava `gross_override_at` (para o motor reconhecer a
decisão), o que faz o item entrar no `impacting` do RPC. Nas absorvidas,
`delta = 0 - valor_pago` → vira PERDA gigante. Nada disso é intervenção
financeira real — é só desambiguação estrutural.

## Mudanças propostas (todas dentro do módulo de intervenção)

### DB / RPC — precisa aprovação do usuário

1. **Migration**: adicionar coluna `payment_items.expected_amount_original NUMERIC`.
   Guarda o esperado antes de um `acatado_pago` para não perder o delta.
2. **RPC `accept_payment_item_keep_paid`**: setar
   `expected_amount_original = COALESCE(expected_amount_original, v_expected)`
   antes de alinhar `expected_amount` ao pago. Reversão limpa o campo.
3. **RPC `get_intervention_preview`**:
   - Trocar `delta = expected - gross` por:
     ```
     CASE
       WHEN gross_override_reason = 'acatado_pago'
            AND expected_amount_original IS NOT NULL
         THEN gross_amount - expected_amount_original          -- delta real
       WHEN acatado_at >= v_cutoff AND gross_override_reason = 'acatado_esperado'
         THEN gross_amount_original - gross_amount
       ELSE expected_amount - gross_amount
     END
     ```
   - Ignorar itens `package_absorbed = true` (linhas absorvidas E portadora)
     do cálculo de delta — desambiguação de pacote não é ganho nem perda.
   - Ajustar `fonte` para incluir `'aceite_pago'` quando aplicável.

### Frontend — escopo fechado

4. `src/components/intervention/InterventionPreviewSection.tsx`:
   - Adicionar rótulo `Aceite (mantendo pago)` na tabela de itens quando fonte for `aceite_pago`.
   - Mostrar o esperado original (via novo campo retornado pela RPC).

Nenhum outro arquivo será alterado. `PackageAmbiguityPanel.tsx` não precisa mudar — a exclusão acontece no RPC.

## Impacto prático

- Lotes com "acatar mantendo pago" voltam a aparecer na prévia com o delta
  correto (economia se pago < regra, perda se pago > regra).
- Resoluções de pacote ambíguo somem da prévia (deixam de gerar perdas falsas
  de 5-9 mil reais).
- Nenhuma reversão automática dos itens já resolvidos — a coluna nova só passa
  a ser preenchida a partir dos próximos aceites. Itens antigos permanecem
  invisíveis porque o esperado original foi perdido no `audit_log` (posso
  recuperar via consulta ao `audit_log` se quiser, num passo separado).

## Pergunta

Aprovar migration + RPC + ajuste do painel? Se preferir sem migration, dá
para reconstruir o `esperado original` lendo `audit_log` a cada chamada da
RPC, mas fica lento em lotes grandes.
