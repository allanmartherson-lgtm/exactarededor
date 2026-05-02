import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { NAV_ITEMS, isGroup, type NavItem, type NavLeaf, type NavGroup } from "@/config/navItems";

/**
 * Extra label fallbacks for routes that exist in the router but are not
 * present as leaves in NAV_ITEMS (detail / nested pages). Routing is NOT
 * changed — this only affects the breadcrumb labels.
 */
const EXTRA_LABELS: Record<string, string> = {
  "/pagamentos/novo": "Nova base",
  "/pagamentos": "Pagamentos",
  "/diagnostico/sidebar": "Diagnóstico do sidebar",
  "/diagnostico": "Diagnóstico",
  "/wcag-audit": "Auditoria WCAG",
};

type Crumb = { label: string; to?: string };

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

function labelFor(path: string): string {
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

function buildCrumbs(pathname: string): Crumb[] {
  if (pathname === "/" || pathname === "") {
    return [{ label: "Dashboard" }];
  }

  const crumbs: Crumb[] = [{ label: "Dashboard", to: "/" }];

  // If the leaf belongs to a topbar group, surface that group as a non-clickable crumb.
  const found = findLeafByPath(pathname);
  if (found?.group) {
    crumbs.push({ label: found.group.label });
  }

  // Build cumulative segment crumbs.
  const segments = pathname.split("/").filter(Boolean);
  let acc = "";
  segments.forEach((seg, idx) => {
    acc += `/${seg}`;
    const isLast = idx === segments.length - 1;
    crumbs.push({ label: labelFor(acc), to: isLast ? undefined : acc });
  });

  return crumbs;
}

export const Breadcrumbs = () => {
  const { pathname } = useLocation();
  const crumbs = buildCrumbs(pathname);

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