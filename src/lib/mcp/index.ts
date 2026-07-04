import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listPayments from "./tools/list-payments";
import getPayment from "./tools/get-payment";
import listPendencias from "./tools/list-pendencias";
import whoami from "./tools/whoami";

// O emissor OAuth precisa ser o host direto do Supabase — nunca a URL
// proxy `.lovable.cloud`. Construímos a partir do project ref (inline por
// Vite em build). Fallback só serve para a passagem de extração do manifesto.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "exacta-mcp",
  title: "Exacta — Repasses médicos",
  version: "0.1.0",
  instructions:
    "Ferramentas do Exacta (motor de conciliação de repasses médicos). Use `list_payments` para ver lotes recentes, `get_payment` para detalhes de um lote específico, `list_pendencias` para itens abertos e `whoami` para confirmar o vínculo. Somente leitura.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listPayments, getPayment, listPendencias, whoami],
});
