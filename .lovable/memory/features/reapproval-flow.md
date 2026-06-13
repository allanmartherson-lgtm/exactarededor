---
name: reapproval-flow
description: Re-aprovação pós-aprovação por grupo de empresa. Threshold por hospital, versionamento de de-acordo, troca de PJ afeta origem + destino, gate de avanço bloqueado por trigger.
type: feature
---
- Unidade de re-aprovação = `payment_company_group`. NUNCA reabrir o lote inteiro: outros grupos seguem para NF/pago normalmente.
- Gatilho de valor: configurável em `hospital_settings.reapproval_threshold_pct` (%) e `reapproval_threshold_brl` (R$). Default 0% / R$ 0,01.
- Troca de `company_id` em item já aprovado marca **ambos** os grupos (origem + destino) como `reapproval_pending`. Trigger: `trg_company_change_dual_reapproval`.
- Alteração em `bruto_total/liquido_total/company_id` de grupo com `approval_version > 0` aciona `trg_detect_group_reapproval` (compara contra `last_approved_*`).
- Gate de avanço: `trg_block_group_advance_on_reapproval` impede status → `pedido_nf_enviado|nf_recebida|nf_conciliada|lancado|pago` enquanto pendente. Erro `check_violation`.
- Versionamento: tabela `company_group_approvals` (histórico imutável). Cada nova aprovação incrementa `approval_version`; trigger `trg_apply_group_approval_snapshot` atualiza snapshot e libera pendência.
- Notificação: `kind = director_reapproval` no `notification_queue`, handler `directorReapproval.ts`. Magic link actions: `approve_reapproval` / `reject_reapproval`.
- Edge function enfileiradora: `notify-director-reapproval` (body `{paymentId, companyGroupId}`).
- UI: `GroupReapprovalBadge` (compact ou painel de diff antes/depois). Hook `useGroupReapproval`.
- Aprovação por magic link insere row em `company_group_approvals` — triggers do banco fazem o resto (snapshot + zera pending + supersede versão anterior).
