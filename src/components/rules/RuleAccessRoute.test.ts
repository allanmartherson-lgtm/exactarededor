import { describe, it, expect } from 'vitest';

// Função de normalização extraída para teste
function normalizeAccessRoute(input: string): string {
  const n = input.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  
  if (/(unica|principal|unica\/principal|unica ou principal|1[aª]|1[.\s]?via|primeira\s?via|unica\s?\/\s?principal)/i.test(n)) {
    return "Única ou Principal";
  } 
  if (/(mesma\s?via|mesma|repetida)/i.test(n)) {
    return "Mesma Via";
  } 
  if (/(outra\s?via|via\s?diferente|diferente|2[aª]|segunda\s?via)/i.test(n)) {
    return "Outra Via";
  }
  return input;
}

describe('Access Route Normalization', () => {
  it('should normalize variations of "Única ou Principal"', () => {
    const variations = [
      "1ª via", "1a via", "1 via", "primeira via", "Única", "Principal", 
      "unica/principal", "Única ou Principal", "1.a via", "única / principal"
    ];
    variations.forEach(v => {
      expect(normalizeAccessRoute(v)).toBe("Única ou Principal");
    });
  });

  it('should normalize variations of "Mesma Via"', () => {
    const variations = ["mesma", "mesma via", "Mesma Via", "repetida"];
    variations.forEach(v => {
      expect(normalizeAccessRoute(v)).toBe("Mesma Via");
    });
  });

  it('should normalize variations of "Outra Via"', () => {
    const variations = ["outra via", "via diferente", "diferente", "2ª via", "segunda via", "2a"];
    variations.forEach(v => {
      expect(normalizeAccessRoute(v)).toBe("Outra Via");
    });
  });

  it('should return original string if no match is found', () => {
    expect(normalizeAccessRoute("Via Experimental")).toBe("Via Experimental");
  });
});
