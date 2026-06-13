
DO $$ BEGIN
  ALTER TYPE public.magic_link_action ADD VALUE IF NOT EXISTS 'approve_reapproval';
EXCEPTION WHEN undefined_object THEN
  -- nome do tipo pode variar; descobre dinamicamente
  EXECUTE format('ALTER TYPE %I.%I ADD VALUE IF NOT EXISTS %L',
    (SELECT n.nspname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
       WHERE t.oid = (SELECT atttypid FROM pg_attribute
                       WHERE attrelid='public.magic_link_tokens'::regclass AND attname='action')),
    (SELECT t.typname FROM pg_type t
       WHERE t.oid = (SELECT atttypid FROM pg_attribute
                       WHERE attrelid='public.magic_link_tokens'::regclass AND attname='action')),
    'approve_reapproval');
END $$;

DO $$ BEGIN
  ALTER TYPE public.magic_link_action ADD VALUE IF NOT EXISTS 'reject_reapproval';
EXCEPTION WHEN undefined_object THEN
  EXECUTE format('ALTER TYPE %I.%I ADD VALUE IF NOT EXISTS %L',
    (SELECT n.nspname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
       WHERE t.oid = (SELECT atttypid FROM pg_attribute
                       WHERE attrelid='public.magic_link_tokens'::regclass AND attname='action')),
    (SELECT t.typname FROM pg_type t
       WHERE t.oid = (SELECT atttypid FROM pg_attribute
                       WHERE attrelid='public.magic_link_tokens'::regclass AND attname='action')),
    'reject_reapproval');
END $$;
