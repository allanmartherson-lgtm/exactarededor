---
name: Cadastro provisório de médico
description: Analista cria médico durante importação como pending_admin_review=true; admin aprova/rejeita em /medicos > Cadastros provisórios; gate bloqueia envio para validação até aprovação
type: feature
---
Coluna `doctors.pending_admin_review` (bool) + `created_by_user_id` + `pending_review_note`.

RLS:
- `doctors_insert_pending_self`: qualquer autenticado INSERT se pending_admin_review=true AND created_by_user_id=auth.uid()
- `doctors_update_own_pending`: autor pode editar enquanto pendente
- `doctors_manage_admin_diretor`: admin/diretor full access (aprovar = update pending_admin_review=false)

Fluxo:
1. RegistryResolutionPanel (import) → "Cadastrar novo" sempre insere com pending=true.
2. Resolver inclui pendentes no registry → import flui normal.
3. Admin aprova/rejeita em /medicos aba "Cadastros provisórios" (DoctorPendingReviewPanel).
4. Gate em PaymentDetail.doSendForValidation + sendConfeccaoForValidation: bloqueia se algum payment_item.doctor_id apontar para doctor com pending_admin_review=true.

registryLookup.loadDoctorRegistry agora pagina via fetchAllPaginated (4k+ médicos exigem isso; default Supabase é 1000).
