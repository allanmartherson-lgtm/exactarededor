import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  Upload,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import * as XLSX from "xlsx";

const SurfaceCard = ({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) => (
  <div
    style={{
      background: "hsl(var(--card))",
      border: "1px solid hsl(var(--border))",
      borderRadius: 12,
      ...style,
    }}
  >
    {children}
  </div>
);

export default function BasesConciliacaoPanel() {
  const { user } = useAuth();
  const [concBases, setConcBases] = useState<any[]>([]);
  const [uploadingConc, setUploadingConc] = useState(false);
  const concFileRef = useRef<HTMLInputElement>(null);
  const [expandedConcBase, setExpandedConcBase] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<{
    file: File;
    rows: any[];
    colMap: Record<string, string>;
    competenceMonth: string;
    reference: string;
    terceirosUnicos: string[];
    sheetName: string;
  } | null>(null);

  const loadConcBases = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("conciliation_bases")
      .select(
        "id, reference, competence_month, file_name, sheet_name, total_rows, status, created_at, col_map, tem_itens_aplicados, versao",
      )
      .eq("status", "ativo")
      .order("created_at", { ascending: false });
    setConcBases(data ?? []);
  }, []);

  useEffect(() => {
    loadConcBases();
  }, [loadConcBases]);

  const prepareImportPreview = async (file: File) => {
    setUploadingConc(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const sheetName = wb.SheetNames.includes("Cirurgias e Procedimentos")
        ? "Cirurgias e Procedimentos"
        : wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
        defval: null,
        cellDates: true,
      } as any);

      const rows = rawRows.map((row) => {
        const clean: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) {
          if (v instanceof Date) {
            clean[k] = v.toISOString().slice(0, 10);
          } else if (v === null || v === undefined || v === "") {
            // omite
          } else {
            clean[k] = v;
          }
        }
        return clean;
      });

      if (rows.length === 0) {
        toast.error("Planilha vazia.");
        return;
      }

      const aliases: Record<string, string[]> = {
        attendance: ["atendimento", "nr atendimento", "num. atendimento"],
        procCode: ["código tuss (8d)", "codigo tuss (8d)", "tuss"],
        procName: ["procedimento/mat-med", "procedimento"],
        doctor: ["médico exec.", "medico exec."],
        date: ["dt. proced.", "data"],
        value: ["valor", "j"],
        company: ["terceiro"],
        patient: ["nome"],
        agreement: ["convênio", "convenio"],
      };
      const normKey = (s: string) =>
        s
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]/g, "");
      const colMap: Record<string, string> = {};
      for (const col of Object.keys(rows[0])) {
        const normCol = normKey(col);
        for (const [field, aliasList] of Object.entries(aliases)) {
          if (!colMap[field] && aliasList.some((a) => normKey(a) === normCol)) {
            colMap[field] = col;
            break;
          }
        }
      }

      let competenceMonth = "";
      const dateCol = colMap["date"];

      const parseDateToYearMonth = (v: any): string => {
        if (!v) return "";
        if (v instanceof Date && !isNaN(v.getTime())) {
          return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}`;
        }
        const s = String(v).trim();
        if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
        const brMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (brMatch) return `${brMatch[3]}-${brMatch[2].padStart(2, "0")}`;
        if (typeof v === "number" && v > 40000) {
          const d = new Date(Math.round((v - 25569) * 86400 * 1000));
          if (!isNaN(d.getTime()))
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        }
        return "";
      };

      if (dateCol) {
        for (const row of rows.slice(0, 20)) {
          const result = parseDateToYearMonth(row[dateCol]);
          if (result) {
            competenceMonth = result;
            break;
          }
        }
      }
      if (!competenceMonth && dateCol) {
        for (const raw of rawRows.slice(0, 20)) {
          const result = parseDateToYearMonth(raw[dateCol]);
          if (result) {
            competenceMonth = result;
            break;
          }
        }
      }

      const companyCol = colMap["company"];
      const terceirosUnicos = companyCol
        ? [
            ...new Set(
              rows.map((r) => String(r[companyCol] ?? "").trim()).filter(Boolean),
            ),
          ]
        : [];

      setImportPreview({
        file,
        rows,
        colMap,
        competenceMonth,
        reference: `Conciliação ${
          competenceMonth
            ? new Date(competenceMonth + "-01").toLocaleDateString("pt-BR", {
                month: "long",
                year: "numeric",
              })
            : new Date().toLocaleDateString("pt-BR")
        } — ${file.name.replace(/\.[^.]+$/, "")}`,
        terceirosUnicos,
        sheetName,
      });
    } catch (e: any) {
      toast.error("Erro ao ler planilha", { description: e.message });
    } finally {
      setUploadingConc(false);
    }
  };

  const confirmImportConcBase = async () => {
    if (!importPreview) return;
    setUploadingConc(true);
    try {
      const { file, rows, colMap, competenceMonth, reference, sheetName } = importPreview;

      const { error } = await (supabase as any).from("conciliation_bases").insert({
        reference,
        competence_month: competenceMonth || null,
        file_name: file.name,
        sheet_name: sheetName,
        uploaded_by: user?.id,
        total_rows: rows.length,
        raw_data: rows as any,
        col_map: colMap,
        status: "ativo",
      });

      if (error) {
        console.error("Erro ao salvar base de conciliação:", error);
        throw new Error(error.message ?? "Erro desconhecido ao salvar no banco");
      }
      toast.success(`Base importada: ${rows.length} linhas`, {
        description: `${Object.keys(colMap).length} colunas mapeadas · pronta para conciliação`,
      });

      try {
        const { data: allCompanies } = await supabase
          .from("companies")
          .select("id, name")
          .order("name");

        if (allCompanies && rows.length > 0) {
          const companyCol = colMap["company"];
          if (companyCol) {
            const terceirosUnicos = [
              ...new Set(
                rows.map((r) => String(r[companyCol] ?? "").trim()).filter(Boolean),
              ),
            ];

            const normFull = (s: string) =>
              s
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9\s]/g, "")
                .trim();

            const stopwords = new Set([
              "de","da","do","das","dos","e","em","por","para","com","ltda","eireli","ss","me","sa","s/a",
            ]);

            const getTokens = (s: string) =>
              normFull(s)
                .split(/\s+/)
                .filter((t) => t.length >= 3 && !stopwords.has(t));

            const matchMap: Record<
              string,
              { company_id: string; company_name: string; level: string }
            > = {};

            for (const terceiro of terceirosUnicos) {
              const normT = normFull(terceiro);
              const tokensT = getTokens(terceiro);
              let best: { company_id: string; company_name: string; level: string } | null = null;

              for (const c of allCompanies) {
                const normC = normFull(c.name);
                if (normC === normT) {
                  best = { company_id: c.id, company_name: c.name, level: "exact" };
                  break;
                }
                if (normT.includes(normC) || normC.includes(normT)) {
                  if (!best || best.level !== "exact")
                    best = { company_id: c.id, company_name: c.name, level: "high" };
                }
                if (!best || (best.level !== "exact" && best.level !== "high")) {
                  const tokensC = getTokens(c.name);
                  const common = tokensT.filter((t) => tokensC.includes(t));
                  if (common.length >= 2) {
                    best = { company_id: c.id, company_name: c.name, level: "medium" };
                  }
                }
              }
              if (best) matchMap[terceiro] = best;
            }

            const { data: baseRecente } = await (supabase as any)
              .from("conciliation_bases")
              .select("id")
              .eq("uploaded_by", user?.id ?? "")
              .order("created_at", { ascending: false })
              .limit(1)
              .single();

            if (baseRecente) {
              await (supabase as any)
                .from("conciliation_bases")
                .update({
                  col_map: { ...colMap, _company_match: matchMap },
                })
                .eq("id", baseRecente.id);
            }
          }
        }
      } catch (e) {
        console.warn("Auto-match de PJ falhou:", e);
      }

      setImportPreview(null);
      loadConcBases();
    } catch (e: any) {
      toast.error("Erro ao importar base", { description: e.message });
    } finally {
      setUploadingConc(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Cards de resumo */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        {[
          {
            label: "Bases ativas",
            value: concBases.filter((b) => !b.tem_itens_aplicados).length,
            color: "var(--bubble-green-fg)",
          },
          {
            label: "Com itens aplicados",
            value: concBases.filter((b) => b.tem_itens_aplicados).length,
            color: "var(--bubble-yellow-fg)",
          },
          {
            label: "Total de linhas",
            value: concBases.reduce((s, b) => s + (b.total_rows ?? 0), 0).toLocaleString("pt-BR"),
            color: "var(--muted-foreground)",
          },
        ].map((card) => (
          <SurfaceCard key={card.label} style={{ padding: "14px 18px" }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: `hsl(${card.color})`,
                marginBottom: 6,
              }}
            >
              {card.label}
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 300,
                color: `hsl(${card.color})`,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {card.value}
            </div>
          </SurfaceCard>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <p style={{ fontSize: 13, color: "hsl(var(--muted-foreground))" }}>
          Bases mensais do sistema hospitalar para conciliação. Atualize todo mês.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            ref={concFileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              await prepareImportPreview(file);
              e.target.value = "";
            }}
          />
          <Button onClick={() => concFileRef.current?.click()} disabled={uploadingConc}>
            {uploadingConc ? (
              <>
                <RefreshCw size={14} className="animate-spin mr-1" />
                Importando…
              </>
            ) : (
              <>
                <Upload size={14} className="mr-1" />
                Importar base
              </>
            )}
          </Button>
        </div>
      </div>

      {concBases.length === 0 ? (
        <SurfaceCard style={{ padding: 40, textAlign: "center" }}>
          <FileText
            size={32}
            style={{ color: "hsl(var(--muted-foreground))", margin: "0 auto 12px" }}
          />
          <p style={{ fontSize: 14, color: "hsl(var(--muted-foreground))" }}>
            Nenhuma base importada ainda.
          </p>
          <p
            style={{
              fontSize: 12,
              color: "hsl(var(--muted-foreground))",
              marginTop: 4,
            }}
          >
            Importe a planilha mensal do sistema hospitalar.
          </p>
        </SurfaceCard>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {concBases.map((base) => {
            const isExpanded = expandedConcBase === base.id;
            const matchMap = base.col_map?._company_match ?? {};
            const matchedCount = Object.keys(matchMap).length;
            return (
              <SurfaceCard key={base.id}>
                <button
                  type="button"
                  onClick={() => setExpandedConcBase(isExpanded ? null : base.id)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "14px 18px",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                  }}
                >
                  <div style={{ color: "hsl(var(--muted-foreground))" }}>
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "hsl(var(--foreground))" }}>
                      {base.reference}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: "hsl(var(--muted-foreground))",
                        marginTop: 2,
                      }}
                    >
                      {base.total_rows?.toLocaleString("pt-BR")} linhas · {base.file_name}
                      {base.competence_month &&
                        ` · ${new Date(base.competence_month + "-01").toLocaleDateString("pt-BR", {
                          month: "long",
                          year: "numeric",
                        })}`}
                      {matchedCount > 0 && ` · ${matchedCount} empresa(s) detectada(s)`}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                    {base.tem_itens_aplicados ? (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 9999,
                          background: "hsl(var(--bubble-yellow-bg))",
                          color: "hsl(var(--bubble-yellow-fg))",
                        }}
                      >
                        ⚠ Com itens aplicados
                      </span>
                    ) : (
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 9999,
                          background: "hsl(var(--bubble-green-bg))",
                          color: "hsl(var(--bubble-green-fg))",
                        }}
                      >
                        <CheckCircle2 size={11} /> Disponível
                      </span>
                    )}
                    {base.versao > 1 && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: "2px 6px",
                          borderRadius: 9999,
                          background: "hsl(var(--muted))",
                          color: "hsl(var(--muted-foreground))",
                        }}
                      >
                        v{base.versao}
                      </span>
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div
                    style={{
                      borderTop: "1px solid hsl(var(--border))",
                      padding: "16px 18px",
                    }}
                  >
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                      <div>
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            color: "hsl(var(--muted-foreground))",
                            marginBottom: 10,
                          }}
                        >
                          Metadados da base
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {[
                            { label: "Arquivo", value: base.file_name },
                            { label: "Aba", value: base.sheet_name ?? "—" },
                            {
                              label: "Competência",
                              value: base.competence_month
                                ? new Date(base.competence_month + "-01").toLocaleDateString("pt-BR", {
                                    month: "long",
                                    year: "numeric",
                                  })
                                : "Não detectada",
                            },
                            {
                              label: "Importado em",
                              value: new Date(base.created_at).toLocaleDateString("pt-BR", {
                                day: "2-digit",
                                month: "2-digit",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              }),
                            },
                            {
                              label: "Total de linhas",
                              value: base.total_rows?.toLocaleString("pt-BR") ?? "—",
                            },
                            {
                              label: "Colunas detectadas",
                              value:
                                Object.keys(base.col_map ?? {})
                                  .filter((k) => !k.startsWith("_"))
                                  .join(", ") || "—",
                            },
                          ].map(({ label, value }) => (
                            <div key={label} style={{ display: "flex", gap: 8, fontSize: 12 }}>
                              <span
                                style={{
                                  color: "hsl(var(--muted-foreground))",
                                  minWidth: 130,
                                  flexShrink: 0,
                                }}
                              >
                                {label}:
                              </span>
                              <span
                                style={{ color: "hsl(var(--foreground))", fontWeight: 500 }}
                              >
                                {value}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div>
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            color: "hsl(var(--muted-foreground))",
                            marginBottom: 10,
                          }}
                        >
                          Empresas detectadas ({Object.keys(matchMap).length})
                        </div>
                        {Object.keys(matchMap).length === 0 ? (
                          <p style={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }}>
                            Nenhuma empresa detectada automaticamente.
                          </p>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {Object.entries(matchMap).map(([terceiro, match]: [string, any]) => (
                              <div
                                key={terceiro}
                                style={{
                                  fontSize: 11,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                }}
                              >
                                <span
                                  style={{
                                    fontSize: 9,
                                    fontWeight: 700,
                                    padding: "1px 5px",
                                    borderRadius: 4,
                                    background:
                                      match.level === "exact"
                                        ? "hsl(var(--success-soft))"
                                        : match.level === "high"
                                          ? "hsl(var(--info-soft))"
                                          : "hsl(var(--warning-soft))",
                                    color:
                                      match.level === "exact"
                                        ? "hsl(var(--success))"
                                        : match.level === "high"
                                          ? "hsl(var(--info))"
                                          : "hsl(var(--warning-text))",
                                    flexShrink: 0,
                                  }}
                                >
                                  {match.level === "exact"
                                    ? "Exato"
                                    : match.level === "high"
                                      ? "Alto"
                                      : "Médio"}
                                </span>
                                <span
                                  style={{
                                    color: "hsl(var(--muted-foreground))",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                  title={terceiro}
                                >
                                  {terceiro}
                                </span>
                                <span style={{ color: "hsl(var(--muted-foreground))" }}>→</span>
                                <span
                                  style={{
                                    color: "hsl(var(--foreground))",
                                    fontWeight: 500,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                  title={match.company_name}
                                >
                                  {match.company_name}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        marginTop: 16,
                        paddingTop: 12,
                        borderTop: "1px solid hsl(var(--border))",
                      }}
                    >
                      {!base.tem_itens_aplicados && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (
                              !confirm(
                                "Arquivar esta base? Ela não poderá mais ser usada em novas conciliações.",
                              )
                            )
                              return;
                            await (supabase as any)
                              .from("conciliation_bases")
                              .update({ status: "arquivado" })
                              .eq("id", base.id);
                            loadConcBases();
                            toast.success("Base arquivada");
                          }}
                          style={{
                            background: "none",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: 6,
                            padding: "4px 12px",
                            fontSize: 11,
                            color: "hsl(var(--muted-foreground))",
                            cursor: "pointer",
                          }}
                        >
                          Arquivar
                        </button>
                      )}
                      {base.tem_itens_aplicados && (
                        <span
                          style={{
                            fontSize: 11,
                            color: "hsl(var(--bubble-yellow-fg))",
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                          }}
                        >
                          <AlertTriangle size={12} /> Esta base tem itens aplicados em pagamentos
                          — não pode ser arquivada
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </SurfaceCard>
            );
          })}
        </div>
      )}

      {/* Modal de confirmação de importação */}
      <Dialog open={!!importPreview} onOpenChange={() => setImportPreview(null)}>
        <DialogContent
          style={{
            maxWidth: 580,
            width: "calc(100vw - 32px)",
            maxHeight: "85vh",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <DialogHeader>
            <DialogTitle>Confirmar importação da base</DialogTitle>
            <DialogDescription>
              Revise as informações antes de salvar. Você pode editar o nome e a competência.
            </DialogDescription>
          </DialogHeader>

          {importPreview && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 16,
                overflowY: "auto",
                overflowX: "hidden",
                minHeight: 0,
                flex: 1,
                paddingRight: 4,
              }}
            >
              <div>
                <Label style={{ fontSize: 12, marginBottom: 4, display: "block" }}>
                  Nome da base
                </Label>
                <Input
                  value={importPreview.reference}
                  onChange={(e) =>
                    setImportPreview((prev) =>
                      prev ? { ...prev, reference: e.target.value } : prev,
                    )
                  }
                  style={{ fontSize: 13 }}
                />
              </div>

              <div>
                <Label style={{ fontSize: 12, marginBottom: 4, display: "block" }}>
                  Competência (mês de referência)
                </Label>
                <Input
                  type="month"
                  value={importPreview.competenceMonth}
                  onChange={(e) =>
                    setImportPreview((prev) =>
                      prev ? { ...prev, competenceMonth: e.target.value } : prev,
                    )
                  }
                  style={{ fontSize: 13, width: 200 }}
                />
                {!importPreview.competenceMonth && (
                  <p
                    style={{
                      fontSize: 11,
                      color: "hsl(var(--destructive))",
                      marginTop: 4,
                    }}
                  >
                    ⚠ Competência não detectada automaticamente — informe manualmente
                  </p>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                {[
                  { label: "Linhas", value: importPreview.rows.length.toLocaleString("pt-BR") },
                  { label: "Empresas únicas", value: importPreview.terceirosUnicos.length },
                  { label: "Colunas detectadas", value: Object.keys(importPreview.colMap).length },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    style={{ background: "hsl(var(--muted))", borderRadius: 8, padding: "10px 14px" }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                        color: "hsl(var(--muted-foreground))",
                        marginBottom: 4,
                      }}
                    >
                      {label}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 300, color: "hsl(var(--foreground))" }}>
                      {value}
                    </div>
                  </div>
                ))}
              </div>

              {importPreview.terceirosUnicos.length > 0 && (
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "hsl(var(--muted-foreground))",
                      marginBottom: 6,
                    }}
                  >
                    Empresas na base ({importPreview.terceirosUnicos.length})
                  </div>
                  <div
                    style={{
                      maxHeight: 120,
                      overflowY: "auto",
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 4,
                    }}
                  >
                    {importPreview.terceirosUnicos.map((t) => (
                      <span
                        key={t}
                        style={{
                          fontSize: 10,
                          padding: "2px 8px",
                          borderRadius: 9999,
                          background: "hsl(var(--muted))",
                          color: "hsl(var(--foreground))",
                          border: "1px solid hsl(var(--border))",
                        }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "hsl(var(--muted-foreground))",
                    marginBottom: 6,
                  }}
                >
                  Prévia (5 primeiras linhas)
                </div>
                <div
                  style={{
                    overflowX: "auto",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 8,
                  }}
                >
                  <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "hsl(var(--muted))" }}>
                        {Object.values(importPreview.colMap).slice(0, 6).map((_col, i) => (
                          <th
                            key={i}
                            style={{
                              padding: "6px 10px",
                              textAlign: "left",
                              fontWeight: 600,
                              color: "hsl(var(--muted-foreground))",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {Object.keys(importPreview.colMap)[i]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.rows.slice(0, 5).map((row, i) => (
                        <tr
                          key={i}
                          style={{ borderTop: "1px solid hsl(var(--border))" }}
                        >
                          {Object.values(importPreview.colMap).slice(0, 6).map((col, j) => (
                            <td
                              key={j}
                              style={{
                                padding: "5px 10px",
                                color: "hsl(var(--foreground))",
                                whiteSpace: "nowrap",
                                maxWidth: 120,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {String(row[col] ?? "—")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportPreview(null)}>
              Cancelar
            </Button>
            <Button onClick={confirmImportConcBase} disabled={uploadingConc}>
              {uploadingConc ? (
                <>
                  <RefreshCw size={14} className="animate-spin mr-1" />
                  Salvando…
                </>
              ) : (
                "Confirmar importação"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
