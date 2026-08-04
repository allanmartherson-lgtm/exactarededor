-- O trigger enforce_state_uf_from_hospital ja garante state_uf em TODOS os
-- caminhos de insert (sessao de usuario e service_role), e as policies com
-- state_scope_allows_strict recusam qualquer linha com state_uf NULL.
-- A constraint NOT NULL era apenas redundante e forcava as telas do app a
-- enviar o campo — exatamente o que queremos evitar.
ALTER TABLE public.doctors   ALTER COLUMN state_uf DROP NOT NULL;
ALTER TABLE public.companies ALTER COLUMN state_uf DROP NOT NULL;