### Plan
1. Update `selectWinningRule` in `supabase/functions/_shared/rulesEngine.ts`.
2. Modify the definition of `generalMaster` to include Master rules that match the item's sector, even if they aren't explicitly "outro". This makes "Master" rules more accessible if they are scoped to a sector but have no doctor/company target.
3. Verify the logic remains deterministic and doesn't break existing priorities.

### Technical Details
- In `selectWinningRule`, update:
  ```typescript
  const generalMaster = filterBySpecialty(
    rules.filter((r) => 
      r.scope === "master" && 
      (ruleSectors(r).includes("outro") || ruleSectors(r).includes(itemSector) || ruleSectors(r).length === 0)
    ), 
    "setor_master_geral"
  );
  ```
- This will allow Master rules defined with a specific sector (like "Cirurgia") to be treated as candidates even if the item sector doesn't fall into the legacy `sectorRules` logic or if it's meant to be a more universal "master" rule.
