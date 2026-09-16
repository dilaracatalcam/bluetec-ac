import { test, expect } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";

/* ── Operator dashboard e2e — kritik akış ──
   Gerçek tarayıcı + gerçek (ama izole) backend (backend/test/e2e-server.js,
   bkz. playwright.config.js webServer). Gerçek cihaz/MQTT köprüsü olmadığı
   için donanım tarafı, backend'in responses.json dosyasına doğrudan yazarak
   simüle ediliyor — sabit yollar backend/test/e2e-server.js ile birebir
   aynı olmalı (E2E_DIR, kullanıcı adı/şifre, cihaz konumu). */

const E2E_DIR = path.join(os.tmpdir(), "bluetech-e2e");
const RESPONSES_PATH = path.join(E2E_DIR, "responses.json");
const TARGET_PATH = path.join(E2E_DIR, "target.json");

const OPERATOR_USERNAME = "e2e_operator";
const OPERATOR_PASSWORD = "E2eOperatorPass123!";
const DEVICE_CODE = "E2E-DEVICE-1"; // header'daki hızlı-bağlan <select>'in option metniyle karışmasın diye device_code ile hedefleniyor
const ESP_RESET_VAR_ID = 20;

function readResponses() {
  try {
    return JSON.parse(fs.readFileSync(RESPONSES_PATH, "utf-8"));
  } catch {
    return { responses: {} };
  }
}

function writeResponses(data) {
  fs.writeFileSync(RESPONSES_PATH, JSON.stringify(data));
}

function simulateDeviceStatus(statusText) {
  const data = readResponses();
  if (!data.responses[OPERATOR_USERNAME]) data.responses[OPERATOR_USERNAME] = {};
  data.responses[OPERATOR_USERNAME].status_response = {
    topic: "status", data: statusText, time: new Date().toISOString(),
  };
  writeResponses(data);
}

function simulateDeviceAck(msgId, ackText) {
  const data = readResponses();
  if (!data.responses[OPERATOR_USERNAME]) data.responses[OPERATOR_USERNAME] = {};
  data.responses[OPERATOR_USERNAME].message_response = {
    cmd: 2, msg: msgId, data: ackText, time: new Date().toISOString(),
  };
  writeResponses(data);
}

