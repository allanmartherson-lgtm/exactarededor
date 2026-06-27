import { describe, it, expect, vi } from "vitest";
import {
  runSaveAll,
  runFinalize,
  type SaveableRow,
} from "@/lib/manualPaymentSave";

type Row = SaveableRow & { amount?: number };

const mk = (over: Partial<Row>): Row => ({
  key: "k",
  dbId: null,
  dirty: true,
  valid: true,
  ...over,
});

describe("runSaveAll", () => {
  it("salva apenas linhas dirty + valid e devolve novo dbId/key", async () => {
    const rows: Row[] = [
      mk({ key: "a" }),
      mk({ key: "b", dirty: false }), // ignorada
      mk({ key: "c", valid: false }), // skipped
    ];
    const saveRow = vi.fn(async (r: Row) => `id_${r.key}`);
    const res = await runSaveAll(rows, saveRow);

    expect(res.saved).toBe(1);
    expect(res.skipped).toBe(1);
    expect(res.failed).toBe(0);
    expect(saveRow).toHaveBeenCalledTimes(1);
    expect(res.rows[0]).toMatchObject({ dbId: "id_a", key: "id_a", dirty: false });
    expect(res.rows[1].dirty).toBe(false); // intocada
    expect(res.rows[2]).toMatchObject({ key: "c", dirty: true, dbId: null });
  });

  it("conta falhas quando saveRow retorna null e mantém a linha dirty", async () => {
    const rows: Row[] = [mk({ key: "a" }), mk({ key: "b" })];
    const saveRow = vi.fn(async (r: Row) => (r.key === "a" ? "id_a" : null));
    const res = await runSaveAll(rows, saveRow);

    expect(res.saved).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.rows[1]).toMatchObject({ key: "b", dirty: true, dbId: null });
  });

  it("não invoca saveRow se não há linhas dirty", async () => {
    const rows: Row[] = [mk({ dirty: false }), mk({ dirty: false })];
    const saveRow = vi.fn();
    const res = await runSaveAll(rows, saveRow);
    expect(res).toMatchObject({ saved: 0, failed: 0, skipped: 0 });
    expect(saveRow).not.toHaveBeenCalled();
  });
});

describe("runFinalize", () => {
  it("bloqueia quando não há nenhuma linha válida e não salva nem encaminha", async () => {
    const rows: Row[] = [mk({ valid: false })];
    const saveRow = vi.fn();
    const updateStatus = vi.fn();
    const res = await runFinalize(rows, saveRow, updateStatus);

    expect(res.kind).toBe("no_valid_rows");
    expect(saveRow).not.toHaveBeenCalled();
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("encaminha p/ aguardando_validacao quando tudo é salvo com sucesso", async () => {
    const rows: Row[] = [mk({ key: "a" }), mk({ key: "b" })];
    const saveRow = vi.fn(async (r: Row) => `id_${r.key}`);
    const updateStatus = vi.fn(async () => ({ error: null }));
    const res = await runFinalize(rows, saveRow, updateStatus);

    expect(res.kind).toBe("forwarded");
    expect(updateStatus).toHaveBeenCalledExactlyOnceWith("aguardando_validacao");
  });

  it("NÃO encaminha quando alguma linha falha no save (gate crítico)", async () => {
    const rows: Row[] = [mk({ key: "a" }), mk({ key: "b" })];
    const saveRow = vi.fn(async (r: Row) => (r.key === "a" ? "id_a" : null));
    const updateStatus = vi.fn();
    const res = await runFinalize(rows, saveRow, updateStatus);

    expect(res.kind).toBe("blocked_by_save_failure");
    if (res.kind === "blocked_by_save_failure") {
      expect(res.save).toMatchObject({ saved: 1, failed: 1 });
    }
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("propaga erro do updateStatus sem reverter linhas já salvas", async () => {
    const rows: Row[] = [mk({ key: "a" })];
    const saveRow = vi.fn(async () => "id_a");
    const updateStatus = vi.fn(async () => ({ error: "boom" }));
    const res = await runFinalize(rows, saveRow, updateStatus);

    expect(res.kind).toBe("status_update_failed");
    if (res.kind === "status_update_failed") {
      expect(res.error).toBe("boom");
      expect(res.save.saved).toBe(1);
      expect(res.rows[0]).toMatchObject({ dbId: "id_a", dirty: false });
    }
  });

  it("respeita targetStatus customizado", async () => {
    const rows: Row[] = [mk({ key: "a" })];
    const saveRow = vi.fn(async () => "id_a");
    const updateStatus = vi.fn(async () => ({ error: null }));
    await runFinalize(rows, saveRow, updateStatus, "rascunho");
    expect(updateStatus).toHaveBeenCalledExactlyOnceWith("rascunho");
  });
});
