// ── E2E backend bootstrap ──
// dashboard-api.smoke.test.js ile aynı izolasyon deseni (izole DB/users/
// target/responses), ama Playwright'in gerçek bir tarayıcıdan HTTP ile
// vurabilmesi için gerçekten bir portta dinler. Sabit bir dizin kullanır
// (rastgele değil) ki Playwright test dosyası aynı target.json/responses.json
// yollarını bilip cihaz yanıtlarını simüle edebilsin.
//
// server.js'i kendisi require ediyor (require.main burada e2e-server.js
// olur, server.js DEĞİL) — yani server.js'in kendi app.listen/interval
// bloğu devreye girmez, bu dosya app.listen'i kendisi çağırır.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const bcrypt = require("bcrypt");

const E2E_DIR = path.join(os.tmpdir(), "bluetech-e2e");
fs.rmSync(E2E_DIR, { recursive: true, force: true });
fs.mkdirSync(E2E_DIR, { recursive: true });

process.env.DB_PATH = path.join(E2E_DIR, "test.db");
process.env.USERS_PATH = path.join(E2E_DIR, "users.json");
process.env.TARGET_PATH = path.join(E2E_DIR, "target.json");
process.env.RESPONSES_PATH = path.join(E2E_DIR, "responses.json");
process.env.PUBLIC_BASE_URL = "http://localhost:5183";
process.env.FORGOT_PASSWORD_RATE_LIMIT = "1000";

const E2E_PORT = 8099;
const OPERATOR_USERNAME = "e2e_operator";
const OPERATOR_PASSWORD = "E2eOperatorPass123!";
const DEVICE_MAC = "AA:BB:CC:DD:EE:01";
const DEVICE_COMPANY = "E2E Test A.Ş.";

fs.writeFileSync(
  process.env.USERS_PATH,
  JSON.stringify([
    {
      username: OPERATOR_USERNAME,
      fullName: "E2E Operatör",
      passwordHash: bcrypt.hashSync(OPERATOR_PASSWORD, 10),
      role: "operator",
      company: DEVICE_COMPANY,
      allowedMacs: [],
    },
  ])
);

// Diğer test dosyalarının (fixture bilgileri, MAC vb.) okuyabilmesi için.
fs.writeFileSync(
  path.join(E2E_DIR, "fixture-info.json"),
  JSON.stringify({ E2E_DIR, OPERATOR_USERNAME, OPERATOR_PASSWORD, DEVICE_MAC, DEVICE_COMPANY, E2E_PORT })
);

const { replaceAllDevices } = require("../db.js");
replaceAllDevices([
  {
    device_code: "E2E-DEVICE-1",
    serial_no: "SN-E2E-0001",
    mac: DEVICE_MAC,
    company: DEVICE_COMPANY,
    location: "E2E Test Lokasyonu",
    connection: "GSM",
    logo: "", sw_version: "v1.0", msp_fw: "", hw_version: "",
    note: "", updated_at: null, is_revision: 0,
  },
]);

// "denek.py" (gerçek cihaz köprüsü) çalışıyor gibi görünsün diye — backend
// isPythonRunning() bunu `pgrep -f "denek.py"` ile kontrol ediyor.
const fakeDenek = spawn("python3", [path.join(__dirname, "denek.py")], { stdio: "ignore" });

const app = require("../server.js");
const server = app.listen(E2E_PORT, () => {
  console.log(`[e2e-server] hazır: http://localhost:${E2E_PORT}`);
});

function shutdown() {
  try { fakeDenek.kill(); } catch {}
  server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
