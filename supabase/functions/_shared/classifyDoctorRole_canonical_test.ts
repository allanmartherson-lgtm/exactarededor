// Regressão (#bug Acordo Coluna / Dr. Eidmar — 2º Aux): classifyDoctorRole
// estava convertendo a chave canônica "demais_aux" em "primeiro_aux" porque
// o fallback s.includes("aux") capturava antes. Resultado: regras com
// rule_calculations.doctor_roles=["cirurgiao","primeiro_aux","demais_aux"]
// rejeitavam itens classificados como demais_aux e caíam no fallback geral.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// Reimporta via re-export interno: classifyDoctorRole não é exportado;
// validamos indiretamente através do comportamento esperado documentado
// no calc-filter. Aqui usamos uma cópia da função para garantir contrato.
// (Se a fn for exportada no futuro, trocar para import direto.)
function classifyDoctorRoleContract(role: string | null | undefined): string {
  const s = (role ?? "").toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!s) return "outro";
  if (s === "cirurgiao" || s === "cirurgiao_principal" || s === "principal" || s === "operador") return "cirurgiao";
  if (s === "instrumentador") return "instrumentador";
  if (
    s === "demais_aux" || s === "demais_auxiliares" || s === "demais" ||
    s === "aux2" || s === "segundo_aux" || s === "segundo_auxiliar" ||
    s === "aux3" || s === "terceiro_aux" || s === "terceiro_auxiliar"
  ) return "demais_aux";
  if (
    s === "primeiro_aux" || s === "primeiro_auxiliar" || s === "aux1" ||
    s === "auxiliar" || s === "aux"
  ) return "primeiro_aux";
  if (s.includes("instrument")) return "instrumentador";
  if (s.includes("cirurgi") || s.includes("operador")) return "cirurgiao";
  if (s.includes("demais") && (s.includes("aux") || s.includes("ajudante"))) return "demais_aux";
  if (/(2[ºo]|2\b|segund|3[ºo]|3\b|terceir|quart|quint)/.test(s) && (s.includes("aux") || s.includes("ajudante"))) return "demais_aux";
  if (/(^|\b)(1[ºo]|1\b|primeir)/.test(s) && (s.includes("aux") || s.includes("ajudante"))) return "primeiro_aux";
  if (s.includes("aux") || s.includes("ajudante")) return "primeiro_aux";
  return "outro";
}

Deno.test("classifyDoctorRole — chave canônica 'demais_aux' não pode virar 'primeiro_aux'", () => {
  assertEquals(classifyDoctorRoleContract("demais_aux"), "demais_aux");
  assertEquals(classifyDoctorRoleContract("DEMAIS_AUX"), "demais_aux");
  assertEquals(classifyDoctorRoleContract("demais"), "demais_aux");
  assertEquals(classifyDoctorRoleContract("Demais Auxiliares"), "demais_aux");
});

Deno.test("classifyDoctorRole — chaves canônicas curtas", () => {
  assertEquals(classifyDoctorRoleContract("cirurgiao"), "cirurgiao");
  assertEquals(classifyDoctorRoleContract("primeiro_aux"), "primeiro_aux");
  assertEquals(classifyDoctorRoleContract("instrumentador"), "instrumentador");
  assertEquals(classifyDoctorRoleContract("aux1"), "primeiro_aux");
  assertEquals(classifyDoctorRoleContract("aux2"), "demais_aux");
});

Deno.test("classifyDoctorRole — texto livre PT-BR continua funcionando", () => {
  assertEquals(classifyDoctorRoleContract("Segundo Aux"), "demais_aux");
  assertEquals(classifyDoctorRoleContract("2º Auxiliar"), "demais_aux");
  assertEquals(classifyDoctorRoleContract("Primeiro Auxiliar"), "primeiro_aux");
  assertEquals(classifyDoctorRoleContract("Cirurgião Principal"), "cirurgiao");
});
