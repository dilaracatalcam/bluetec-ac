import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import bcrypt from "bcrypt";

/* ── Kendi e-postasını tanımlama + e-posta yoksa şifre değiştirememe testleri ── */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bluetech-self-account-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");
process.env.USERS_PATH = path.join(tmpDir, "users.json");
process.env.TARGET_PATH = path.join(tmpDir, "target.json");
process.env.RESPONSES_PATH = path.join(tmpDir, "responses.json");

const PASSWORD = "OriginalPass123!";

fs.writeFileSync(
  process.env.USERS_PATH,
  JSON.stringify([
    {
      username: "noemail_user",
      fullName: "E-postasız",
      passwordHash: bcrypt.hashSync(PASSWORD, 10),
      role: "operator",
      company: "Acropol",
      allowedMacs: [],
      email: null,
    },
  ])
);

const app = (await import("../server.js")).default;

let token;
beforeAll(async () => {
  const r = await request(app).post("/api/login").send({ username: "noemail_user", password: PASSWORD, page: "dashboard" });
  token = r.body.token;
});

describe("GET /api/me — email alanı", () => {
  it("e-postası olmayan kullanıcı için email:null döner", async () => {
    const r = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.email).toBeNull();
  });
});

describe("POST /api/users/:username/password — e-posta yoksa engelleme", () => {
  it("e-postası tanımlı olmayan kullanıcı kendi şifresini değiştiremez (400)", async () => {
    const r = await request(app)
      .post("/api/users/noemail_user/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ oldPassword: PASSWORD, newPassword: "NewPass456!" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/e-posta/i);
  });
});

describe("PUT /api/me/email", () => {
  it("geçersiz e-posta reddedilir", async () => {
    const r = await request(app)
      .put("/api/me/email")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "gecersiz", currentPassword: PASSWORD });
    expect(r.status).toBe(400);
  });

  it("mevcut şifre olmadan reddedilir", async () => {
    const r = await request(app)
      .put("/api/me/email")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "noemail@example.com" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/şifre/i);
  });

  it("yanlış mevcut şifreyle reddedilir (401)", async () => {
    const r = await request(app)
      .put("/api/me/email")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "noemail@example.com", currentPassword: "yanlisSifre123!" });
    expect(r.status).toBe(401);
  });

  it("doğru mevcut şifreyle e-posta kaydedilir ve /api/me'de görünür", async () => {
    const r = await request(app)
      .put("/api/me/email")
      .set("Authorization", `Bearer ${token}`)
      .send({ email: "noemail@example.com", currentPassword: PASSWORD });
    expect(r.status).toBe(200);

    const me = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    expect(me.body.email).toBe("noemail@example.com");
  });

  it("e-posta tanımlandıktan sonra artık kendi şifresini değiştirebilir", async () => {
    const r = await request(app)
      .post("/api/users/noemail_user/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ oldPassword: PASSWORD, newPassword: "NewPass456!" });
    expect(r.status).toBe(200);
  });

  it("tokensiz istek 401 döner", async () => {
    const r = await request(app).put("/api/me/email").send({ email: "x@example.com", currentPassword: PASSWORD });
    expect(r.status).toBe(401);
  });
});

describe("POST /api/users/:username/password — şifre kuralları", () => {
  // Önceki describe bloğu sonunda şifre "NewPass456!" olarak değişti.
  const CURRENT_PASSWORD = "NewPass456!";

  it("büyük harf içermeyen şifre reddedilir", async () => {
    const r = await request(app)
      .post("/api/users/noemail_user/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ oldPassword: CURRENT_PASSWORD, newPassword: "alllower123!" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/büyük harf/i);
  });

  it("özel karakter içermeyen şifre reddedilir", async () => {
    const r = await request(app)
      .post("/api/users/noemail_user/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ oldPassword: CURRENT_PASSWORD, newPassword: "NoSpecialChar123" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/özel karakter/i);
  });

  it("yeni şifre eski şifreyle aynıysa reddedilir", async () => {
    const r = await request(app)
      .post("/api/users/noemail_user/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ oldPassword: CURRENT_PASSWORD, newPassword: CURRENT_PASSWORD });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/aynı olamaz/i);
  });

  it("kurallara uyan farklı bir şifre kabul edilir", async () => {
    const r = await request(app)
      .post("/api/users/noemail_user/password")
      .set("Authorization", `Bearer ${token}`)
      .send({ oldPassword: CURRENT_PASSWORD, newPassword: "AnotherPass789!" });
    expect(r.status).toBe(200);
  });
});
