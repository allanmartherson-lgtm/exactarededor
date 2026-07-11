/**
 * Calcula SHA-256 hexadecimal de um File usando Web Crypto (client-side).
 * Usado para provar integridade da planilha original persistida em
 * `payment_source_files.sha256`.
 */
export async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Deriva um "role" simples a partir do nome do arquivo, para categorizar
 * a planilha (SAT / Bônus / Sobreaviso) em auditoria.
 * Fallback: "outros".
 */
export function inferBucketRole(filename: string): "sat" | "bonus" | "sobreaviso" | "sat_geral" | "outros" {
  const n = filename.toLowerCase();
  if (/sobreaviso|sbav|s\.aviso/.test(n)) return "sobreaviso";
  if (/b[oôó]nus|bonif/.test(n)) return "bonus";
  if (/sat[_\-\s]?geral/.test(n)) return "sat_geral";
  if (/\bsat\b/.test(n)) return "sat";
  return "outros";
}
