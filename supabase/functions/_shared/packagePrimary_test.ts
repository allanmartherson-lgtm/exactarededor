import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  buildPrimaryItemByRole,
  isPrimaryAnchor,
  type PackageItemLike,
} from "./packagePrimary.ts";

/**
 * Cirurgia torácica: pacote com main_code 30602190 absorve 5 códigos de
 * cirurgião e 3 de primeiro auxiliar. Esperado:
 *   - cirurgião: o item cujo procedure_code === main_code é o âncora,
 *     os 4 demais ficam absorvidos (expected = 0).
 *   - primeiro auxiliar: sem main_code presente para a função, o primeiro
 *     item encontrado vira âncora.
 */
Deno.test("Pacote — âncora por função: main_code vence; secundários ficam absorvidos", () => {
  const mainCode = "30602190";
  const absorbed = new Set([mainCode, "30602220", "30602239", "30602247", "30602255", "30602263"]);
  const items: PackageItemLike[] = [
    { id: "cir-a", procedure_code: "30602220", doctor_role: "Cirurgião Principal" },
    { id: "cir-b", procedure_code: "30602239", doctor_role: "CIRURGIÃO PRINCIPAL" },
    { id: "cir-main", procedure_code: mainCode, doctor_role: "Cirurgião principal" },
    { id: "cir-c", procedure_code: "30602247", doctor_role: "Cirurgião Principal" },
    { id: "cir-d", procedure_code: "30602255", doctor_role: "cirurgiao principal" },
    { id: "aux-a", procedure_code: "30602263", doctor_role: "Primeiro Auxiliar" },
    { id: "aux-b", procedure_code: "30602220", doctor_role: "Primeiro Auxiliar" },
  ];

  const primary = buildPrimaryItemByRole(items, absorbed, mainCode);

  // cirurgião → ganha o item com procedure_code === main_code
  assertEquals(primary.get("cirurgiao principal"), "cir-main");
  // primeiro auxiliar → não tem main_code; vence o primeiro encontrado
  assertEquals(primary.get("primeiro auxiliar"), "aux-a");

  // Validação por item: âncoras vs absorvidos
  const ancorados = items.filter((it) => isPrimaryAnchor(it, primary)).map((it) => it.id).sort();
  assertEquals(ancorados, ["aux-a", "cir-main"]);

  const absorvidos = items.filter((it) => !isPrimaryAnchor(it, primary)).map((it) => it.id).sort();
  assertEquals(absorvidos, ["aux-b", "cir-a", "cir-b", "cir-c", "cir-d"]);
});

Deno.test("Pacote — sem main_code da função: primeiro item vira âncora (fallback estável)", () => {
  const mainCode = "ZZZZ";
  const absorbed = new Set([mainCode, "111", "222", "333"]);
  const items: PackageItemLike[] = [
    { id: "it-1", procedure_code: "111", doctor_role: "Cirurgião Principal" },
    { id: "it-2", procedure_code: "222", doctor_role: "Cirurgião Principal" },
    { id: "it-3", procedure_code: "333", doctor_role: "Cirurgião Principal" },
  ];

  const primary = buildPrimaryItemByRole(items, absorbed, mainCode);
  assertEquals(primary.get("cirurgiao principal"), "it-1");
  assertEquals(items.filter((it) => !isPrimaryAnchor(it, primary)).map((it) => it.id), ["it-2", "it-3"]);
});

Deno.test("Pacote — item sem doctor_role é sempre primário (não há função para deduplicar)", () => {
  const mainCode = "AAA";
  const absorbed = new Set([mainCode, "BBB"]);
  const items: PackageItemLike[] = [
    { id: "sem-funcao", procedure_code: "BBB", doctor_role: null },
    { id: "com-funcao", procedure_code: mainCode, doctor_role: "Cirurgião" },
  ];
  const primary = buildPrimaryItemByRole(items, absorbed, mainCode);
  assertEquals(isPrimaryAnchor(items[0], primary), true);
  assertEquals(isPrimaryAnchor(items[1], primary), true);
});

Deno.test("Pacote — itens fora dos códigos absorvidos não entram no mapa de âncora", () => {
  const mainCode = "MAIN";
  const absorbed = new Set([mainCode]);
  const items: PackageItemLike[] = [
    { id: "fora", procedure_code: "OUTRO", doctor_role: "Cirurgião Principal" },
    { id: "dentro", procedure_code: mainCode, doctor_role: "Cirurgião Principal" },
  ];
  const primary = buildPrimaryItemByRole(items, absorbed, mainCode);
  assertEquals(primary.size, 1);
  assertEquals(primary.get("cirurgiao principal"), "dentro");
});
