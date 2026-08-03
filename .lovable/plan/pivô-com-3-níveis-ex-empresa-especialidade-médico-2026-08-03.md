# Pivô com 3 níveis (ex.: Empresa → Especialidade → Médico)

Hoje a tabela comparativa suporta no máximo 2 níveis (agrupamento + drilldown). O pedido é permitir um terceiro nível, expansível dentro do segundo.

## O que muda para o usuário

- No diálogo "Customizar agrupamento" será possível marcar até 3 campos (ordem = hierarquia).
- Na tabela, cada linha do 2º nível ganha sua própria setinha de expandir, revelando o 3º nível.
- Recolher/expandir tudo e o filtro de coluna continuam operando sobre o 1º nível.

## Mudança no banco (precisa de aprovação)

Uma migration recria a função `get_payment_pivot` adicionando um parâmetro opcional `p_tertiary`.

Efeito prático: a função passa a devolver, além das linhas de nível 1 e 2, um bloco de linhas de nível 3. Para identificar o pai de uma linha de 3º nível sem quebrar o formato de retorno atual, o campo `parent_key` dessas linhas traz a combinação "nível1 ▸ nível2" usando um separador interno. Nada muda para quem chama sem `p_tertiary` — o comportamento atual é idêntico.

Sem alteração de tabelas, colunas, RLS ou permissões.

## Arquivos alterados

1. `supabase/migrations/<nova>.sql` — `CREATE OR REPLACE FUNCTION public.get_payment_pivot(...)` com `p_tertiary text DEFAULT NULL`, mantendo assinatura anterior compatível e o mesmo escopo de hospital/track já existente.
2. `src/components/payment-detail/PaymentPivotSection.tsx`
   - novo estado `tertiary` e envio de `p_tertiary` na RPC (paginação atual preservada);
   - agregação passa a montar `parent → child → grandchild → mês`;
   - render: expansão em dois níveis, com `expandedChildren` separado do `expanded` atual;
   - diálogo "Customizar": limite passa de 2 para 3 campos, textos atualizados.

## Detalhes técnicos

- Separador de chave composta: `\u001f` (unit separator), improvável em nomes de empresa/médico.
- Linhas de 3º nível só são emitidas quando `p_tertiary` é informado e diferente dos outros dois.
- A restrição "só PJs do lote" continua avaliando o eixo em que a empresa estiver (1º, 2º ou 3º nível).
- Volume: com 3 níveis o retorno cresce; a paginação já existente (blocos de 1000, teto de 50 páginas) cobre o caso.
