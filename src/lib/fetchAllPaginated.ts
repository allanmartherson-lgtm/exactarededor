/**
 * Pagina todas as linhas de uma query Supabase ignorando o teto default de 1000
 * imposto pelo PostgREST. Use sempre que precisar do conjunto completo de um
 * cadastro (companies, doctors, doctor_companies, convenios, sectors,
 * cost_centers etc.) — caso contrário matches/lookups silenciosamente
 * perdem registros conforme as tabelas crescem.
 *
 * Uso:
 *   const rows = await fetchAllPaginated<Row>((from, to) =>
 *     supabase.from("companies").select("id,name,document").order("name").range(from, to)
 *   );
 *
 * O callback DEVE chamar `.range(from, to)` por último.
 */
export async function fetchAllPaginated<T>(
  buildQuery: (from: number, to: number) => any,
  pageSize = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < pageSize) break;
    // safety stop: 200k rows
    if (out.length >= 200_000) break;
  }
  return out;
}
