import { describe, it, expect, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// Bu test dosyası device-scope.js'in DB'ye bağımlı fonksiyonlarını
// (allowsMac, visibleDevices) izole, geçici bir SQLite dosyasına karşı test eder.
// process.env.DB_PATH, db.js require edilmeden ÖNCE set edilmeli (db.js DB yolunu
// require anında okuyor) — bu yüzden dinamik import kullanılıyor.
const tmpDb = path.join(os.tmpdir(), `bluetech-test-device-scope-${Date.now()}-${process.pid}.db`);
process.env.DB_PATH = tmpDb;

const { replaceAllDevices } = await import("./db.js");
const { buildScope, allowsMac, visibleDevices } = await import("./device-scope.js");

function fixtureDevice(overrides) {
  return {
    device_code: "", serial_no: "", mac: "", company: "", location: "",
    connection: "", logo: "", sw_version: "", msp_fw: "", hw_version: "",
    note: "", updated_at: null, is_revision: 0,
    ...overrides,
  };
}

replaceAllDevices([
  fixtureDevice({ device_code: "D1", mac: "AA:BB:CC:DD:EE:01", company: "Acropol" }),
  fixtureDevice({ device_code: "D2", mac: "AA:BB:CC:DD:EE:02", company: "Rotawatt" }),
]);

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(tmpDb + suffix, { force: true });
  }
});

describe("allowsMac (gerçek izole DB'ye karşı)", () => {
  it("macSet içindeki mac'e doğrudan izin verir", () => {
    const scope = buildScope({ company: null, allowedMacs: ["AA:BB:CC:DD:EE:01"] }, "operator");
    expect(allowsMac(scope, "aa:bb:cc:dd:ee:01")).toBe(true);
  });

  it("company scope'u DB'den cihazın company'sini çözerek izin verir", () => {
    const scope = buildScope({ company: "Acropol", allowedMacs: [] }, "operator");
    expect(allowsMac(scope, "AA:BB:CC:DD:EE:01")).toBe(true);
    expect(allowsMac(scope, "AA:BB:CC:DD:EE:02")).toBe(false);
  });

  it("scope dışı mac reddedilir", () => {
    const scope = buildScope({ company: null, allowedMacs: [] }, "operator");
    expect(allowsMac(scope, "AA:BB:CC:DD:EE:01")).toBe(false);
  });

  it("unrestricted scope her mac'e izin verir", () => {
    expect(allowsMac({ unrestricted: true }, "HERHANGİ:BİR:MAC")).toBe(true);
  });
});

describe("visibleDevices (gerçek izole DB'ye karşı)", () => {
  it("company scope'una göre filtreler", () => {
    const scope = buildScope({ company: "Acropol", allowedMacs: [] }, "operator");
    expect(visibleDevices(scope).map((d) => d.device_code)).toEqual(["D1"]);
  });

  it("unrestricted scope tüm cihazları döner", () => {
    expect(visibleDevices({ unrestricted: true }).length).toBe(2);
  });

  it("undefinedScope operator hiçbir cihaz görmez", () => {
    const scope = buildScope({ company: null, allowedMacs: [] }, "operator");
    expect(visibleDevices(scope)).toEqual([]);
  });
});
