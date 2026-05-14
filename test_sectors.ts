
import { normName, SECTOR_MAP } from "./supabase/functions/_shared/rulesEngine.ts";

const ruleSector = "Hemodinâmica";
const itemSector = "hemodinamica";

console.log(`Rule Sector: ${ruleSector} -> norm: ${normName(ruleSector)}`);
console.log(`Item Sector: ${itemSector} -> norm: ${normName(itemSector)}`);

const cSectors = [ruleSector];
const match = cSectors.map((s) => normName(String(s))).includes(normName(String(itemSector)));
console.log(`Match: ${match}`);

const ruleSector2 = "Cirurgia";
const itemSector2 = "Centro Cirúrgico";
console.log(`Rule Sector: ${ruleSector2} -> norm: ${normName(ruleSector2)}`);
console.log(`Item Sector: ${itemSector2} -> norm: ${normName(itemSector2)}`);
const match2 = [ruleSector2].map((s) => normName(String(s))).includes(normName(String(itemSector2)));
console.log(`Match 2: ${match2}`);
