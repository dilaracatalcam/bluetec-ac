/* ═══════════════════════════════════════════════════════════════
   OTA Sunucu Log Tailer
   /root/bluetech/logs/ota_server.log dosyasini DOGRUDAN yerel olarak okur.

   ── BU SURUMDE DUZELTILEN KRITIK HATALAR ──
   1. TIMEZONE: Log dosyasini yazan 85.105.100.7 Turkiye saatiyle (UTC+3)
      yaziyor, panel sunucusu ise UTC. Log satirinda saat dilimi bilgisi
      olmadigi icin new Date("2026-08-03T09:54:24.687") ifadesi Node'un
      LOKAL saatini varsayiyordu -> her timestamp 3 saat ileri cikiyordu.
      Sonuc: "since" filtresi hic calismiyordu (gecmisteki bir update_written
      simdiki denemenin cevabi saniliyordu) ve Date.now()-lastProgressAt
      negatif ciktigi icin checkAlreadyActive her cihaza "zaten aktif"
      diyordu. Artik offset EXPLICIT veriliyor (OTA_LOG_TZ_OFFSET).

   2. ESP/MSP AYRIMI: MSP guncellemesi loglarda tamamen farkli goruntuluyor:
        dosya : msp_hw31.txt   (ESP: fw_hw13_v407.bin)
        rapor : MSP REPORT     (ESP: OTA REPORT)
        surum : msp@2.1        (ESP: v@4.0.7)
      Eski parser sadece fw_*.bin ve "OTA REPORT" tanidigi icin MSP
      guncellemeleri KOR noktaydi. Artik her satirin "kind" degeri
      cikariliyor ve istenen tipe ait olmayan satirlar yok sayiliyor.

   3. status=written YANILTMASI: Bu status OTA ile ilgili DEGIL, logo
      yukleme raporu (path=/logo_report). Firmware statusu sanilmamali.

   4. update_written BASARI DEGIL: Loglar gosteriyor ki cihaz
      update_written dedikten sonra hala eski surumle aciliyor
      (09:57 update_written -> 10:15 manifest current=v@4.0.6).
      Gercek basari, cihazin reboot sonrasi YENI surumle check-in
      yapmasidir. Bu yuzden yazma sonrasi surum takibi eklendi.

   Her pollingde dosyanin sadece yeni eklenen kismi okunur.
   ═══════════════════════════════════════════════════════════════ */

const fs = require("fs");

const MAX_BUFFERED_LINES = 4000;    // dogrulama icin yazma sonrasi satirlar da lazim
const SEED_BYTES = 262144;          // ilk okumada dosyanin son ~256KB'i

// Log dosyasini yazan sunucunun saat dilimi. Panel UTC'de calissa bile
// dogru epoch elde edilir. Log sunucusu UTC'ye gecerse "+00:00" yapin.
const LOG_TZ_OFFSET = process.env.OTA_LOG_TZ_OFFSET || "+03:00";

let lastSize = 0;
let lineBuffer = [];
let partialLine = "";
let seeded = false;
let refreshInFlight = null;
let skewWarned = false;

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

function appendChunk(text) {
  const combined = partialLine + text;
  const parts = combined.split("\n");
  partialLine = parts.pop() || "";
  const newLines = parts.filter((l) => l.length > 0);
  if (newLines.length) {
    lineBuffer.push(...newLines);
    if (lineBuffer.length > MAX_BUFFERED_LINES) {
      lineBuffer = lineBuffer.slice(lineBuffer.length - MAX_BUFFERED_LINES);
    }
  }
}

function resetState() {
  seeded = false;
  lineBuffer = [];
  partialLine = "";
  lastSize = 0;
}

