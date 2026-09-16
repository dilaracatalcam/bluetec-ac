import { defineConfig, devices } from "@playwright/test";

/* ── Operator dashboard e2e testi ──
   İki süreci otomatik başlatır:
     1) backend/test/e2e-server.js — izole DB/users/target/responses ile
        gerçek server.js app'i, sabit portta (8099).
     2) Vite dev server — VITE_API_PROXY_TARGET ile /api isteklerini gerçek
        8005 (production) yerine 8099'a (e2e backend) yönlendirir.
   Böylece testler gerçek panele/production DB'sine asla dokunmaz. */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5183",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: "node ../backend/test/e2e-server.js",
      port: 8099,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: "npm run dev -- --port 5183 --strictPort",
      port: 5183,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { VITE_API_PROXY_TARGET: "http://localhost:8099" },
    },
  ],
});
