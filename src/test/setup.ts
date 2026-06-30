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

// jsdom não implementa ResizeObserver / IntersectionObserver — polyfills mínimos
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver || ResizeObserverMock;
(window as any).ResizeObserver = (window as any).ResizeObserver || ResizeObserverMock;

class IntersectionObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
  root = null;
  rootMargin = "";
  thresholds = [];
}
(globalThis as any).IntersectionObserver = (globalThis as any).IntersectionObserver || IntersectionObserverMock;
(window as any).IntersectionObserver = (window as any).IntersectionObserver || IntersectionObserverMock;

// Mock global do HospitalContext para evitar "useHospital must be used within HospitalProvider"
// em testes que renderizam AppLayout/HospitalSwitcher sem o provider real.
// Testes que precisam de hospital específico podem sobrescrever com vi.mock próprio.
vi.mock("@/contexts/HospitalContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/contexts/HospitalContext")>();
  const fakeHospital = { id: "test-hospital", name: "Hospital Teste", code: "TST", state_uf: "DF" } as any;
  return {
    ...actual,
    useHospital: () => ({
      hospital: fakeHospital,
      availableHospitals: [fakeHospital],
      hospitals: [fakeHospital],
      primaryHospitalId: fakeHospital.id,
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

