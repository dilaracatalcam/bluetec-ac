import { describe, it, expect } from "vitest";
import { mapValue, csColor } from "./deviceValueMapping.js";

describe("mapValue", () => {
  it("undefined/null raw için tire döner", () => {
    expect(mapValue(7, undefined)).toBe("——");
    expect(mapValue(7, null)).toBe("——");
  });

  it("id 7 — bağlantı tipi", () => {
    expect(mapValue(7, "0")).toBe("CommSupported");
    expect(mapValue(7, "1")).toBe("GSM");
    expect(mapValue(7, "2")).toBe("WiFi");
    expect(mapValue(7, "3")).toBe("ETH");
    expect(mapValue(7, "9")).toBe("9");
  });

  it("id 13 — yazı/logo", () => {
    expect(mapValue(13, "0")).toBe("Yazı");
    expect(mapValue(13, "1")).toBe("Logo");
  });

  it("id 35 — gradient/renk", () => {
    expect(mapValue(35, "0")).toBe("Gradient");
    expect(mapValue(35, "1")).toBe("Renk");
  });

  it("id 27 — hata kodu", () => {
    expect(mapValue(27, "0")).toBe("Hata Yok");
    expect(mapValue(27, "5")).toBe("Hata: 5");
  });

  it("id 25 — şarj durumu (eski sayısal biçim)", () => {
    expect(mapValue(25, "0")).toBe("Beklemede");
    expect(mapValue(25, "1")).toBe("Şarj Oluyor");
    expect(mapValue(25, "2")).toBe("Tamamlandı");
  });

  it("id 25 — şarj durumu (P1..P6 kodları, bkz. firmware switch(currentState))", () => {
    expect(mapValue(25, "P1_IDLE")).toBe("Boşta");
    expect(mapValue(25, "P2_PLUG_IN")).toBe("Soket Takılı Değil");
    expect(mapValue(25, "P3_SCAN_RFID")).toBe("Soket Takılı, Şarj Yok");
    expect(mapValue(25, "P4_CHARGING")).toBe("Şarj Oluyor");
    expect(mapValue(25, "P5_CHARGE_ENDED")).toBe("Şarj Bitti, Soket Takılı");
    expect(mapValue(25, "P6_ERR")).toBe("Hata");
  });

  it.each([
    [15, "Kapalı", "Aktif"],
    [38, "Deaktif", "Aktif"],
    [46, "Kapalı", "Açık"],
    [52, "Kapalı", "Açık"],
    [53, "Pasif", "Aktif"],
  ])("id %i — 0/1 ikili eşleme", (id, zero, one) => {
    expect(mapValue(id, "0")).toBe(zero);
    expect(mapValue(id, "1")).toBe(one);
  });

  it("id 16 — hesaplama kaynağı", () => {
    expect(mapValue(16, "0")).toBe("MSP Hesaplama");
    expect(mapValue(16, "1")).toBe("AC Meter");
  });

  it("id 17 ve 69 — üretim/test modu", () => {
    expect(mapValue(17, "0")).toBe("Ürün Modu");
    expect(mapValue(17, "1")).toBe("Test Modu");
    expect(mapValue(69, "0")).toBe("Üretim Modu");
    expect(mapValue(69, "1")).toBe("Test Modu");
  });

  it("id 18 — kablosuz/kablolu", () => {
    expect(mapValue(18, "0")).toBe("Kablosuz");
    expect(mapValue(18, "1")).toBe("Kablolu");
  });

  it("id 19 — OCPP şarj tipi", () => {
    expect(mapValue(19, "0")).toBe("Plug & Charge");
    expect(mapValue(19, "1")).toBe("RFID Charge");
    expect(mapValue(19, "2")).toBe("OCPP Charge");
  });

  it("id 37 — bağlantı türü metinsel değerler", () => {
    expect(mapValue(37, "NONE")).toBe("Bağlı Değil");
    expect(mapValue(37, "GSM")).toBe("GSM");
    expect(mapValue(37, "WiFi")).toBe("WiFi");
    expect(mapValue(37, "ETH")).toBe("Ethernet");
    expect(mapValue(37, "BILINMEYEN")).toBe("BILINMEYEN");
  });

  it("id 45 — bağlı/kopuk", () => {
    expect(mapValue(45, "0")).toBe("Kopuk");
    expect(mapValue(45, "1")).toBe("Bağlı");
  });

  it("id 48 — uyarı bayrağı", () => {
    expect(mapValue(48, "0")).toBe("Yok");
    expect(mapValue(48, "1")).toBe("Var ⚠️");
  });

  it("id 64/65 — logo isimleri", () => {
    expect(mapValue(64, "acrapol_logo")).toBe("Acrapol");
    expect(mapValue(65, "celikler_logo")).toBe("Çelikler");
    expect(mapValue(64, "ctg_logo")).toBe("CTG");
    expect(mapValue(65, "sepas_logo")).toBe("Sepas");
    expect(mapValue(64, "bilinmeyen_logo")).toBe("bilinmeyen_logo");
  });

  it("bilinmeyen id ham değeri string olarak döner", () => {
    expect(mapValue(999, "merhaba")).toBe("merhaba");
    expect(mapValue(999, 42)).toBe("42");
  });
});

describe("csColor", () => {
  it("0/1/2 için renk döner (eski sayısal biçim)", () => {
    expect(csColor("0")).toBe("yellow");
    expect(csColor("1")).toBe("green");
    expect(csColor("2")).toBe("blue");
  });

  it("P1..P6 kodları için doğru renk döner", () => {
    expect(csColor("P4_CHARGING")).toBe("green");
    expect(csColor("P5_CHARGE_ENDED")).toBe("blue");
    expect(csColor("P3_SCAN_RFID")).toBe("yellow");
    expect(csColor("P6_ERR")).toBe("red");
    expect(csColor("P1_IDLE")).toBeUndefined();
    expect(csColor("P2_PLUG_IN")).toBeUndefined();
  });

  it("diğer değerler için undefined döner", () => {
    expect(csColor("3")).toBeUndefined();
    expect(csColor(undefined)).toBeUndefined();
  });
});
