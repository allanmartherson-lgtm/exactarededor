import "@testing-library/jest-dom";
import { vi } from "vitest";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// Mock global do HospitalContext para evitar "useHospital must be used within HospitalProvider"
// em testes que renderizam AppLayout/HospitalSwitcher sem o provider real.
// Testes que precisam de hospital específico podem sobrescrever com vi.mock próprio.
vi.mock("@/contexts/HospitalContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/contexts/HospitalContext")>();
  const fakeHospital = { id: "test-hospital", name: "Hospital Teste", code: "TST", state: "DF" };
  return {
    ...actual,
    useHospital: () => ({
      hospital: fakeHospital,
      hospitals: [fakeHospital],
      loading: false,
      switching: false,
      needsSelection: false,
      switchHospital: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
    }),
    useActiveHospitalId: () => fakeHospital.id,
    useEnforcedHospitalId: () => fakeHospital.id,
    HospitalProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});
