
import { normAccessRoute, ruleAcceptsAccessRoute } from "./supabase/functions/_shared/rulesEngine.ts";

const itemVia = "Mesma via de acesso";
const allowedVias = ["Única ou Principal"];

console.log("Item Via (raw):", itemVia);
console.log("Item Via (norm):", normAccessRoute(itemVia));
console.log("Allowed Vias (raw):", allowedVias);
console.log("Allowed Vias (norm):", allowedVias.map(normAccessRoute));

const accepts = ruleAcceptsAccessRoute({ allowed_access_routes: allowedVias }, { access_route: itemVia } as any);
console.log("Accepts:", accepts);

const itemVia2 = "Via de acesso diferente";
const allowedVias2 = ["Mesma Via", "Outra Via"];
console.log("\nItem Via 2 (raw):", itemVia2);
console.log("Item Via 2 (norm):", normAccessRoute(itemVia2));
console.log("Allowed Vias 2 (raw):", allowedVias2);
console.log("Allowed Vias 2 (norm):", allowedVias2.map(normAccessRoute));
const accepts2 = ruleAcceptsAccessRoute({ allowed_access_routes: allowedVias2 }, { access_route: itemVia2 } as any);
console.log("Accepts 2:", accepts2);
