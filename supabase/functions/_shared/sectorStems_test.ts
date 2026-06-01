// Testes dos stems determinísticos de setor + integração com inferItemSector.
// Cobre o bug original: planilha com "Hemodinâmica" caía em Centro Cirúrgico
// quando a tabela `sectors` usava slug numérico (ex.: "1574").

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { applySectorStems } from "./sectorStems.ts";
import { extendSectorMap, inferItemSector, SECTOR_MAP } from "./rulesEngine.ts";

// ----- 1) Stems isolados -----

Deno.test("stem: Hemodinâmica resolve para 'hemodinamica' em qualquer variação", () => {
  assertEquals(applySectorStems("Hemodinâmica"), "hemodinamica");
  assertEquals(applySectorStems("HEMODINAMICA"), "hemodinamica");
  assertEquals(applySectorStems("Hemodinâmica (DFStar)"), "hemodinamica");
  assertEquals(applySectorStems("Sala de Hemodinâmica"), "hemodinamica");
  assertEquals(applySectorStems("hemodin"), "hemodinamica");
});

Deno.test("stem: Centro Cirúrgico cobre CC, bloco, sala cirúrgica, 'cirurgia'", () => {
  assertEquals(applySectorStems("Centro Cirúrgico"), "centro_cirurgico");
  assertEquals(applySectorStems("Centro Cirurgico (DFStar)"), "centro_cirurgico");
  assertEquals(applySectorStems("CC"), "centro_cirurgico");
  assertEquals(applySectorStems("C.C."), "centro_cirurgico");
  assertEquals(applySectorStems("Bloco Cirúrgico"), "centro_cirurgico");
  assertEquals(applySectorStems("Sala Cirúrgica"), "centro_cirurgico");
  assertEquals(applySectorStems("Cirurgia"), "centro_cirurgico");
});

Deno.test("stem: RPA tem precedência sobre CC", () => {
  assertEquals(applySectorStems("RPA Centro Cirúrgico"), "rpa");
  assertEquals(applySectorStems("Recuperação Pós-Anestésica CC"), "rpa");
  assertEquals(applySectorStems("RPA Endoscopia"), "rpa");
});

Deno.test("stem: UTI granular (neonatal/pediátrica) tem precedência sobre UTI genérica", () => {
  assertEquals(applySectorStems("UTI Neonatal"), "uti_neonatal");
  assertEquals(applySectorStems("UTIN"), "uti_neonatal");
  assertEquals(applySectorStems("UTI Pediátrica"), "uti_pediatrica");
  assertEquals(applySectorStems("UTI Coronariana"), "uti_coronariana");
  assertEquals(applySectorStems("UTI"), "uti");
  assertEquals(applySectorStems("CTI"), "uti");
});

Deno.test("stem: Pronto Socorro / Emergência", () => {
  assertEquals(applySectorStems("Emergência (DFStar)"), "pronto_socorro");
  assertEquals(applySectorStems("PS"), "pronto_socorro");
  assertEquals(applySectorStems("Aguardando Vaga Emergência"), "pronto_socorro");
});

Deno.test("stem: atos sem CC (consulta, parecer, visita, ambulatório)", () => {
  assertEquals(applySectorStems("Consulta"), "consulta");
  assertEquals(applySectorStems("Parecer"), "parecer");
  assertEquals(applySectorStems("Interconsulta"), "parecer");
  assertEquals(applySectorStems("Visita"), "visita");
  assertEquals(applySectorStems("Ambulatório"), "ambulatorio");
});

Deno.test("stem: SADT subcategorias", () => {
  assertEquals(applySectorStems("SADT Endoscopia"), "sadt_endoscopia");
  assertEquals(applySectorStems("SADT Tomografia"), "sadt_tomografia");
  assertEquals(applySectorStems("Ressonância Magnética"), "sadt_ressonancia");
  assertEquals(applySectorStems("Radiologia"), "sadt_radiologia");
  assertEquals(applySectorStems("Ultrassonografia"), "sadt_ultrassom");
  assertEquals(applySectorStems("SADT Mamografia"), "sadt_mamografia");
  assertEquals(applySectorStems("SADT"), "sadt");
});

Deno.test("stem: retorna null para texto irrelevante / vazio", () => {
  assertEquals(applySectorStems(""), null);
  assertEquals(applySectorStems(null), null);
  assertEquals(applySectorStems(undefined), null);
  assertEquals(applySectorStems("XPTO Desconhecido"), null);
});

// ----- 2) Integração com inferItemSector (cenário do bug em produção) -----

Deno.test("inferItemSector: planilha 'Hemodinâmica' resolve para canônica mesmo com slug numérico no SECTOR_MAP", () => {
  // Simula o estado real da tabela `sectors` em produção: slugs numéricos
  // como "1574" para o setor "Hemodinâmica (DFStar)". Sem os stems, o
  // inferItemSector retornava "1574" e o engine não reconhecia como hemo.
  extendSectorMap([
    { slug: "1574", name: "Hemodinâmica (DFStar)", aliases: ["hemodinamica", "hemodin"] },
    { slug: "1556", name: "Centro Cirúrgico (DFStar)", aliases: ["cc", "centro cirurgico", "cirurgia"] },
  ]);
  try {
    // Cenário reportado: planilha diz "Hemodinâmica" → tem que voltar "hemodinamica"
    // (categoria canônica), NÃO "1574" e MUITO MENOS "centro_cirurgico".
    assertEquals(
      inferItemSector({ sector: "Hemodinâmica (DFStar)" } as any),
      "hemodinamica",
    );
    assertEquals(
      inferItemSector({ sector: "Hemodinâmica" } as any),
      "hemodinamica",
    );
    // Centro Cirúrgico segue caindo na categoria certa
    assertEquals(
      inferItemSector({ sector: "Centro Cirúrgico (DFStar)" } as any),
      "centro_cirurgico",
    );
  } finally {
    // limpa o singleton compartilhado entre testes
    for (const k of Object.keys(SECTOR_MAP)) delete SECTOR_MAP[k];
  }
});

Deno.test("inferItemSector: setor declarado nunca é sobrescrito por classification_sector (procedure_classifications)", () => {
  // Mesmo que a tabela de classificação de procedimento diga "centro_cirurgico"
  // (procedimento tipicamente de CC), a coluna "Setor" da planilha vence.
  // É a regra de ouro: planilha = fonte de verdade.
  const result = inferItemSector({
    sector: "Hemodinâmica",
    classification_sector: "centro_cirurgico",
  } as any);
  assertEquals(result, "hemodinamica");
});

Deno.test("inferItemSector: sem setor na planilha, classification_sector é usado como fallback", () => {
  const result = inferItemSector({
    sector: null,
    classification_sector: "hemodinamica",
  } as any);
  assertEquals(result, "hemodinamica");
});

Deno.test("inferItemSector: 'outro'/'outros' na planilha é ignorado, segue para classification_sector", () => {
  const result = inferItemSector({
    sector: "outro",
    classification_sector: "hemodinamica",
  } as any);
  assertEquals(result, "hemodinamica");
});
