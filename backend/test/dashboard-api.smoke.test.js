import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import bcrypt from "bcrypt";

/* ── Operator dashboard API smoke testleri ──
   Gerçek server.js app'ini (module.exports = app) supertest ile, tamamen izole
   geçici dosyalarla (DB/users/target/responses) çalıştırır. Canlı bluetech.db /
   users.json / target.json / responses.json dosyalarına HİÇ dokunmaz — hepsi
   process.env üzerinden geçici bir dizine yönlendiriliyor, bu env değişkenleri
   server.js/db.js require edilmeden ÖNCE set ediliyor (ikisi de dosya yollarını
   require anında okuyor). */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bluetech-smoke-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");
process.env.USERS_PATH = path.join(tmpDir, "users.json");
process.env.TARGET_PATH = path.join(tmpDir, "target.json");
process.env.RESPONSES_PATH = path.join(tmpDir, "responses.json");

const OPERATOR_PASSWORD = "OperatorPass123!";
const SUPERADMIN_PASSWORD = "SuperPass123!";

fs.writeFileSync(
  process.env.USERS_PATH,
  JSON.stringify([
    {
      username: "op1",
      fullName: "Operatör Bir",
      passwordHash: bcrypt.hashSync(OPERATOR_PASSWORD, 10),
      role: "operator",
      company: "Acropol",
      allowedMacs: [],
    },
    {
      username: "super1",
      fullName: "Süper Admin",
      passwordHash: bcrypt.hashSync(SUPERADMIN_PASSWORD, 10),
      role: "superadmin",
      company: null,
      allowedMacs: [],
    },
  ])
);

function fixtureDevice(overrides) {
  return {
    device_code: "", serial_no: "", mac: "", company: "", location: "",
    connection: "", logo: "", sw_version: "", msp_fw: "", hw_version: "",
    note: "", updated_at: null, is_revision: 0,
    ...overrides,
  };
}

const { replaceAllDevices } = await import("../db.js");
replaceAllDevices([
  fixtureDevice({ device_code: "IN-SCOPE", mac: "AA:AA:AA:AA:AA:01", company: "Acropol" }),
  fixtureDevice({ device_code: "OUT-SCOPE", mac: "BB:BB:BB:BB:BB:02", company: "Rotawatt" }),
]);

const app = (await import("../server.js")).default;

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

let operatorToken;
let superadminToken;
let inScopeDeviceId;
let outScopeDeviceId;

beforeAll(async () => {
  const opLogin = await request(app)
    .post("/api/login")
    .send({ username: "op1", password: OPERATOR_PASSWORD, page: "dashboard" });
  operatorToken = opLogin.body.token;

  const superLogin = await request(app)
    .post("/api/login")
    .send({ username: "super1", password: SUPERADMIN_PASSWORD, page: "admin" });
  superadminToken = superLogin.body.token;

  const devicesRes = await request(app)
    .get("/api/devices")
    .set("Authorization", `Bearer ${superadminToken}`);
  inScopeDeviceId = devicesRes.body.devices.find((d) => d.device_code === "IN-SCOPE").id;
  outScopeDeviceId = devicesRes.body.devices.find((d) => d.device_code === "OUT-SCOPE").id;
});

describe("POST /api/login", () => {
  it("doğru kimlik bilgisiyle token döner", () => {
    expect(operatorToken).toBeTruthy();
    expect(superadminToken).toBeTruthy();
  });

  it("yanlış şifreyle 401 döner", async () => {
    const r = await request(app)
      .post("/api/login")
      .send({ username: "op1", password: "yanlisSifre", page: "dashboard" });
    expect(r.status).toBe(401);
  });

  it("operator page=admin ile giriş yapamaz (403)", async () => {
    const r = await request(app)
      .post("/api/login")
      .send({ username: "op1", password: OPERATOR_PASSWORD, page: "admin" });
    expect(r.status).toBe(403);
  });
});

