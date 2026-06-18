ALTER TABLE public.audit_log
  DROP CONSTRAINT IF EXISTS audit_log_action_check;

ALTER TABLE public.audit_log
  ADD CONSTRAINT audit_log_action_check
  CHECK (
    action = ANY (ARRAY[
      'create',
      'update',
      'create_via_rpc',
      'update_via_rpc',
      'auto_set_valid_until',
      'delete',
      'profile_updated',
      'created',
      'updated',
      'deleted',
      'approved',
      'rejected',
      'reactivated',
      'deactivated',
      'role_added',
      'role_removed',
      'password_reset',
      'invite_resent',
      'calc_reduction_confirmed'
    ])
  );