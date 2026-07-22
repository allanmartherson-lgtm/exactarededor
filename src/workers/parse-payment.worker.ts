/**
 * Worker de parse de planilhas de pagamento.
 *
 * Responsabilidade única: receber bytes (ArrayBuffer) + nome do arquivo,
 * fazer XLSX.read + sheet_to_json e devolver a matriz bruta.
 *
 * Nenhuma consulta a Supabase, matching de PJ, matching de convênio ou
 * lógica de negócio. Tudo isso continua na main thread (NewPayment.tsx).
 */
import * as XLSX from "xlsx";
import {
  readWorkbookPreservingText,
  preserveFormattedBrazilianNumbers,
} from "../lib/parsePaymentFile";

export type ParseWorkerRequest = {
  fileId: string;
  fileName: string;
  buffer: ArrayBuffer;
};

export type ParseWorkerMessage =
  | {
      type: "progress";
      fileId: string;
      phase: "lendo_arquivo" | "parseando_linhas" | "concluido";
      current: number;
      total: number;
    }
  | {
      type: "result";
      fileId: string;
      sheetName: string;
      matrix: unknown[][];
    }
  | { type: "error"; fileId: string; message: string };

self.onmessage = (e: MessageEvent<ParseWorkerRequest>) => {
  const { fileId, buffer } = e.data;
  const post = (msg: ParseWorkerMessage) => (self as unknown as Worker).postMessage(msg);

  try {
    post({ type: "progress", fileId, phase: "lendo_arquivo", current: 0, total: 1 });

    const wb = readWorkbookPreservingText(buffer, { cellDates: false });
    if (!wb.SheetNames?.length) {
      post({ type: "error", fileId, message: "Planilha sem abas" });
      return;
    }
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    preserveFormattedBrazilianNumbers(sheet);

    post({ type: "progress", fileId, phase: "parseando_linhas", current: 0, total: 1 });

    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
      blankrows: false,
    });

    post({
      type: "progress",
      fileId,
      phase: "parseando_linhas",
      current: matrix.length,
      total: matrix.length,
    });
    post({ type: "progress", fileId, phase: "concluido", current: 1, total: 1 });
    post({ type: "result", fileId, sheetName, matrix });
  } catch (err) {
    post({
      type: "error",
      fileId,
      message: String((err as Error)?.message ?? err),
    });
  }
};
