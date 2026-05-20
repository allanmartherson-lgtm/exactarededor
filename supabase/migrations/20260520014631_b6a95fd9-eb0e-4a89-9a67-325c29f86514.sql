ALTER TABLE reconciliation_items ADD COLUMN IF NOT EXISTS agreement_text TEXT;
ALTER TABLE reconciliation_items ADD COLUMN IF NOT EXISTS applied_rule_label TEXT;
ALTER TABLE reconciliation_items ADD COLUMN IF NOT EXISTS applied_calc_method TEXT;