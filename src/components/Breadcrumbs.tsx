import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { NAV_ITEMS, isGroup, type NavLeaf, type NavGroup } from "@/config/navItems";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const EXTRA_LABELS: Record<string, string> = {
  "/pagamentos/novo": "Nova base",
  "/pagamentos": "Pagamentos",
  "/diagnostico/sidebar": "Diagnóstico do sidebar",
  "/diagnostico": "Diagnóstico",
  "/wcag-audit": "Auditoria WCAG",
};

function findLeafByPath(path: string): { leaf: NavLeaf; group?: NavGroup } | null {
  for (const item of NAV_ITEMS) {
    if (isGroup(item)) {
      const leaf = item.children.find((c) => c.to === path);
      if (leaf) return { leaf, group: item };
    } else if (item.to === path) {
      return { leaf: item };
    }
  }
  return null;
}

function labelFor(path: string, dynamicLabels: Record<string, string>): string {
  if (dynamicLabels[path]) return dynamicLabels[path];
  
  const found = findLeafByPath(path);
  if (found) return found.leaf.label;
  if (EXTRA_LABELS[path]) return EXTRA_LABELS[path];
  
  // Fallback: last segment, decoded and prettified.
  const seg = path.split("/").filter(Boolean).pop() ?? "";
  try {
    return decodeURIComponent(seg).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return seg;
  }
}

export const Breadcrumbs = () => {
  const { pathname } = useLocation();
  const [dynamicLabels, setDynamicLabels] = useState<Record<string, string>>({});

  useEffect(() => {
    const fetchLabels = async () => {
      const segments = pathname.split("/").filter(Boolean);
      const newLabels: Record<string, string> = {};

      // Dashboard > Pagamentos > [Nome do Lote]
      if (segments[0] === "pagamentos" && segments[1] && segments[1] !== "novo") {
        const paymentId = segments[1];
        const { data } = await supabase
          .from("payments")
          .select("reference")
          .eq("id", paymentId)
          .single();
        if (data?.reference) {
          newLabels[`/pagamentos/${paymentId}`] = data.reference;
        }

        // Dashboard > Pagamentos > [Nome do Lote] > Empresa > [Nome da Empresa]
        if (segments[2] === "empresa" && segments[3]) {
          const groupId = segments[3];
          const { data: groupData } = await supabase
            .from("payment_company_groups")
            .select("company_name")
            .eq("id", groupId)
            .single();
          if (groupData?.company_name) {
            const truncated = groupData.company_name.length > 40 
              ? groupData.company_name.slice(0, 37) + "..."
              : groupData.company_name;
            newLabels[`/pagamentos/${paymentId}/empresa/${groupId}`] = truncated;
            newLabels[`/pagamentos/${paymentId}/empresa`] = "Empresa";
          }
        }
      }

      setDynamicLabels(prev => ({ ...prev, ...newLabels }));
    };

    fetchLabels();
  }, [pathname]);

  const crumbs: { label: string; to?: string }[] = [{ label: "Dashboard", to: "/" }];
  
  if (pathname !== "/" && pathname !== "") {
    const found = findLeafByPath(pathname);
    if (found?.group) {
      crumbs.push({ label: found.group.label });
    }

    const segments = pathname.split("/").filter(Boolean);
    let acc = "";
    segments.forEach((seg, idx) => {
      acc += `/${seg}`;
      const isLast = idx === segments.length - 1;
      crumbs.push({ 
        label: labelFor(acc, dynamicLabels), 
        to: isLast ? undefined : acc 
      });
    });
  }

  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex items-center flex-wrap gap-1 text-[12.5px] text-muted-foreground">
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1 min-w-0">
              {i > 0 && (
                <ChevronRight
                  size={13}
                  strokeWidth={1.75}
                  className="flex-shrink-0 text-muted-foreground/60"
                  aria-hidden
                />
              )}
              {c.to && !isLast ? (
                <Link
                  to={c.to}
                  className="inline-flex items-center gap-1 hover:text-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-0.5"
                >
                  {i === 0 && <Home size={12} strokeWidth={1.75} aria-hidden />}
                  <span className="truncate">{c.label}</span>
                </Link>
              ) : (
                <span
                  aria-current={isLast ? "page" : undefined}
                  className={
                    "inline-flex items-center gap-1 px-0.5 " +
                    (isLast ? "text-foreground font-medium" : "")
                  }
                >
                  {i === 0 && <Home size={12} strokeWidth={1.75} aria-hidden />}
                  <span className="truncate">{c.label}</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};