describe("GET /api/me", () => {
  it("tokensiz istek 401 döner", async () => {
    const r = await request(app).get("/api/me");
    expect(r.status).toBe(401);
  });

  it("geçerli tokenla kullanıcı bilgisi döner", async () => {
    const r = await request(app).get("/api/me").set("Authorization", `Bearer ${operatorToken}`);
    expect(r.status).toBe(200);
    expect(r.body.role).toBe("operator");
    expect(r.body.username).toBe("op1");
  });
});

describe("GET /api/devices — operator scope", () => {
  it("operator sadece kendi company'sindeki cihazları görür, mac alanı yok", async () => {
    const r = await request(app).get("/api/devices").set("Authorization", `Bearer ${operatorToken}`);
    expect(r.status).toBe(200);
    const codes = r.body.devices.map((d) => d.device_code);
    expect(codes).toContain("IN-SCOPE");
    expect(codes).not.toContain("OUT-SCOPE");
    for (const d of r.body.devices) {
      expect(d.mac).toBeUndefined();
    }
  });

  it("superadmin tüm cihazları ve mac alanını görür", async () => {
    const r = await request(app).get("/api/devices").set("Authorization", `Bearer ${superadminToken}`);
    const codes = r.body.devices.map((d) => d.device_code);
    expect(codes).toEqual(expect.arrayContaining(["IN-SCOPE", "OUT-SCOPE"]));
    expect(r.body.devices.find((d) => d.device_code === "IN-SCOPE").mac).toBe("AA:AA:AA:AA:AA:01");
  });
});

describe("GET /api/connections — sadece admin/superadmin", () => {
  it("operator için 403 döner", async () => {
    const r = await request(app).get("/api/connections").set("Authorization", `Bearer ${operatorToken}`);
    expect(r.status).toBe(403);
  });

  it("superadmin için 200 döner", async () => {
    const r = await request(app).get("/api/connections").set("Authorization", `Bearer ${superadminToken}`);
    expect(r.status).toBe(200);
  });
});

describe("Genel yetkisiz erişim", () => {
  it("korumalı bir route'a tokensiz istek 401 döner", async () => {
    const r = await request(app).get("/api/get-status");
    expect(r.status).toBe(401);
  });
});

describe("POST /api/update-target + POST /api/send-command — operator kapsam zinciri", () => {
  it("operator deviceId olmadan çıplak mac ile bağlanamaz (400)", async () => {
    const r = await request(app)
      .post("/api/update-target")
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ newTarget: "AA:AA:AA:AA:AA:01" });
    expect(r.status).toBe(400);
  });

  it("operator scope dışı bir deviceId'ye bağlanamaz (403)", async () => {
    const r = await request(app)
      .post("/api/update-target")
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ deviceId: outScopeDeviceId });
    expect(r.status).toBe(403);
  });

  it("operator scope içi deviceId'ye bağlanabilir (200)", async () => {
    const r = await request(app)
      .post("/api/update-target")
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ deviceId: inScopeDeviceId });
    expect(r.status).toBe(200);
  });

  it("bağlı (scope içi) cihaza komut gönderilebilir (200)", async () => {
    const r = await request(app)
      .post("/api/send-command")
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ type: "read", variable: 20 });
    expect(r.status).toBe(200);
  });

  it("slot'un hedefi scope dışına çıkarsa (ör. sonradan yetki değişirse) komut reddedilir (403)", async () => {
    // Gerçek dünyada bu durum normal API akışıyla oluşmaz (update-target zaten
    // scope dışı bağlantıyı engelliyor) — burada allowsMac savunmasının
    // gerçekten devrede olduğunu doğrulamak için target.json'daki slot'u
    // doğrudan (dosya üzerinden) scope dışı bir hedefe taşıyoruz.
    const targetData = JSON.parse(fs.readFileSync(process.env.TARGET_PATH, "utf-8"));
    const slot = targetData.requests.find((r) => r.session_id === "op1");
    expect(slot).toBeTruthy();
    slot.target = "BB:BB:BB:BB:BB:02";
    fs.writeFileSync(process.env.TARGET_PATH, JSON.stringify(targetData));

    const r = await request(app)
      .post("/api/send-command")
      .set("Authorization", `Bearer ${operatorToken}`)
      .send({ type: "read", variable: 20 });
    expect(r.status).toBe(403);
  });
});
