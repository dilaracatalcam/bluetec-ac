import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DeviceSelect from "./DeviceSelect.jsx";

/* Operatörlere backend `mac` alanını hiç göndermiyor (server.js:1150 civarı
   sanitize mantığı). DeviceSelect bu durumda MAC sütununu/aramasını tamamen
   gizlemeli — aksi halde boş bir sütun gösterir ve arama metni yanıltıcı olur.
   Bkz. DeviceSelect.jsx:54-60 (hasMacs). */

function mockFetchFor(devices) {
  const fetchMock = vi.fn((url) => {
    if (String(url).includes("/api/devices/companies")) {
      return Promise.resolve({ json: () => Promise.resolve({ companies: ["Acropol"] }) });
    }
    if (String(url).includes("/api/devices?company=")) {
      return Promise.resolve({ json: () => Promise.resolve({ devices }) });
    }
    if (String(url).includes("/api/devices")) {
      return Promise.resolve({ json: () => Promise.resolve({ devices }) });
    }
    return Promise.resolve({ json: () => Promise.resolve({}) });
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DeviceSelect — operatör (mac alanı yok)", () => {
  it("hiçbir cihazda mac yoksa MAC sütunu ve aramada MAC ifadesi gösterilmez", async () => {
    mockFetchFor([
      { id: 1, device_code: "D1", location: "Ankara", connection: "GSM" },
      { id: 2, device_code: "D2", location: "İstanbul", connection: "WiFi" },
    ]);

    render(<DeviceSelect token="tok" />);

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole("combobox")).toBeInTheDocument());
    await user.selectOptions(screen.getByRole("combobox"), "Acropol");

    await waitFor(() => expect(screen.getByText("D1", { exact: false })).toBeInTheDocument());

    expect(screen.queryByText("MAC Adresi")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Konum, ID veya MAC ara...")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Konum veya ID ara...")).toBeInTheDocument();
  });
});

describe("DeviceSelect — superadmin (mac alanı var)", () => {
  it("mac içeren cihazlar varsa MAC sütunu gösterilir", async () => {
    mockFetchFor([
      { id: 1, device_code: "D1", location: "Ankara", connection: "GSM", mac: "AA:BB:CC:DD:EE:FF" },
    ]);

    render(<DeviceSelect token="tok" isSuperadmin />);

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByRole("combobox")).toBeInTheDocument());
    await user.selectOptions(screen.getByRole("combobox"), "Acropol");

    await waitFor(() => expect(screen.getByText("MAC Adresi")).toBeInTheDocument());
    expect(screen.getByText("AA:BB:CC:DD:EE:FF")).toBeInTheDocument();
  });
});
