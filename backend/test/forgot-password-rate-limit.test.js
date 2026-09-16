import { describe, it, expect } from "vitest";
import request from "supertest";
import fs from "fs";
import os from "os";
import path from "path";

/* ── Ayrı dosya: FORGOT_PASSWORD_RATE_LIMIT'i düşük tutup limitin gerçekten
   devrede olduğunu doğrular. password-reset.smoke.test.js limiti yüksek
   tutuyor (ard arda gelen testler birbirini limitlemesin diye) — vitest her
   test dosyasını ayrı bir modül kaydıyla çalıştırdığı için iki dosyanın
   process.env ayarları birbirine karışmıyor. */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bluetech-pwreset-ratelimit-"));
process.env.DB_PATH = path.join(tmpDir, "test.db");
process.env.USERS_PATH = path.join(tmpDir, "users.json");
process.env.TARGET_PATH = path.join(tmpDir, "target.json");
process.env.RESPONSES_PATH = path.join(tmpDir, "responses.json");
process.env.PUBLIC_BASE_URL = "http://localhost:5173";
process.env.FORGOT_PASSWORD_RATE_LIMIT = "3";

fs.writeFileSync(process.env.USERS_PATH, JSON.stringify([]));

const app = (await import("../server.js")).default;

describe("POST /api/forgot-password — rate limit", () => {
  it("limit aşılınca 429 döner", async () => {
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      const r = await request(app).post("/api/forgot-password").send({ username: "kimse" });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });
});