test.describe("Operator dashboard — kritik akış", () => {
  test("login → dashboard → cihaz seç & bağlan → ESP Reset komutu", async ({ page }) => {
    await page.goto("/");

    // ── Login ──
    await page.getByPlaceholder("kullanici.adi").fill(OPERATOR_USERNAME);
    await page.getByPlaceholder("••••••••").fill(OPERATOR_PASSWORD);
    await page.getByRole("button", { name: "Giriş Yap" }).click();

    // ── Dashboard yüklendi (varsayılan sekme: Cihaz Seç), admin-only bölüm görünmüyor ──
    await expect(page.getByRole("heading", { name: "Cihaz Seç" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Kullanıcı Yönetimi")).toHaveCount(0);

    // ── Cihaz seç & bağlan (device-select varsayılan aktif sekme) ──
    await page.getByText(DEVICE_CODE).click();
    await page.getByRole("button", { name: "Seç & Bağlan" }).click();

    // Bağlantı sonrası OCPP & WiFi'ye yönlendirilir, cihaz henüz yanıt vermediği için "Bekleniyor…"
    await expect(page.getByText("Bekleniyor…")).toBeVisible({ timeout: 10_000 });

    // ── Cihazdan "ESP aktif" durumunu simüle et (gerçek donanım yok) ──
    simulateDeviceStatus("ESP aktif");
    await expect(page.getByText("Çevrimiçi")).toBeVisible({ timeout: 10_000 });

    // ── ESP Reset komutu gönder, cihazın "SET OK" yanıtını önceden simüle et ──
    // Not: bu buton (header hızlı-aksiyon) tıklanınca metni "…"ya dönüşüyor, bu yüzden
    // accessible name'e göre değil title'a göre hedefleniyor (buton başlığı sabit kalıyor).
    simulateDeviceAck(ESP_RESET_VAR_ID, "SET OK");
    const espResetButton = page.locator('button[title="ESP\'yi resetle"]');
    await espResetButton.click();

    // Gerçek komutun backend'e ulaşıp doğru frame'i yazdığını doğrula — send_message
    // 1.5sn sonra otomatik temizlendiği için hemen (poll ile) kontrol ediyoruz.
    await expect.poll(() => {
      try {
        const targetData = JSON.parse(fs.readFileSync(TARGET_PATH, "utf-8"));
        const slot = targetData.requests.find((r) => r.session_id === OPERATOR_USERNAME);
        return slot?.send_message || "";
      } catch {
        return "";
      }
    }, { timeout: 3_000 }).toContain("frame 1 20 1");

    // Frontend'in cihazdan (simüle) yanıtı bekleyip butonun tekrar tıklanabilir hale
    // döndüğünü doğrula — SET OK ack'i az önce simüle edildiği için takılı kalmamalı.
    await expect(espResetButton).toBeEnabled({ timeout: 5_000 });
  });

  test("sol menüde bölüm geçişleri tarayıcı geri/ileri ile gezilebiliyor", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("kullanici.adi").fill(OPERATOR_USERNAME);
    await page.getByPlaceholder("••••••••").fill(OPERATOR_PASSWORD);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await expect(page.getByRole("heading", { name: "Cihaz Seç" })).toBeVisible({ timeout: 10_000 });

    await page.getByRole("button", { name: "MSP Konfigürasyon" }).click();
    await expect(page.getByRole("heading", { name: "MSP Konfigürasyon" })).toBeVisible();
    expect(page.url()).toContain("#msp-config");

    await page.getByRole("button", { name: "ESP Kontrol" }).click();
    await expect(page.getByRole("heading", { name: "ESP Kontrol" })).toBeVisible();
    expect(page.url()).toContain("#esp-ctrl");

    // Tarayıcı geri tuşu — önceki bölüme (MSP Konfigürasyon) dönmeli
    await page.goBack();
    await expect(page.getByRole("heading", { name: "MSP Konfigürasyon" })).toBeVisible();

    // İleri tuşu — tekrar ESP Kontrol'e gitmeli
    await page.goForward();
    await expect(page.getByRole("heading", { name: "ESP Kontrol" })).toBeVisible();
  });

  test("Canlı Telemetri sekmesinde değerler tıklamadan otomatik okunuyor", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("kullanici.adi").fill(OPERATOR_USERNAME);
    await page.getByPlaceholder("••••••••").fill(OPERATOR_PASSWORD);
    await page.getByRole("button", { name: "Giriş Yap" }).click();
    await expect(page.getByRole("heading", { name: "Cihaz Seç" })).toBeVisible({ timeout: 10_000 });

    await page.getByText(DEVICE_CODE).click();
    await page.getByRole("button", { name: "Seç & Bağlan" }).click();
    await expect(page.getByText("Bekleniyor…")).toBeVisible({ timeout: 10_000 });

    simulateDeviceStatus("ESP aktif");
    await expect(page.getByText("Çevrimiçi")).toBeVisible({ timeout: 10_000 });

    // Telemetri sekmesine geçmeden ÖNCE cihaz yanıtını simüle et — sekme açılır
    // açılmaz otomatik okuma hemen başlıyor, race olmasın diye önceden yazıyoruz.
    simulateDeviceAck(22, "42"); // id 22 = Şarj Süresi

    await page.getByRole("button", { name: "Canlı Telemetri" }).click();
    await expect(page.getByRole("heading", { name: "Canlı Telemetri" })).toBeVisible();

    // Hiçbir "Oku" / "Tümünü Oku" butonuna dokunulmadan değer görünmeli —
    // bu, otomatik (arka plan) okumanın gerçekten çalıştığının kanıtı.
    await expect(page.getByText("42", { exact: true })).toBeVisible({ timeout: 8_000 });
  });
});
