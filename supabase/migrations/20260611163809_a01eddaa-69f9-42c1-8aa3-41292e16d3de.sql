ALTER TABLE payment_items
  ADD COLUMN IF NOT EXISTS package_absorbed          boolean      DEFAULT false,
  ADD COLUMN IF NOT EXISTS package_absorbed_calc_id  uuid         REFERENCES rule_calculations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS package_absorbed_by       uuid         REFERENCES auth.users(id)         ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS package_absorbed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS package_absorbed_note     text;

CREATE INDEX IF NOT EXISTS idx_pit_package_absorbed
  ON payment_items(payment_id, package_absorbed)
  WHERE package_absorbed = true;