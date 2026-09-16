import { describe, it, expect } from "vitest";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import bcrypt from "bcrypt";

/* ── Şifre sıfırlama (forgot/reset-password) smoke testleri ──
   dashboard-api.smoke.test.js ile aynı izolasyon deseni: gerçek server.js
   app'i, tamamen geçici DB/users/target/responses dosyalarıyla. Test
   ortamında SMTP yapılandırılmadığı için gerçek e-posta gönderimi başarısız
   olur (route bunu yakalayıp yine de jenerik yanıt döner — production'daki
   gerçek davranış budur). Token'a, e-posta içeriğini mock'lamak yerine
   server.js'in sadece process.env.VITEST altında eklediği app._testHooks
   üzerinden erişiyoruz — CJS require() + vi.mock etkileşimiyle uğraşmadan
   güvenilir bir yol. */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bluetech-pwreset-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");
process.env.USERS_PATH = path.join(tmpDir, "users.json");
process.env.TARGET_PATH = path.join(tmpDir, "target.json");
process.env.RESPONSES_PATH = path.join(tmpDir, "responses.json");
process.env.PUBLIC_BASE_URL = "http://localhost:5173";
process.env.FORGOT_PASSWORD_RATE_LIMIT = "1000";

const USER_PASSWORD = "OldPassword123!";

fs.writeFileSync(
  process.env.USERS_PATH,
  JSON.stringify([
    {
      username: "withmail",
      fullName: "E-postalı Kullanıcı",
      passwordHash: bcrypt.hashSync(USER_PASSWORD, 10),
      role: "operator",
      company: "Acropol",
      allowedMacs: [],
      email: "withmail@example.com",
    },
    {
      username: "nomail",
      fullName: "E-postasız Kullanıcı",
      passwordHash: bcrypt.hashSync(USER_PASSWORD, 10),
      role: "operator",
      company: "Acropol",
      allowedMacs: [],
      email: null,
    },
  ])
);

const app = (await import("../server.js")).default;
const tokenStore = app._testHooks.passwordResetTokens;

function latestTokenFor(username) {
  const entries = Object.entries(tokenStore).filter(([, v]) => v.username === username);
  if (entries.length === 0) return null;
  return entries.sort((a, b) => b[1].expiresAt - a[1].expiresAt)[0][0];
}

describe("POST /api/forgot-password", () => {
  it("var olan + e-postalı kullanıcı için token üretir, jenerik mesaj döner", async () => {
    const before = Object.keys(tokenStore).length;
    const r = await request(app).post("/api/forgot-password").send({ username: "withmail" });
    expect(r.status).toBe(200);
    expect(r.body.message).toMatch(/gönderildi/);
    expect(Object.keys(tokenStore).length).toBe(before + 1);
    expect(latestTokenFor("withmail")).toBeTruthy();
  });

  it("olmayan kullanıcı adı için aynı jenerik mesajı döner, token üretilmez", async () => {
    const before = Object.keys(tokenStore).length;
    const r = await request(app).post("/api/forgot-password").send({ username: "boyle-biri-yok" });
    expect(r.status).toBe(200);
    expect(r.body.message).toMatch(/gönderildi/);
    expect(Object.keys(tokenStore).length).toBe(before);
  });

  it("e-postası olmayan kullanıcı için aynı jenerik mesajı döner, token üretilmez", async () => {
    const before = Object.keys(tokenStore).length;
    const r = await request(app).post("/api/forgot-password").send({ username: "nomail" });
    expect(r.status).toBe(200);
    expect(r.body.message).toMatch(/gönderildi/);
    expect(Object.keys(tokenStore).length).toBe(before);
  });

  it("username eksikse 400 döner", async () => {
    const r = await request(app).post("/api/forgot-password").send({});
    expect(r.status).toBe(400);
  });
});

describe("POST /api/reset-password", () => {
  let currentPassword = USER_PASSWORD;

  async function requestResetToken(username) {
    await request(app).post("/api/forgot-password").send({ username });
    return latestTokenFor(username);
  }

  it("geçerli token ile şifre değiştirilir ve yeni şifreyle giriş yapılabilir", async () => {
    const token = await requestResetToken("withmail");
    expect(token).toBeTruthy();
    const newPassword = "BrandNewPass456!";

    const r = await request(app).post("/api/reset-password").send({ token, newPassword });
    expect(r.status).toBe(200);

    const loginOld = await request(app)
      .post("/api/login")
      .send({ username: "withmail", password: currentPassword, page: "dashboard" });
    expect(loginOld.status).toBe(401);

    const loginNew = await request(app)
      .post("/api/login")
      .send({ username: "withmail", password: newPassword, page: "dashboard" });
    expect(loginNew.status).toBe(200);

    currentPassword = newPassword;
  });

  it("aynı token ikinci kez kullanılamaz (tek kullanımlık)", async () => {
    const token = await requestResetToken("withmail");
    const r1 = await request(app).post("/api/reset-password").send({ token, newPassword: "SecondRound789!" });
    expect(r1.status).toBe(200);
    currentPassword = "SecondRound789!";

    const r2 = await request(app).post("/api/reset-password").send({ token, newPassword: "ThirdRound000!" });
    expect(r2.status).toBe(400);
  });

  it("geçersiz/uydurma token 400 döner", async () => {
    const r = await request(app)
      .post("/api/reset-password")
      .send({ token: "not-a-real-token", newPassword: "Whatever123!" });
    expect(r.status).toBe(400);
  });

  it("kısa şifre reddedilir", async () => {
    const token = await requestResetToken("withmail");
    const r = await request(app).post("/api/reset-password").send({ token, newPassword: "abc" });
    expect(r.status).toBe(400);
  });

  it("şifre sıfırlanınca kullanıcının önceki aktif oturumları iptal olur", async () => {
    const login = await request(app)
      .post("/api/login")
      .send({ username: "withmail", password: currentPassword, page: "dashboard" });
    expect(login.status).toBe(200);
    const oldToken = login.body.token;

    const meBefore = await request(app).get("/api/me").set("Authorization", `Bearer ${oldToken}`);
    expect(meBefore.status).toBe(200);

    const resetToken = await requestResetToken("withmail");
    const r = await request(app).post("/api/reset-password").send({ token: resetToken, newPassword: "SessionKillTest111!" });
    expect(r.status).toBe(200);
    currentPassword = "SessionKillTest111!";

    const meAfter = await request(app).get("/api/me").set("Authorization", `Bearer ${oldToken}`);
    expect(meAfter.status).toBe(401);
  });
});
