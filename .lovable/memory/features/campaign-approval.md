---
name: Aprovação de campanhas de comunicação em massa
description: Analista cria campanha em pending; admin/diretor aprovam. Dispatch só executa quando approval_status='approved'.
type: feature
---
Campanhas em `comm_campaigns` têm `approval_status` ('pending'|'approved'|'rejected') definido por trigger `set_campaign_approval_on_insert` conforme role do `created_by`:
- admin ou diretor → aprovada automaticamente
- demais (analista) → pending

Disparo bloqueado:
- `dispatch-broadcast` retorna 403 se != approved
- `broadcast-scheduler` filtra `.eq('approval_status','approved')`

Supervisor usa RPCs `approve_campaign(uuid)` / `reject_campaign(uuid, text)`. Ambas restritas a admin/diretor via `has_role()`. UI na página /comunicacao/massa mostra botões para supervisor e badge "Aguardando supervisor" para o analista.