async function doRefresh(logPath) {
  const stat = await fs.promises.stat(logPath);
  const currentSize = stat.size;

  if (currentSize < lastSize) {
    resetState(); // logrotate vb. — bastan seed et
  }

  if (!seeded) {
    if (currentSize > 0) {
      const start = Math.max(0, currentSize - SEED_BYTES);
      const stream = fs.createReadStream(logPath, { start, end: currentSize - 1 });
      const buf = await streamToBuffer(stream);
      appendChunk(buf.toString("utf-8"));
    }
    lastSize = currentSize;
    seeded = true;
  } else if (currentSize > lastSize) {
    const stream = fs.createReadStream(logPath, { start: lastSize, end: currentSize - 1 });
    const buf = await streamToBuffer(stream);
    appendChunk(buf.toString("utf-8"));
    lastSize = currentSize;
  }
}

/* Ayni anda gelen iki istek buffer'i bozmasin — tek ucus. */
async function refreshBuffer({ logPath }) {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = doRefresh(logPath).finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

/* ═══════════════════════════════════════════════════════════════
   Satir ayristirma
   ═══════════════════════════════════════════════════════════════ */

function parseTimestamp(line) {
  const m = line.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}),(\d{3})/);
  if (!m) return null;
  const ts = Date.parse(`${m[1]}T${m[2]}.${m[3]}${LOG_TZ_OFFSET}`);
  return Number.isNaN(ts) ? null : ts;
}

function extractMac(line) {
  const m = line.match(/\bid=([0-9A-Fa-f:]{17})\b/);
  return m ? m[1] : null;
}

function extractSid(line) {
  const m = line.match(/\bsid=([0-9a-f]{6,})\b/);
  return m ? m[1] : null;
}

/* Surum onekinden tip: msp@2.1 -> msp, v@4.0.7 -> esp */
function kindFromVersion(v) {
  if (!v) return null;
  return /^msp@/i.test(v) ? "msp" : "esp";
}

/* Dosya adindan tip: msp_hw31.txt -> msp, fw_hw13_v407.bin -> esp */
function kindFromFile(f) {
  return /^msp/i.test(f) ? "msp" : "esp";
}

/* Ham status -> anlam. Bilinmeyen status "unknown" doner, ASLA otomatik
   basarisiz sayilmaz (yeni bir firmware surumu yeni status ekleyebilir). */
const STATUS_MAP = {
  // ESP
  update_written:      { kind: "esp", result: "written"   },
  no_new_firmware:     { kind: "esp", result: "no_update" },
  // MSP
  msp_write_success:   { kind: "msp", result: "success"   },
  msp_write_failed:    { kind: "msp", result: "failed"    },
  msp_download_failed: { kind: "msp", result: "failed"    },
  msp_no_new_firmware: { kind: "msp", result: "no_update" },
  // NOT: "written" BURAYA GIRMEZ — o logo yukleme raporudur (path=/logo_report)
};

