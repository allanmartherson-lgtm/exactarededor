import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

import { extendSectorMap, inferItemSector, normName, type ItemInput, type PaymentContext } from "../_shared/rulesEngine.ts";
import { applySectorStems } from "../_shared/sectorStems.ts";

Deno.test("reanálise: recupera setor da planilha quando payment_items.sector ficou salvo como outro", () => {
  extendSectorMap([
    {
      slug: "cirurgia",
      name: "Centro Cirúrgico",
      aliases: ["Centro Cirúrgico (DFStar)", "Centro Cirúrgico", "CC"],
    },
  ]);

  const persistedSector = "outro";
  const rawSector = "Centro Cirúrgico (DFStar)";

  const recoveredSector = persistedSector && !["outro", "outros"].includes(normName(persistedSector))
    ? persistedSector
    : rawSector;

  const item: ItemInput = {
    id: "baldomero-31403034",
    doctor_name: "Baldomero Pinto Soares",
    doctor_document: null,
    company_name: "DF NEURO LTDA",
    company_id: "comp-1",
    company_document: null,
    procedure_code: "31403034",
    procedure_name: "Denervação Percutânea De Faceta Articular - Por Segmento",
    description: null,
    access_route: "Via de acesso diferente",
    doctor_role: "Cirurgião Principal",
    procedure_amount: 100,
    gross_amount: 100,
    attendance_number: null,
    patient_name: null,
    procedure_date: "2026-03-22T00:00:00Z",
    sector: recoveredSector,
  };

  const ctx: PaymentContext = {
    sectors: ["cirurgia"],
    specialties: [],
    payment_type: null,
    reference_date: "2026-03-22",
  };

  assertEquals(recoveredSector, "Centro Cirúrgico (DFStar)");
  // O que este teste protege é a RECUPERAÇÃO: com `sector` persistido como
  // "outro", o motor tem que voltar a olhar o texto da planilha e resolver um
  // setor real — nunca ficar em "outro".
  //
  // A categoria canônica é `centro_cirurgico` (ver sectorStems.ts): desde que
  // os stems determinísticos passaram a rodar ANTES do SECTOR_MAP, tanto
  // "Centro Cirúrgico (DFStar)" quanto o próprio slug "cirurgia" convergem
  // para essa mesma categoria — que é a string comparada em `rules.sectors`.
  assertEquals(inferItemSector(item, ctx), "centro_cirurgico");
  assertEquals(applySectorStems("cirurgia"), "centro_cirurgico");
});