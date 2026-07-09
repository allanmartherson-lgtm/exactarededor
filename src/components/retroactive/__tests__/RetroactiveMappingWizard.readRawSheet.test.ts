import { describe, expect, it } from "vitest";
import { readRawSheet } from "../RetroactiveMappingWizard";

describe("readRawSheet — moeda BR do TASY", () => {
  it("preserva o texto formatado da coluna Valor antes do mapeamento retroativo", async () => {
    const htmlXls = `
      <html><body><table>
        <tr><td>Valor</td><td>Atendimento</td></tr>
        <tr><td>326,06</td><td>9178967</td></tr>
        <tr><td>1.086,883125</td><td>9183361</td></tr>
      </table></body></html>
    `;
    const encoded = new TextEncoder().encode(htmlXls);
    const file = {
      name: "tasy.xls",
      type: "application/vnd.ms-excel",
      arrayBuffer: async () => encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength),
    } as File;

    const { rows } = await readRawSheet(file);

    expect(rows[0].Valor).toBe("326,06");
    expect(rows[1].Valor).toBe("1.086,883125");
  });
});