function parseOtaLine(line) {
  // Logo trafigini tamamen dislada — status=written buradan geliyor
  if (/path=\/logo_report/.test(line) || /path=\/logos\//.test(line)) return null;

  const mac = extractMac(line);
  if (!mac) return null;
  const ts = parseTimestamp(line);
  const sid = extractSid(line);

  let m;

  // Indirme ilerlemesi — hem fw_*.bin hem msp_*.txt
  m = line.match(/(\S+\.(?:bin|txt|hex))\s+(\d+)%\s*\|\s*(\d+)\/(\d+)/);
  if (m) return { mac, ts, sid, kind: kindFromFile(m[1]), type: "progress", percent: Number(m[2]), file: m[1] };

  m = line.match(/(\S+\.(?:bin|txt|hex))\s+tamam\s*\|\s*(\d+)\/(\d+)/);
  if (m) return { mac, ts, sid, kind: kindFromFile(m[1]), type: "progress", percent: 100, file: m[1] };

  m = line.match(/(\S+\.(?:bin|txt|hex))\s+basladi/);
  if (m) return { mac, ts, sid, kind: kindFromFile(m[1]), type: "started", file: m[1] };

  // Rapor — "OTA REPORT" (ESP) veya "MSP REPORT" (MSP)
  m = line.match(/\b(OTA|MSP) REPORT\s*\|\s*status=(\S+)(?:\s*\|\s*current=(\S*))?(?:\s*\|\s*latest=(\S*))?/);
  if (m) {
    const status = m[2];
    const mapped = STATUS_MAP[status];
    return {
      mac, ts, sid,
      kind: mapped ? mapped.kind : (m[1] === "MSP" ? "msp" : "esp"),
      type: "report",
      status,
      result: mapped ? mapped.result : "unknown",
      current: m[3] || null,
      latest: m[4] || null,
    };
  }

  /* Rapor (ERKEN BICIM) — path=/ota_report veya /msp_report
     ORNEK: path=/ota_report | id=30:ED:A0:2F:CD:C8 | ver= | sid=... | status=update_written

     Bu satir, cihaz raporu gonderir gondermez KOSULSUZ yaziliyor. Yukaridaki
     "OTA REPORT | ... | current= | latest=" satiri ise sunucunun ek
     kontrollerinden (report ip / session ip eslesmesi) sonra yaziliyor ve
     cihaz farkli bir agdan baglandiginda HIC YAZILMAYABILIYOR. Gercek bir
     turda goruldu: indirme 176.54.11.117 uzerinden geldi, path=/ota_report
     yazildi ama OTA REPORT satiri gelmedi -> panel sonsuza kadar
     "indiriliyor" dedi. Bu yuzden erken bicim de kabul ediliyor.

     Surum bilgisi (current/latest) tasimaz; onlar varsa manifest/check-in
     satirlarindan gelir. */
  m = line.match(/path=\/(?:ota|msp)_report\b[^\n]*?\bstatus=([A-Za-z_]+)/);
  if (m) {
    const status = m[1];
    const mapped = STATUS_MAP[status];
    return {
      mac, ts, sid,
      kind: mapped ? mapped.kind : (/^msp/i.test(status) ? "msp" : "esp"),
      type: "report",
      status,
      result: mapped ? mapped.result : "unknown",
      current: null,
      latest: null,
    };
  }

  // Manifest — cihaz sunucuya "bende su surum var" diyor
  m = line.match(/manifest sid=(\S+)\s*\|\s*hw=(\S+)\s*\|\s*available=(True|False)\s*\|\s*current=(\S*)\s*\|\s*latest=(\S*)/);
  if (m) {
    const current = m[4] || null;
    const latest = m[5] || null;
    return {
      mac, ts, sid: m[1],
      kind: kindFromVersion(current) || kindFromVersion(latest),
      type: "manifest",
      hw: m[2],
      available: m[3] === "True",
      current, latest,
    };
  }

  // Check-in — cihaz firmware.json cekiyor, uzerindeki surumu bildiriyor
  m = line.match(/path=\/firmware\.json\b[^\n]*?\bver=([^\s|]*)/);
  if (m) {
    const ver = m[1] || null;
    return { mac, ts, sid, kind: kindFromVersion(ver), type: "checkin", current: ver };
  }

  return null;
}

/* ═══════════════════════════════════════════════════════════════
   MAC bazli durum cikarimi

   macEntries : [{ mac, since }]   since = epoch ms (o cihazi ilk
                                   tetikledigimiz an; oncesi yok sayilir)
   kind       : "esp" | "msp"      sadece bu tipe ait satirlar sayilir
   ═══════════════════════════════════════════════════════════════ */
async function getMacUpdateStatus({ logPath, macEntries, kind = "esp" }) {
  await refreshBuffer({ logPath });

  const sinceByMac = {};
  const originalByMac = {};
  macEntries.forEach((e) => {
    const up = e.mac.toUpperCase();
    sinceByMac[up] = e.since || 0;
    originalByMac[up] = e.mac; // ilk yazim kazanir, coklu eslesme belirsizligi yok
  });

  const result = {};
  macEntries.forEach((e) => {
    result[e.mac] = {
      kind,
      hasStarted: false,
      percent: null,
      lastProgressAt: null,
      lastSid: null,

      // Rapor
      lastResult: null,        // written | success | failed | no_update | unknown
      lastStatus: null,        // ham status metni
      lastResultAt: null,
      versionAtReport: null,   // rapor anindaki current (= yazmadan onceki surum)
      targetVersion: null,     // rapor/manifest'teki latest

      // Cihazin canli oldugunu gosteren aktivite (manifest / check-in)
      lastActivityAt: null,
      currentVersion: null,
      latestVersion: null,
      updateAvailable: null,

      // Yazma SONRASI ilk surum bildirimi — gercek dogrulama buradan
      postWriteVersion: null,
      postWriteAt: null,

      clockSkew: false,
    };
  });

  const now = Date.now();

  for (const line of lineBuffer) {
    const parsed = parseOtaLine(line);
    if (!parsed) continue;

    const up = parsed.mac.toUpperCase();
    const original = originalByMac[up];
    if (!original) continue;

    // Bu satir istenen tipe ait degilse yok say (ESP izlerken MSP raporu
    // gormek, ya da tersi, tamamen yanlis karara yol acar)
    if (parsed.kind && parsed.kind !== kind) continue;

    // Tetiklemeden onceki satirlar ilgisiz
    const since = sinceByMac[up];
    if (parsed.ts !== null && since && parsed.ts < since) continue;

    const entry = result[original];

    // Saat kaymasi tespiti — log gelecekten geliyorsa TZ ayari yanlis
    if (parsed.ts !== null && parsed.ts > now + 5 * 60 * 1000) {
      entry.clockSkew = true;
      if (!skewWarned) {
        skewWarned = true;
        console.error(
          "[ota-log-tailer] UYARI: log timestamp'leri gelecekte gorunuyor. " +
          `OTA_LOG_TZ_OFFSET=${LOG_TZ_OFFSET} ayari log sunucusunun saat dilimiyle uyusmuyor.`
        );
      }
    }

    if (parsed.type === "started") {
      entry.hasStarted = true;
      entry.lastActivityAt = parsed.ts;
      // Yeni oturum (baglanti kopup resume olabilir) — yuzdeyi sifirla
      if (parsed.sid && parsed.sid !== entry.lastSid) {
        entry.lastSid = parsed.sid;
        entry.percent = null;
      }
      entry.lastProgressAt = parsed.ts;

    } else if (parsed.type === "progress") {
      entry.hasStarted = true;
      if (parsed.sid && parsed.sid !== entry.lastSid) entry.lastSid = parsed.sid;
      entry.percent = parsed.percent;
      entry.lastProgressAt = parsed.ts;
      entry.lastActivityAt = parsed.ts;

    } else if (parsed.type === "report") {
      entry.lastResult = parsed.result;
      entry.lastStatus = parsed.status;
      entry.lastResultAt = parsed.ts;
      entry.lastActivityAt = parsed.ts;
      if (parsed.current) { entry.versionAtReport = parsed.current; entry.currentVersion = parsed.current; }
      if (parsed.latest)  { entry.targetVersion = parsed.latest;    entry.latestVersion = parsed.latest; }
      // Yeni bir rapor geldiyse onceki dogrulama gecersiz
      entry.postWriteVersion = null;
      entry.postWriteAt = null;

    } else if (parsed.type === "manifest" || parsed.type === "checkin") {
      entry.lastActivityAt = parsed.ts;
      if (parsed.current) entry.currentVersion = parsed.current;
      if (parsed.latest)  entry.latestVersion = parsed.latest;
      if (parsed.type === "manifest") entry.updateAvailable = parsed.available;

      // Yazma raporundan SONRA gelen ilk surum bildirimi = dogrulama
      if (entry.lastResultAt && parsed.ts !== null && parsed.ts > entry.lastResultAt && parsed.current) {
        if (!entry.postWriteAt) {
          entry.postWriteVersion = parsed.current;
          entry.postWriteAt = parsed.ts;
        }
      }
    }
  }

  return result;
}

async function getRecentLogLines({ logPath, requestedLines }) {
  await refreshBuffer({ logPath });
  return {
    lines: lineBuffer.slice(-requestedLines),
    totalLines: lineBuffer.length,
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = { getRecentLogLines, getMacUpdateStatus, parseOtaLine, LOG_TZ_OFFSET };