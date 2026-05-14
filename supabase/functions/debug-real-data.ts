
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { 
  analyzePaymentItems, 
  type ItemInput, 
  type RuleInput, 
  type PaymentContext 
} from "./_shared/rulesEngine.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const payment_id = "ca9a42fc-cbf6-42e8-89f0-b89386582821";
const item_id = "71629de1-b5ad-4073-8bd1-62453f74f7c1";

// Fetch item
const { data: itemRaw } = await supabase
  .from("payment_items")
  .select("*")
  .eq("id", item_id)
  .single();

// Fetch all active rules
const { data: rulesRaw } = await supabase
  .from("rules")
  .select("*")
  .eq("active", true);

// Fetch calculations
const ruleIds = rulesRaw.map(r => r.id);
const { data: calcsRaw } = await supabase
  .from("rule_calculations")
  .select("*")
  .in("rule_id", ruleIds);

const rules = rulesRaw.map(r => ({
  ...r,
  calculations: calcsRaw.filter(c => c.rule_id === r.id)
})) as unknown as RuleInput[];

const item = {
  ...itemRaw,
  gross_amount: Number(itemRaw.gross_amount),
  procedure_amount: Number(itemRaw.procedure_amount)
} as unknown as ItemInput;

const ctx: PaymentContext = {
  sectors: ["hemodinamica"],
  specialties: [],
  payment_type: null,
  reference_date: "2026-05-14"
};

const results = analyzePaymentItems([item], rules, ctx, { collectTrace: true } as any);
console.log(JSON.stringify(results[0].selection_trace, null, 2));
console.log("Winner Rule ID:", results[0].matched_rule_id);
console.log("Winner Rule Name:", results[0].matched_rule_name);
