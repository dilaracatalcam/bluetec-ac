import "@testing-library/jest-dom";

// jsdom, ResizeObserver'ı desteklemiyor — ScrollableTable.jsx gibi bileşenler
// bunu kullanıyor. Testler için minimal bir sahte (no-op) sağlanıyor.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
