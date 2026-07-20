## Arquivo responsável pela importação de payment_items

Não existe edge function que faça parse de planilha e insira em `payment_items`. O fluxo é todo client-side:

- **`src/pages/NewPayment.tsx`** — orquestra upload, parse e inserção. A gravação em `payment_items` ocorre em ~linha 3241–3258 via RPC de banco `bulk_insert_new_payment_items` (chamada em lotes com `supabase.rpc(...)`).
- **`src/lib/columnMapping.ts`** e módulos `src/lib/parse*.ts` — parsing da planilha no browser antes da chamada à RPC.

Se o objetivo for inspecionar a lógica de inserção propriamente dita (server-side), ela está na função Postgres `bulk_insert_new_payment_items`, não em `supabase/functions/`.

Nenhuma alteração foi feita.