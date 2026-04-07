import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock matchMedia
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // Deprecated
    removeListener: vi.fn(), // Deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock ResizeObserver
class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);

// Robust compatibility shim for the 'jest' global
const jestShim = {
  fn: vi.fn.bind(vi),
  spyOn: vi.spyOn.bind(vi),
  mock: vi.mock.bind(vi),
  unmock: vi.unmock.bind(vi),
  clearAllMocks: vi.clearAllMocks.bind(vi),
  resetAllMocks: vi.resetAllMocks.bind(vi),
  restoreAllMocks: vi.restoreAllMocks.bind(vi),
  mocked: vi.mocked.bind(vi),
  requireActual: (path: string) => {
    // Note: Vitest's importActual is async, so this shim is limited
    // but often works for simple object exports or types.
    console.warn(
      `[Vitest Shim] jest.requireActual('${path}') is limited in Vitest.`,
    );
    return {};
  },
  requireMock: (path: string) => {
    console.warn(
      `[Vitest Shim] jest.requireMock('${path}') is limited in Vitest.`,
    );
    return {};
  },
  advanceTimersByTime: vi.advanceTimersByTime.bind(vi),
  runAllTimers: vi.runAllTimers.bind(vi),
  useFakeTimers: vi.useFakeTimers.bind(vi),
  useRealTimers: vi.useRealTimers.bind(vi),
  setSystemTime: vi.setSystemTime.bind(vi),
};

(globalThis as any).jest = jestShim;
