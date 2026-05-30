import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyConvenioStems,
  recordLearnedAlias,
  drainLearnedAliases,
} from "./convenioStems.ts";
import { _test_only, extendConvenioMap } from "./rulesEngine.ts";

const { normAgreement } = _test_only;

Deno.test("stem rules — Bradesco family", () => {
  assertEquals(applyConvenioStems("bradesco segur"), "bradesco_segur");
  assertEquals(applyConvenioStems("BRADESCO SEGUR - Empresarial".toLowerCase()), "bradesco_segur");
  assertEquals(applyConvenioStems("bradesco saude"), "bradesco_segur");
  assertEquals(applyConvenioStems("bradesco seguros s.a."), "bradesco_segur");
  assertEquals(applyConvenioStems("bradesco funcional"), "bradesco_funcional");
  assertEquals(applyConvenioStems("bradesco operad"), "bradesco_operad");
  assertEquals(applyConvenioStems("bradesco operadoras"), "bradesco_operad");
  assertEquals(applyConvenioStems("Bradesco".toLowerCase()), "bradesco_segur");
});

Deno.test("stem rules — Sul América / Amil / Unimed Central", () => {
  assertEquals(applyConvenioStems("sul america"), "sul_america");
  assertEquals(applyConvenioStems("sul-america saude"), "sul_america");
  assertEquals(applyConvenioStems("sulamerica"), "sul_america");
  assertEquals(applyConvenioStems("amil"), "amil");
  assertEquals(applyConvenioStems("amil one"), "amil");
  assertEquals(applyConvenioStems("amil saude"), "amil");
  assertEquals(applyConvenioStems("central nacional unimed"), "central_nacional_unimed");
  assertEquals(applyConvenioStems("unimed rede master"), "central_nacional_unimed");
  assertEquals(applyConvenioStems("cnu"), "central_nacional_unimed");
});

Deno.test("normAgreement — sem hidratação do banco, ainda resolve via stems", () => {
  drainLearnedAliases(); // limpa estado
  // sem extendConvenioMap chamado → CONVENIO_MAP vazio
  assertEquals(normAgreement("BRADESCO SEGUR - Empresarial"), "bradesco_segur");
  assertEquals(normAgreement("Sul América Saúde"), "sul_america");
  const learned = drainLearnedAliases();
  const slugs = learned.map((l) => l.slug).sort();
  assertEquals(slugs, ["bradesco_segur", "sul_america"]);
});

Deno.test("normAgreement — match exato via CONVENIO_MAP não dispara aprendizado", () => {
  drainLearnedAliases();
  extendConvenioMap([
    { slug: "bradesco_segur", name: "BRADESCO SEGUR", aliases: ["bradesco saude"] },
  ]);
  // alias cadastrado → match exato, não aprende
  const r = normAgreement("bradesco saude");
  assertEquals(r, "bradesco_segur");
  assertEquals(drainLearnedAliases().length, 0);
});
