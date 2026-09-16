import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";
import bcrypt from "bcrypt";

/* ── Kendi kullanıcı adını değiştirme testleri ──
   Kullanıcı adı, activeSessions/target.json/responses.json/slotMeta'nın
   anahtarı olduğu için değişince eski oturumların gerçekten iptal olduğu
   ve yeni kullanıcı adıyla giriş yapılabildiği doğrulanıyor. */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bluetech-username-change-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");
process.env.USERS_PATH = path.join(tmpDir, "users.json");
process.env.TARGET_PATH = path.join(tmpDir, "target.json");
process.env.RESPONSES_PATH = path.join(tmpDir, "responses.json");

const PASSWORD = "OriginalPass123!";

fs.writeFileSync(
  process.env.USERS_PATH,
  JSON.stringify([
    {
      username: "old_username",
      fullName: "Değişecek Kullanıcı",
      passwordHash: bcrypt.hashSync(PASSWORD, 10),
      role: "operator",
      company: "Acropol",
      allowedMacs: [],
      email: "old@example.com",
    },
    {
      username: "already_taken",
      fullName: "Diğer Kullanıcı",
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
  const r = await request(app).post("/api/login").send({ username: "old_username", password: PASSWORD, page: "dashboard" });
  token = r.body.token;
});

describe("PUT /api/me/username", () => {
  it("tokensiz istek 401 döner", async () => {
    const r = await request(app).put("/api/me/username").send({ newUsername: "x" });
    expect(r.status).toBe(401);
  });

  it("geçersiz formatta kullanıcı adı reddedilir", async () => {
    const r = await request(app).put("/api/me/username").set("Authorization", `Bearer ${token}`).send({ newUsername: "a" });
    expect(r.status).toBe(400);
  });

  it("mevcut şifre olmadan reddedilir", async () => {
    const r = await request(app).put("/api/me/username").set("Authorization", `Bearer ${token}`).send({ newUsername: "new_username" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/şifre/i);
  });

  it("yanlış mevcut şifreyle reddedilir (401)", async () => {
    const r = await request(app)
      .put("/api/me/username")
      .set("Authorization", `Bearer ${token}`)
      .send({ newUsername: "new_username", currentPassword: "yanlisSifre123!" });
    expect(r.status).toBe(401);
  });

  it("zaten kullanılan bir kullanıcı adına değiştirilemez (409)", async () => {
    const r = await request(app)
      .put("/api/me/username")
      .set("Authorization", `Bearer ${token}`)
      .send({ newUsername: "already_taken", currentPassword: PASSWORD });
    expect(r.status).toBe(409);
  });

  it("geçerli yeni kullanıcı adı ve doğru şifreyle değişir, eski token geçersiz olur, yeni kullanıcı adıyla giriş yapılabilir", async () => {
    const r = await request(app)
      .put("/api/me/username")
      .set("Authorization", `Bearer ${token}`)
      .send({ newUsername: "new_username", currentPassword: PASSWORD });
    expect(r.status).toBe(200);
    expect(r.body.username).toBe("new_username");

    // Eski token artık geçersiz
    const meOld = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    expect(meOld.status).toBe(401);

    // Eski kullanıcı adıyla giriş yapılamaz
    const loginOld = await request(app).post("/api/login").send({ username: "old_username", password: PASSWORD, page: "dashboard" });
    expect(loginOld.status).toBe(401);

    // Yeni kullanıcı adıyla giriş yapılabilir
    const loginNew = await request(app).post("/api/login").send({ username: "new_username", password: PASSWORD, page: "dashboard" });
    expect(loginNew.status).toBe(200);
  });
});
