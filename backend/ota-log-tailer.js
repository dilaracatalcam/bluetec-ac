/* ═══════════════════════════════════════════════════════════════
   OTA Sunucu Log Tailer
   Her pollingde dosyanın TAMAMINI indirmek yerine:
   - Bağlantıyı açık tutar (her seferinde yeniden bağlanmaz)
   - Sadece son okunan byte'tan itibaren YENİ eklenen kısmı okur
   - Satırları hafızada (sınırlı sayıda) biriktirir
   ═══════════════════════════════════════════════════════════════ */

const fs = require("fs");
const SftpClient = require("ssh2-sftp-client");

const MAX_BUFFERED_LINES = 1000;   // hafızada tutulan üst sınır
const SEED_BYTES = 65536;          // ilk bağlantıda dosyanın sadece son ~64KB'ı okunur

let sftp = null;
let connecting = null;
let lastSize = 0;
let lineBuffer = [];   // eski -> yeni sırayla
let partialLine = "";  // henüz "\n" ile bitmemiş son satır parçası
let seeded = false;

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function connect(host, username, privateKeyPath) {
  const client = new SftpClient();
  await client.connect({
    host,
    username,
    privateKey: fs.readFileSync(privateKeyPath),
  });
  return client;
}

async function ensureConnected(host, username, privateKeyPath) {
  if (sftp) return sftp;
  if (connecting) return connecting;
  connecting = connect(host, username, privateKeyPath)
    .then((client) => { sftp = client; connecting = null; return client; })
    .catch((e) => { connecting = null; throw e; });
  return connecting;
}

function appendChunk(text) {
  const combined = partialLine + text;
  const parts = combined.split("\n");
  partialLine = parts.pop() || ""; // son parça tamamlanmamış olabilir, sakla
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

async function getRecentLogLines({ host, username, privateKeyPath, logPath, requestedLines }) {
  let client;
  try {
    client = await ensureConnected(host, username, privateKeyPath);
  } catch (e) {
    sftp = null;
    throw e;
  }

  let stat;
  try {
    stat = await client.stat(logPath);
  } catch (e) {
    // Bağlantı kopmuş olabilir — sıfırlayıp bir kez daha dene
    sftp = null;
    client = await ensureConnected(host, username, privateKeyPath);
    stat = await client.stat(logPath);
  }

  const currentSize = stat.size;

  if (currentSize < lastSize) {
    // Dosya küçülmüş (logrotate vb.) — baştan seed et
    resetState();
  }

  if (!seeded) {
    if (currentSize > 0) {
      const start = Math.max(0, currentSize - SEED_BYTES);
      const stream = client.createReadStream(logPath, { start, end: currentSize - 1 });
      const buf = await streamToBuffer(stream);
      appendChunk(buf.toString("utf-8"));
    }
    lastSize = currentSize;
    seeded = true;
  } else if (currentSize > lastSize) {
    const stream = client.createReadStream(logPath, { start: lastSize, end: currentSize - 1 });
    const buf = await streamToBuffer(stream);
    appendChunk(buf.toString("utf-8"));
    lastSize = currentSize;
  }

  const lines = lineBuffer.slice(-requestedLines);
  return {
    lines,
    totalLines: lineBuffer.length, // not: dosyanın mutlak toplamı değil, o ana kadar biriktirdiğimiz satır sayısı
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = { getRecentLogLines };