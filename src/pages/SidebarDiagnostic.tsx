import { NAV_ITEMS, flattenNav, filterNav, isGroup, ALL_ROLES, type Role } from "@/components/AppLayout";
import { ROLE_LABELS } from "@/lib/status";

const ROLES_TO_CHECK: Role[] = ["analista", "validador", "diretor", "admin"];

const EXPECTED_ORDER = [
  "Dashboard",
  "Pagamentos",
  "Notas Fiscais",
  "KPIs",
  "Regras",
  "Tabelas de referência",
  "Empresas",
  "Centros de custo",
  "Usuários",
  "Auditoria",
];

export default function SidebarDiagnostic() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">Diagnóstico do Sidebar</h1>
        <p className="text-sm text-muted-foreground">
          Lista os itens que cada role visualiza no sidebar (lista plana) e no topbar (com grupos),
          a partir do mesmo source-of-truth (<code className="font-mono">NAV_ITEMS</code>).
        </p>
      </header>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground mb-2">Ordem fixa esperada (sidebar)</h2>
        <ol className="list-decimal pl-5 text-[13px] text-muted-foreground space-y-0.5">
          {EXPECTED_ORDER.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ol>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {ROLES_TO_CHECK.map((role) => {
          const sidebarItems = flattenNav(NAV_ITEMS).filter((c) =>
            c.roles.some((r) => [role].includes(r)),
          );
          const topbarItems = filterNav(NAV_ITEMS, [role]);
          const labels = sidebarItems.map((i) => i.label);
          const matchesExpected =
            JSON.stringify(labels) === JSON.stringify(EXPECTED_ORDER);

          return (
            <article
              key={role}
              className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3"
            >
              <header className="flex items-center justify-between">
                <div className="flex flex-col">
                  <h2 className="text-base font-semibold text-foreground">
                    {ROLE_LABELS[role]}
                  </h2>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    role: {role}
                  </p>
                </div>
                <span
                  className={
                    "text-[11px] font-medium px-2 py-1 rounded-md " +
                    (role === "admin"
                      ? matchesExpected
                        ? "bg-primary/10 text-primary"
                        : "bg-destructive/10 text-destructive"
                      : "bg-muted text-muted-foreground")
                  }
                >
                  {sidebarItems.length} itens
                </span>
              </header>

              <div>
                <h3 className="text-xs font-semibold text-foreground mb-1.5">
                  Sidebar (lista plana)
                </h3>
                <ol className="list-decimal pl-5 text-[13px] text-foreground space-y-0.5">
                  {sidebarItems.map((item) => {
                    const expectedIdx = EXPECTED_ORDER.indexOf(item.label);
                    const missing = expectedIdx === -1;
                    return (
                      <li
                        key={item.to}
                        className={missing ? "text-destructive" : undefined}
                      >
                        {item.label}{" "}
                        <span className="text-muted-foreground">
                          — <code className="font-mono text-[11px]">{item.to}</code>
                        </span>
                      </li>
                    );
                  })}
                </ol>
                {role === "admin" && !matchesExpected && (
                  <p className="mt-2 text-[12px] text-destructive">
                    ⚠️ Sequência diverge da ordem fixa esperada.
                  </p>
                )}
              </div>

              <div>
                <h3 className="text-xs font-semibold text-foreground mb-1.5">
                  Topbar (com grupos)
                </h3>
                <ul className="text-[13px] text-foreground space-y-1">
                  {topbarItems.map((item) => (
                    <li key={isGroup(item) ? item.label : item.to}>
                      {isGroup(item) ? (
                        <>
                          <span className="font-medium">{item.label}</span>
                          <ul className="pl-4 mt-0.5 list-disc text-muted-foreground">
                            {item.children.map((c) => (
                              <li key={c.to}>{c.label}</li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        <span>{item.label}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          );
        })}
      </div>

      <footer className="text-[11px] text-muted-foreground">
        Roles disponíveis na app: {ALL_ROLES.join(", ")}.
      </footer>
    </div>
  );
}