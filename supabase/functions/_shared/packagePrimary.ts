/**
 * Para pacotes, a distribuição por função (package_roles_distribution) é o
 * valor TOTAL por atendimento — não por código. Quando o mesmo atendimento
 * tem múltiplos itens da mesma função (ex.: cirurgião com 3 códigos
 * absorvidos pelo pacote), apenas UM deles deve carregar o expected_amount;
 * os demais ficam como "absorvidos" (expected = 0, aprovado).
 *
 * Critério do âncora por função:
 *   1. preferência: item cujo procedure_code === package_main_code
 *   2. fallback: primeiro item da função encontrado entre os absorvidos
 *
 * Itens sem doctor_role são sempre tratados como primários (não há ambiguidade
 * de função para resolver).
 */
export interface PackageItemLike {
  id: string;
  procedure_code: string | null | undefined;
  doctor_role: string | null | undefined;
}

export function normRole(s: string | null | undefined): string {
  return (s ?? "").toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

export function buildPrimaryItemByRole(
  attItems: ReadonlyArray<PackageItemLike>,
  absorbedCodes: ReadonlySet<string>,
  mainCode: string,
): Map<string, string> {
  const primary = new Map<string, string>();
  for (const it of attItems) {
    const code = (it.procedure_code ?? "").toString().trim();
    if (!absorbedCodes.has(code)) continue;
    if (!it.doctor_role) continue;
    const rn = normRole(it.doctor_role);
    if (!primary.has(rn)) {
      primary.set(rn, it.id);
    }
    if (code === mainCode) {
      primary.set(rn, it.id); // main_code tem prioridade absoluta
    }
  }
  return primary;
}

export function isPrimaryAnchor(
  item: PackageItemLike,
  primaryByRole: ReadonlyMap<string, string>,
): boolean {
  if (!item.doctor_role) return true;
  return primaryByRole.get(normRole(item.doctor_role)) === item.id;
}
