O problema relatado indica que a reanálise do lote não está processando todos os itens das empresas (especificamente, parece ignorar itens que não foram filtrados ou que a IA julga não precisar de revisão), enquanto a reanálise individual da empresa força o processamento total. Além disso, existe uma discrepância entre o que foi importado e o que é exibido, possivelmente devido à falta de sincronização manual ou triggers durante o processamento em lote.

### Alterações propostas

#### 1. Edge Function `dispatch-payment-analysis`
- Modificar a consulta inicial de itens para garantir que **todos** os itens de cada empresa do lote sejam considerados, independente do status da IA, a menos que um filtro específico seja passado.
- Garantir que o `companyNames` represente a realidade total do lote.

#### 2. Edge Function `analyze-payment`
- Refinar a lógica de seleção de itens: quando `company_name` é fornecido (como no caso do dispatch paralelo), garantir que o motor processe **todos** os itens daquela empresa para manter a paridade com a reanálise individual.
- Adicionar um log informativo no histórico do lote (`payment_observations`) detalhando o total de itens reanalisados por empresa para dar transparência ao usuário.

#### 3. Frontend: `PaymentDetail.tsx` e `CompanyAnalysis.tsx`
- No `PaymentDetail.tsx`, garantir que a função `reprocessAi` passe os parâmetros corretos para o `dispatch-payment-analysis` para que ele saiba se deve resetar o status de todos os itens ou apenas os filtrados.
- Unificar o comportamento de "Reanalisar" para que ambos os botões (lote e empresa) utilizem a mesma lógica de processamento total por padrão, evitando "visões fantasmas" de dados que estão na base mas não foram processados.

#### 4. Sincronização de Dados
- Garantir que ao final de cada `analyze-payment`, os totais e contagens na tabela `payment_company_groups` sejam recalculados e salvos, forçando a atualização da UI do usuário.

### Detalhes técnicos
- `supabase/functions/analyze-payment/index.ts`: Ajustar a query de `payment_items` para remover filtros implícitos quando operando por empresa.
- `supabase/functions/dispatch-payment-analysis/index.ts`: Ajustar a coleta de nomes de empresas para ser exaustiva.
- Verificação de triggers de banco de dados que possam estar atrasando a atualização de `payment_company_groups`.
