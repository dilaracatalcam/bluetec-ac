import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import Home from "./Home.jsx";

/* Operatörlere açılacak "Dashboard" (isAdmin=false) görünümünün, admin'e özel
   bölümleri (SECTIONS'taki adminOnly/superadminOnly kayıtlar, Home.jsx:207-224)
   hiç göstermediğini doğrular. Gerçek risk: bir admin-only bölüm yanlışlıkla
   sidebar filtresinden (Home.jsx:340-346) kaçarsa, operatör normalde
   göremeyeceği bir yönetim ekranına erişebilir. */

const ADMIN_ONLY_LABELS = [
  "OTA Güncelleme",
  "Aktif Bağlantılar",
  "Kullanıcı Yönetimi",
  "Cihaz Yönetimi",
  "Cihaz Kurulum",
  "Toplu Güncelleme",
  "OTA Sunucu Kontrolü",
  "Cihaz Versiyonları",
];

const OPERATOR_VISIBLE_LABELS = [
  "Cihaz Seç",
  "OCPP & WiFi",
  "Bağlantı & UI",
  "MSP Konfigürasyon",
  "ESP Kontrol",
  "Canlı Telemetri",
  "MSP Telemetri",
  "OCPP Credentials",
  "Hesap Yönetimi",
];

function mockFetchAsOperator() {
  const fetchMock = vi.fn((url) => {
    const u = String(url);
    if (u.includes("/api/me")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ username: "op1", fullName: "Operatör Bir", role: "operator", session_id: "op1" }),
      });
    }
    if (u.includes("/api/ota-server/list")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ logos: [] }) });
    }
    if (u.includes("/api/ota-server/firmware-versions")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ espVersions: [], espHardware: [] }) });
    }
    if (u.includes("/api/devices/companies")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ companies: [] }) });
    }
    if (u.includes("/api/devices")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ devices: [] }) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Home (Dashboard, isAdmin=false) — operator rolü", () => {
  // "Cihaz Seç" varsayılan aktif sekme olduğu için hem sidebar'da hem ana
  // içerik başlığında aynı anda görünür — sorguları sidebar'a (<nav>) scope
  // etmezsek getByText "Found multiple elements" ile patlar.
  it("admin'e özel sidebar bölümleri hiç gösterilmez", async () => {
    mockFetchAsOperator();
    render(<Home token="tok" isAdmin={false} onNavigate={() => {}} onLogout={() => {}} />);

    const nav = screen.getByRole("navigation");
    // /api/me çözülüp operator rolü belirlendikten sonra sidebar filtrelenir
    await waitFor(() => expect(within(nav).getByText("Cihaz Seç")).toBeInTheDocument());

    for (const label of ADMIN_ONLY_LABELS) {
      expect(within(nav).queryByText(label)).not.toBeInTheDocument();
    }
  });

  it("operatöre açık bölümler sidebar'da görünür", async () => {
    mockFetchAsOperator();
    render(<Home token="tok" isAdmin={false} onNavigate={() => {}} onLogout={() => {}} />);

    const nav = screen.getByRole("navigation");
    await waitFor(() => expect(within(nav).getByText("Cihaz Seç")).toBeInTheDocument());

    for (const label of OPERATOR_VISIBLE_LABELS) {
      expect(within(nav).getByText(label)).toBeInTheDocument();
    }
  });

  it("panel erişimi olmayana Dashboard/Panel seçimi gösterilmez, menü açılır-kapanır değildir", async () => {
    mockFetchAsOperator();
    render(<Home token="tok" isAdmin={false} onNavigate={() => {}} onLogout={() => {}} />);

    const nav = screen.getByRole("navigation");
    await waitFor(() => expect(within(nav).getByText("Cihaz Seç")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Panel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dashboard" })).not.toBeInTheDocument();
    // grup başlıkları buton değil; içindeki bölümler tıklamadan görünür
    expect(within(nav).queryAllByRole("button", { expanded: false })).toHaveLength(0);
  });
});
