/*
 * Bluetech sunucusundaki cihaz log arşivine salt-okunur erişim.
 *
 * Log dosyaları panel sunucusuna kopyalanmaz. Panel yalnızca 85.105.100.7
 * üzerindeki platform_mqtt/logs/<MAC>/ klasörünü SFTP ile listeler ve istenen
 * dosyanın önizlemesini/indirmesini anlık olarak yapar. Böylece btcharge
 * diskinde cihaz logları birikmez; current/history kaynağı Bluetech sunucusu
 * olmaya devam eder.
 */

const fs = require("fs");
const path = require("path");
const SftpClient = require("ssh2-sftp-client");

const MAC_RE = /^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/i;
const DEFAULT_ROOT = "/home/bluetech/platform_mqtt/logs";
const DEFAULT_HOST = "85.105.100.7";
const DEFAULT_USER = "bluetech";
const DEFAULT_KEY = "/root/.ssh/ota_transfer_key";
const MAX_PREVIEW_BYTES = 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 32 * 1024 * 1024;

function normalizeMac(mac) {
  const value = String(mac || "").trim().toUpperCase();
  if (!MAC_RE.test(value)) throw new Error("Geçersiz cihaz MAC adresi");
  return value;
}

function remoteDirForMac(mac, root = DEFAULT_ROOT) {
  return path.posix.join(root, normalizeMac(mac).replace(/:/g, "-"));
}

function fileMeta(item) {
  const name = String(item.name || "");
  const lower = name.toLowerCase();
  const history = lower.includes("history") || /(?:^|[-_.])\d{4}[-_.]\d{2}[-_.]\d{2}/.test(lower);
  let family = "other";
  let label = name;
  if (lower.includes("live") || lower.includes("terminal")) {
    family = "live";
    label = "Canlı kayıt";
  } else if (lower.includes("debug")) {
    family = "debug";
    label = "Debug kayıtları";
  } else if (lower.includes("verbose")) {
    family = "verbose";
    label = "Verbose kayıtları";
  } else if (lower.includes("ocpp")) {
    family = "ocpp";
    label = lower.includes("steve") ? "OCPP / SteVe" : "OCPP olay kaydı";
  }
  if (lower.endsWith(".html")) label += " (HTML)";
  if (lower.endsWith(".ocl")) label += " (OCL1 arşivi)";
  return {
    name,
    label,
    family,
    period: history ? "history" : "current",
    format: lower.endsWith(".html") ? "html" : lower.endsWith(".ocl") ? "ocl" : "text",
    size: Number(item.size || 0),
    modifiedAt: item.modifyTime || item.accessTime || null,
    readable: true,
  };
}

function openClient({ host, username, privateKeyPath }) {
  const client = new SftpClient();
  const key = fs.readFileSync(privateKeyPath);
  return { client, config: { host, username, privateKey: key } };
}

function initDeviceArchiveLogs(options = {}) {
  const host = options.host || process.env.LOG_REMOTE_HOST || DEFAULT_HOST;
  const username = options.username || process.env.LOG_REMOTE_USER || DEFAULT_USER;
  const root = options.root || process.env.LOG_REMOTE_ROOT || DEFAULT_ROOT;
  const privateKeyPath = options.privateKeyPath || process.env.LOG_SSH_KEY_PATH || DEFAULT_KEY;

  async function withSftp(fn) {
    const { client, config } = openClient({ host, username, privateKeyPath });
    try {
      await client.connect(config);
      return await fn(client);
    } finally {
      await client.end().catch(() => {});
    }
  }

  async function list(mac) {
    const remoteDir = remoteDirForMac(mac, root);
    const files = await withSftp(async (sftp) => {
      const entries = await sftp.list(remoteDir);
      return entries
        .filter((entry) => entry.type === "-" && entry.name && !entry.name.startsWith("."))
        .map(fileMeta)
        .sort((a, b) => (a.period === b.period ? a.name.localeCompare(b.name) : a.period === "current" ? -1 : 1));
    });
    return { mac: normalizeMac(mac), remoteDir, files, fetchedAt: new Date().toISOString() };
  }

  function assertFileName(name) {
    const clean = String(name || "");
    if (!clean || clean === "." || clean === ".." || clean.includes("/") || clean.includes("\\") || clean.includes("..")) {
      throw new Error("Geçersiz log dosyası");
    }
    return clean;
  }

  async function getBuffer(mac, name, maxBytes = MAX_PREVIEW_BYTES) {
    const remotePath = path.posix.join(remoteDirForMac(mac, root), assertFileName(name));
    return withSftp(async (sftp) => {
      const stat = await sftp.stat(remotePath);
      if (Number(stat.size || 0) > maxBytes) {
        // Önizlemede yalnızca son bölüm okunur; tüm log panel sunucusuna alınmaz.
        const start = Math.max(0, Number(stat.size) - maxBytes);
        const stream = await sftp.createReadStream(remotePath, { start, end: Number(stat.size) - 1 });
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        return { buffer: Buffer.concat(chunks), size: Number(stat.size), truncated: true };
      }
      const buffer = await sftp.get(remotePath);
      return { buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer), size: Number(stat.size || buffer.length), truncated: false };
    });
  }

  async function preview(mac, name) {
    const result = await getBuffer(mac, name, MAX_PREVIEW_BYTES);
    const binary = String(name).toLowerCase().endsWith(".ocl");
    return {
      name: assertFileName(name),
      size: result.size,
      truncated: result.truncated,
      binary,
      content: binary ? "Bu dosya OCL1 ikili arşividir. Metin önizlemesi yok; dosyayı indirerek çözümleyebilirsiniz." : result.buffer.toString("utf8"),
    };
  }

  async function download(mac, name) {
    const result = await getBuffer(mac, name, MAX_DOWNLOAD_BYTES);
    if (result.size > MAX_DOWNLOAD_BYTES) throw new Error("Log dosyası indirme sınırını aşıyor");
    return { name: assertFileName(name), size: result.size, buffer: result.buffer };
  }

  return { list, preview, download, remoteDirForMac };
}

module.exports = { initDeviceArchiveLogs, normalizeMac };

