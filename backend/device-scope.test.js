import { describe, it, expect } from "vitest";
import { buildScope, allowsDevice } from "./device-scope.js";

describe("buildScope", () => {
  it("superadmin her zaman unrestricted", () => {
    expect(buildScope({ company: null, allowedMacs: [] }, "superadmin")).toEqual({
      unrestricted: true,
    });
  });

  it("company/mac tanımsız admin geriye dönük uyumluluk için unrestricted", () => {
    const scope = buildScope({ company: null, allowedMacs: [] }, "admin");
    expect(scope).toEqual({ unrestricted: true });
  });

  it("company/mac tanımsız operator hiçbir cihaz göremez (güvenli varsayılan)", () => {
    const scope = buildScope({ company: null, allowedMacs: [] }, "operator");
    expect(scope.unrestricted).toBe(false);
    expect(scope.company).toBeNull();
    expect(scope.macSet.size).toBe(0);
    expect(scope.undefinedScope).toBe(true);
  });

  it("operator user objesi hiç verilmeden de aynı güvenli varsayılana düşer", () => {
    const scope = buildScope(undefined, "operator");
    expect(scope.undefinedScope).toBe(true);
  });

  it("company tanımlı operator o company'ye kısıtlanır", () => {
    const scope = buildScope({ company: "Acropol", allowedMacs: [] }, "operator");
    expect(scope).toEqual({
      unrestricted: false,
      company: "Acropol",
      macSet: new Set(),
    });
  });

  it("allowedMacs büyük harfe çevrilip Set'e konur", () => {
    const scope = buildScope(
      { company: null, allowedMacs: ["aa:bb:cc:dd:ee:ff", " 11:22:33:44:55:66 "] },
      "operator"
    );
    expect(scope.macSet).toEqual(new Set(["AA:BB:CC:DD:EE:FF", "11:22:33:44:55:66"]));
  });

  it("company ve allowedMacs birlikte tanımlı olabilir", () => {
    const scope = buildScope(
      { company: "CTG", allowedMacs: ["aa:bb:cc:dd:ee:ff"] },
      "operator"
    );
    expect(scope.company).toBe("CTG");
    expect(scope.macSet.has("AA:BB:CC:DD:EE:FF")).toBe(true);
  });
});

describe("allowsDevice", () => {
  it("unrestricted scope her cihaza izin verir", () => {
    expect(allowsDevice({ unrestricted: true }, null)).toBe(true);
    expect(allowsDevice({ unrestricted: true }, { company: "X" })).toBe(true);
  });

  it("device yoksa (kısıtlı scope'ta) false döner", () => {
    const scope = { unrestricted: false, company: "Acropol", macSet: new Set() };
    expect(allowsDevice(scope, null)).toBe(false);
  });

  it("company eşleşmesiyle izin verir", () => {
    const scope = { unrestricted: false, company: "Acropol", macSet: new Set() };
    expect(allowsDevice(scope, { company: "Acropol", mac: "FF:FF:FF:FF:FF:FF" })).toBe(true);
    expect(allowsDevice(scope, { company: "Rotawatt", mac: "FF:FF:FF:FF:FF:FF" })).toBe(false);
  });

  it("macSet eşleşmesiyle company farklı olsa da izin verir", () => {
    const scope = {
      unrestricted: false,
      company: "Acropol",
      macSet: new Set(["AA:BB:CC:DD:EE:FF"]),
    };
    expect(allowsDevice(scope, { company: "BaşkaŞirket", mac: "aa:bb:cc:dd:ee:ff" })).toBe(true);
  });

  it("ne company ne mac eşleşmiyorsa false döner", () => {
    const scope = { unrestricted: false, company: "Acropol", macSet: new Set(["AA:BB:CC:DD:EE:FF"]) };
    expect(allowsDevice(scope, { company: "Rotawatt", mac: "11:22:33:44:55:66" })).toBe(false);
  });

  it("undefinedScope operator hiçbir cihaza izin vermez", () => {
    const scope = buildScope({ company: null, allowedMacs: [] }, "operator");
    expect(allowsDevice(scope, { company: "Acropol", mac: "AA:BB:CC:DD:EE:FF" })).toBe(false);
  });
});
