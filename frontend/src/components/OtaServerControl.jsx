import { useState, useRef, useCallback, useEffect } from "react";
import {
  HiOutlineCloudArrowUp, HiOutlineDocumentText, HiOutlineCpuChip,
  HiOutlinePhoto, HiOutlineCheckCircle, HiOutlineExclamationCircle,
  HiOutlineArrowPath, HiOutlineXMark, HiOutlineFolderOpen,
  HiOutlineCog6Tooth, HiOutlineFunnel, HiOutlineKey, HiOutlineTrash,
} from "react-icons/hi2";
import OtaServerLogs from "./OtaServerLogs.jsx";
import { encodeLogoImageToIndexed4 } from "../utils/logoEncoder.js";

/* ── Şirket listesi — backend'deki OTA_LOGO_COMPANIES ile birebir eşleşmeli ── */
const LOGO_COMPANIES = [
  { value: "celikler", label: "Çelikler" },
  { value: "ctg",       label: "CTG" },
  { value: "sepas",     label: "Sepaş" },
  { value: "acrapol",   label: "Acropol" },
  { value: "estasyon",  label: "Estasyon" },
  { value: "otopriz",   label: "Otopriz" },
];

/* ── Tek bir upload kartı ── */
function UploadCard({
  title, description, icon, accept, fileType, token,
  showLogoFields = false,   // logo: şirket dropdown + özel isim
  versionFields = false,     // bin/txt: hw + sw versiyon
  namePrefix, ext,
  onUploaded,
}) {
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [company, setCompany] = useState("");
  const [customName, setCustomName] = useState("");
  const [hwVersion, setHwVersion] = useState("");
  const [swVersion, setSwVersion] = useState("");
  const inputRef = useRef(null);

  const pickFile = (f) => {
    if (!f) return;
    setFile(f);
    setResult(null);
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    pickFile(e.dataTransfer.files?.[0]);
  }, []);

  const reset = () => {
    setFile(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const previewName = () => {
    if (showLogoFields) {
      const base = customName.trim() || company;
      return base ? `${base}_logo.bin` : null;
    }
    if (versionFields) {
      const hw = hwVersion.trim().replace(/[^a-zA-Z0-9]/g, "");
      const sw = swVersion.trim().replace(/[^a-zA-Z0-9]/g, "");
      if (!hw || !sw) return null;
      return `${namePrefix}_hw${hw}_v${sw}.${ext}`;
    }
    return null;
  };

  const upload = async () => {
    if (!file) return;

    if (showLogoFields && !customName.trim() && !company) {
      setResult({ ok: false, message: "Şirket seçin veya özel bir isim girin" });
      return;
    }
    if (versionFields && (!hwVersion.trim() || !swVersion.trim())) {
      setResult({ ok: false, message: "Hardware ve software versiyonu girilmeli" });
      return;
    }

    setUploading(true);
    setResult(null);
    try {
      const formData = new FormData();
      // PNG/JPG/WebP logo tarayıcıda cihazın 4-bit .bin biçimine çevrilip gönderilir
      const isRasterLogo = showLogoFields && fileType === "logo" && /\.(png|jpe?g|webp)$/i.test(file.name);
      const uploadFile = isRasterLogo ? await encodeLogoImageToIndexed4(file) : file;
      formData.append("file", uploadFile, uploadFile.name);
      formData.append("fileType", fileType);
      if (showLogoFields) {
        formData.append("company", company);
        formData.append("customName", customName.trim());
        if (isRasterLogo) formData.append("logoFormat", "indexed4");
      }
      if (versionFields) {
        formData.append("hwVersion", hwVersion.trim());
        formData.append("swVersion", swVersion.trim());
      }

      const r = await fetch("/api/ota-server/upload", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}` },
        body: formData,
      });
      const d = await r.json();
      if (!r.ok) {
        setResult({ ok: false, message: d.error || "Yükleme başarısız" });
      } else {
        const fwMsg = d.firmwareJson?.updated
          ? ` — firmware.json güncellendi (${d.firmwareJson.versionKey})`
          : d.firmwareJson && !d.firmwareJson.updated
            ? ` — dosya gitti ama firmware.json güncellenemedi: ${d.firmwareJson.error}`
            : "";
        setResult({ ok: true, message: `${d.remotePath} adresine gönderildi ve doğrulandı (${(d.size / 1024).toFixed(1)} KB)${fwMsg}` });
        setFile(null);
        if (inputRef.current) inputRef.current.value = "";
        onUploaded?.();
      }
    } catch (e) {
      setResult({ ok: false, message: e?.message || "Logo hazırlanamadı" });
    } finally {
      setUploading(false);
    }
  };

  const preview = previewName();

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <span className="text-[18px] text-[var(--accent)] shrink-0">{icon}</span>
        <div className="min-w-0">
          <h4 className="text-[14px] font-bold text-[var(--text-primary)]">{title}</h4>
          <p className="text-[12px] text-[var(--text-muted)]">{description}</p>
        </div>
      </div>

      {showLogoFields && (
        <div className="flex flex-col gap-1.5">
          <select
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="w-full bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                       px-2.5 py-1.5 rounded-md text-[13px] outline-none focus:border-[var(--accent)] transition"
          >
            <option value="">Şirket seçin…</option>
            {LOGO_COMPANIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[var(--text-muted)] shrink-0">veya özel isim:</span>
            <input
              type="text"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="örn: dilara"
              className="flex-1 min-w-0 bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                         px-2.5 py-1.5 rounded-md text-[13px] outline-none focus:border-[var(--accent)] transition
                         placeholder:text-[var(--text-muted)]"
            />
          </div>
        </div>
      )}

      {versionFields && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={hwVersion}
            onChange={(e) => setHwVersion(e.target.value)}
            placeholder="Hardware (örn: 21)"
            className="flex-1 min-w-0 bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                       px-2.5 py-1.5 rounded-md text-[13px] outline-none focus:border-[var(--accent)] transition
                       placeholder:text-[var(--text-muted)]"
          />
          <input
            type="text"
            value={swVersion}
            onChange={(e) => setSwVersion(e.target.value)}
            placeholder="Software (örn: 11)"
            className="flex-1 min-w-0 bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                       px-2.5 py-1.5 rounded-md text-[13px] outline-none focus:border-[var(--accent)] transition
                       placeholder:text-[var(--text-muted)]"
          />
        </div>
      )}

      {preview && (
        <span className="text-[11px] text-[var(--text-muted)]">
          Gönderilecek isim: <span className="font-mono text-[var(--text-secondary)]">{preview}</span>
        </span>
      )}

      {/* Drag & drop alanı */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-1.5 py-5 px-3 rounded-lg border-2 border-dashed
                    cursor-pointer transition-colors text-center
          ${dragOver
            ? "border-[var(--accent)] bg-[var(--accent-soft)]"
            : "border-[var(--border-subtle)] hover:border-[var(--border-strong)]"
          }`}
      >
        <HiOutlineCloudArrowUp className="text-[22px] text-[var(--text-muted)]" />
        {file ? (
          <span className="text-[13px] font-semibold text-[var(--text-primary)] break-all">{file.name}</span>
        ) : (
          <span className="text-[12px] text-[var(--text-muted)]">Dosyayı sürükle veya tıkla ({accept})</span>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />
      </div>

      {result && (
        <div className={`flex items-start gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-md
          ${result.ok
            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25"
            : "bg-rose-500/10 text-rose-400 border border-rose-500/25"
          }`}>
          {result.ok ? <HiOutlineCheckCircle className="text-[14px] mt-[1px] shrink-0" /> : <HiOutlineExclamationCircle className="text-[14px] mt-[1px] shrink-0" />}
          <span className="break-all">{result.message}</span>
        </div>
      )}

      <div className="flex items-center gap-2">
        {file && !uploading && (
          <button
            onClick={reset}
            className="p-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-muted)]
                       hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition shrink-0"
            title="Vazgeç"
          >
            <HiOutlineXMark className="text-[14px]" />
          </button>
        )}
        <button
          onClick={upload}
          disabled={!file || uploading}
          className={`flex-1 flex items-center justify-center gap-1.5 text-[13px] font-semibold py-2 rounded-lg border transition
            ${(!file || uploading)
              ? "bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed"
              : "bg-[var(--accent)] text-white border-[var(--accent-border)] hover:opacity-90 cursor-pointer"
            }`}
        >
          <HiOutlineArrowPath className={`text-[14px] ${uploading ? "animate-spin" : ""}`} />
          {uploading ? "Gönderiliyor…" : "Sunucuya Gönder"}
        </button>
      </div>
    </div>
  );
}

/* ── OTA Config (ota_config.json) paneli ── */
function OtaConfigPanel({ token }) {
  const [otaKey, setOtaKey] = useState("");
  const [testMode, setTestMode] = useState(false);
  const [espTarget, setEspTarget] = useState("latest");
  const [mspTarget, setMspTarget] = useState("latest");
  const [espVersions, setEspVersions] = useState([]);
  const [mspVersions, setMspVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setResult(null);
    try {
      const [configRes, versionsRes] = await Promise.all([
        fetch("/api/ota-server/config", { headers: { "Authorization": `Bearer ${token}` } }),
        fetch("/api/ota-server/firmware-versions", { headers: { "Authorization": `Bearer ${token}` } }),
      ]);
      const configData = await configRes.json();
      const versionsData = await versionsRes.json();

      if (!configRes.ok) { setResult({ ok: false, message: configData.error || "Config alınamadı" }); return; }

      setOtaKey(configData.config.ota_key ?? "");
      setTestMode(!!configData.config.test_mode);
      setEspTarget(configData.config.esp_target_version ?? "latest");
      setMspTarget(configData.config.msp_target_version ?? "latest");

      if (versionsRes.ok) {
        setEspVersions(versionsData.espVersions || []);
        setMspVersions(versionsData.mspVersions || []);
      }
    } catch {
      setResult({ ok: false, message: "Sunucuya ulaşılamadı" });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!otaKey.trim()) {
      setResult({ ok: false, message: "ota_key boş olamaz" });
      return;
    }
    setSaving(true);
    setResult(null);
    try {
      const r = await fetch("/api/ota-server/config", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({
          ota_key: otaKey.trim(),
          test_mode: testMode,
          esp_target_version: espTarget,
          msp_target_version: mspTarget,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setResult({ ok: false, message: d.error || "Kaydedilemedi" }); return; }
      setResult({ ok: true, message: "ota_config.json güncellendi" });
    } catch {
      setResult({ ok: false, message: "Sunucuya ulaşılamadı" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <HiOutlineCog6Tooth className="text-[15px] text-[var(--accent)]" />
        <h4 className="text-[14px] font-bold text-[var(--text-primary)]">OTA Config</h4>
      </div>

      {loading ? (
        <p className="text-[12px] text-[var(--text-muted)]">Yükleniyor…</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-[var(--text-muted)] flex items-center gap-1">
              <HiOutlineKey className="text-[12px]" /> ota_key
            </label>
            <input
              type="text"
              value={otaKey}
              onChange={(e) => setOtaKey(e.target.value)}
              className="bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                         px-2.5 py-1.5 rounded-md text-[13px] font-mono outline-none focus:border-[var(--accent)] transition"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-[var(--text-muted)]">test_mode</label>
            <button
              onClick={() => setTestMode((v) => !v)}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md border transition w-fit
                ${testMode
                  ? "bg-amber-500/15 border-amber-500/40 text-amber-400"
                  : "bg-[var(--bg-sunken)] border-[var(--border-subtle)] text-[var(--text-muted)]"
                }`}
            >
              <div className={`relative w-8 h-[18px] rounded-full transition-colors duration-200 ${testMode ? "bg-amber-500/60" : "bg-slate-600/40"}`}>
                <div className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-all duration-200 ${testMode ? "left-[16px]" : "left-[2px]"}`} />
              </div>
              <span className="text-[12px] font-semibold">{testMode ? "true" : "false"}</span>
            </button>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-[var(--text-muted)]">esp_target_version</label>
            <select
              value={espTarget}
              onChange={(e) => setEspTarget(e.target.value)}
              className="bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                         px-2.5 py-1.5 rounded-md text-[13px] outline-none focus:border-[var(--accent)] transition"
            >
              <option value="latest">latest</option>
              {espVersions.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-[var(--text-muted)]">msp_target_version</label>
            <select
              value={mspTarget}
              onChange={(e) => setMspTarget(e.target.value)}
              className="bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                         px-2.5 py-1.5 rounded-md text-[13px] outline-none focus:border-[var(--accent)] transition"
            >
              <option value="latest">latest</option>
              {mspVersions.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </div>
      )}

      {result && (
        <div className={`flex items-start gap-1.5 text-[12px] font-medium px-2.5 py-1.5 rounded-md
          ${result.ok
            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25"
            : "bg-rose-500/10 text-rose-400 border border-rose-500/25"
          }`}>
          {result.ok ? <HiOutlineCheckCircle className="text-[14px] mt-[1px] shrink-0" /> : <HiOutlineExclamationCircle className="text-[14px] mt-[1px] shrink-0" />}
          <span>{result.message}</span>
        </div>
      )}

      <button
        onClick={save}
        disabled={loading || saving}
        className={`self-start flex items-center gap-1.5 text-[13px] font-semibold px-4 py-1.5 rounded-lg border transition
          ${(loading || saving)
            ? "bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed"
            : "bg-[var(--accent)] text-white border-[var(--accent-border)] hover:opacity-90 cursor-pointer"
          }`}
      >
        <HiOutlineArrowPath className={`text-[14px] ${saving ? "animate-spin" : ""}`} />
        {saving ? "Kaydediliyor…" : "Kaydet"}
      </button>
    </div>
  );
}

/* ── Sunucudaki mevcut dosyalar listesi ── */
function formatSize(bytes) {
  if (bytes == null) return "—";
  return (bytes / 1024).toFixed(1) + " KB";
}
function formatDate(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleDateString("tr-TR") + " " + d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
}

// "fw_hw61_v11.bin" -> { prefix: "fw", hw: "61", sw: "11", ext: "bin" }
// Bu formata uymayan dosyalar (örn. eski "fw.bin") silinemez, buton çıkmaz.
function parseVersionedName(name) {
  const m = name.match(/^(fw|msp)_hw(\d+)_v(\d+)\.(bin|txt)$/i);
  if (!m) return null;
  return { prefix: m[1].toLowerCase(), hw: m[2], sw: m[3], ext: m[4].toLowerCase() };
}

// "sepas_logo.bin" / "dilara_logo.bin" -> { logoName: "sepas" }
function parseLogoName(name) {
  const m = name.match(/^(.+)_logo\.bin$/i);
  if (!m) return null;
  return { logoName: m[1] };
}

function extractHw(filename) {
  const m = filename.match(/hw(\d+)/i);
  return m ? m[1] : null;
}

const CATEGORIES = [
  { value: "firmware", label: "ESP Firmware", hasHw: true },
  { value: "msp",      label: "MSP",          hasHw: true },
  { value: "logo",     label: "Logo",         hasHw: false },
  { value: "other",    label: "Diğer",        hasHw: false },
];

/* ── Tek bir dosya satırı — isim üstte (mobilde tam görünür), meta+sil altta ── */
function FileRow({ file, kind, onDelete, isDeleting }) {
  const parsed = onDelete
    ? (kind === "logo" ? parseLogoName(file.name) : (kind === "firmware" || kind === "msp") ? parseVersionedName(file.name) : null)
    : null;

  return (
    <li className="flex flex-col gap-1 px-3 py-2 rounded-lg bg-[var(--bg-sunken)] border border-[var(--border-subtle)]">
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[13px] text-[var(--text-primary)] break-all leading-tight">{file.name}</span>
        {parsed && (
          <button
            onClick={() => onDelete(file, kind, parsed)}
            disabled={isDeleting}
            title="Sil"
            className="p-1 rounded-md border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 transition disabled:opacity-40 shrink-0"
          >
            <HiOutlineTrash className={`text-[13px] ${isDeleting ? "animate-pulse" : ""}`} />
          </button>
        )}
      </div>
      <span className="text-[11px] text-[var(--text-muted)]">{formatSize(file.size)} · {formatDate(file.modifyTime)}</span>
    </li>
  );
}

function OtaFileList({ token, refreshKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("firmware");
  const [hwFilter, setHwFilter] = useState("");
  const [deletingName, setDeletingName] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/ota-server/list", {
        headers: { "Authorization": `Bearer ${token}` },
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "Liste alınamadı"); return; }
      setData(d);
    } catch {
      setError("Sunucuya ulaşılamadı");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const handleDelete = async (file, kind, parsed) => {
    if (!parsed) return;
    const confirmed = window.confirm(
      kind === "logo"
        ? `${file.name} logosunu silmek istediğine emin misin?\n\nBu işlem geri alınamaz.`
        : `${file.name} dosyasını silmek istediğine emin misin?\n\nBu işlem hem sunucudaki dosyayı hem de firmware.json kaydını kaldırır ve geri alınamaz.`
    );
    if (!confirmed) return;

    setDeletingName(file.name);
    try {
      const body = kind === "logo"
        ? { fileType: "logo", logoName: parsed.logoName }
        : { fileType: parsed.prefix === "fw" ? "bin" : "txt", hwVersion: parsed.hw, swVersion: parsed.sw };

      const r = await fetch("/api/ota-server/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) {
        alert(d.error || "Silinemedi");
        return;
      }
      if (!d.fileDeleted) {
        alert(`Dosya sunucudan silinemedi: ${d.fileError || "bilinmeyen hata"}`);
      }
      load();
    } catch {
      alert("Sunucuya ulaşılamadı");
    } finally {
      setDeletingName(null);
    }
  };

  const categoryMeta = CATEGORIES.find((c) => c.value === category);
  const filesForCategory = data
    ? { firmware: data.firmware, msp: data.msp, logo: data.logos, other: data.other }[category] || []
    : [];

  // hw değiştiğinde/kategori değiştiğinde eski hw seçimi anlamsız kalmasın diye:
  const availableHws = categoryMeta?.hasHw
    ? Array.from(new Set(filesForCategory.map((f) => extractHw(f.name)).filter(Boolean))).sort((a, b) => Number(a) - Number(b))
    : [];

  const handleCategoryChange = (val) => {
    setCategory(val);
    setHwFilter("");
  };

  const displayFiles = hwFilter
    ? filesForCategory.filter((f) => extractHw(f.name) === hwFilter)
    : filesForCategory;

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <HiOutlineFolderOpen className="text-[15px] text-[var(--accent)]" />
          <h4 className="text-[14px] font-bold text-[var(--text-primary)]">Sunucudaki Mevcut Dosyalar</h4>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1 text-[12px] font-semibold px-3 py-1.5 rounded-lg border
                     border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)]
                     hover:border-[var(--border-strong)] transition shrink-0"
        >
          <HiOutlineArrowPath className={`text-[13px] ${loading ? "animate-spin" : ""}`} />
          Yenile
        </button>
      </div>

      {error && (
        <p className="text-[12px] text-rose-400 mb-2">{error}</p>
      )}

      {data && (
        <>
          {/* Kategori + hardware dropdown'ları */}
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <div className="flex items-center gap-1.5 flex-1 min-w-0">
              <HiOutlineFunnel className="text-[13px] text-[var(--text-muted)] shrink-0" />
              <select
                value={category}
                onChange={(e) => handleCategoryChange(e.target.value)}
                className="flex-1 min-w-0 bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                           px-2.5 py-1.5 rounded-md text-[13px] outline-none focus:border-[var(--accent)] transition"
              >
                {CATEGORIES.map((c) => {
                  const count = { firmware: data.firmware, msp: data.msp, logo: data.logos, other: data.other }[c.value]?.length ?? 0;
                  return <option key={c.value} value={c.value}>{c.label} ({count})</option>;
                })}
              </select>
            </div>

            {categoryMeta?.hasHw && (
              <select
                value={hwFilter}
                onChange={(e) => setHwFilter(e.target.value)}
                className="bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                           px-2.5 py-1.5 rounded-md text-[13px] outline-none focus:border-[var(--accent)] transition"
              >
                <option value="">Tüm hardware'ler</option>
                {availableHws.map((hw) => (
                  <option key={hw} value={hw}>HW {hw}</option>
                ))}
              </select>
            )}
          </div>

          {/* Dosya listesi */}
          {displayFiles.length === 0 ? (
            <p className="text-[12px] text-[var(--text-muted)] italic px-1">Dosya yok</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {displayFiles.map((f) => (
                <FileRow
                  key={f.name}
                  file={f}
                  kind={category}
                  onDelete={handleDelete}
                  isDeleting={deletingName === f.name}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}


/* ── Main ── */
export default function OtaServerControl({ token }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const bumpRefresh = () => setRefreshKey((k) => k + 1);

  return (
    <div className="flex flex-col gap-4">

      <OtaConfigPanel token={token} />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <UploadCard
          title="ESP Firmware"
          description=".bin — hardware/software versiyonuna göre etiketlenir"
          icon={<HiOutlineCpuChip />}
          accept=".bin"
          fileType="bin"
          versionFields
          namePrefix="fw"
          ext="bin"
          token={token}
          onUploaded={bumpRefresh}
        />
        <UploadCard
          title="MSP Parametre"
          description=".txt — hardware/software versiyonuna göre etiketlenir"
          icon={<HiOutlineDocumentText />}
          accept=".txt"
          fileType="txt"
          versionFields
          namePrefix="msp"
          ext="txt"
          token={token}
          onUploaded={bumpRefresh}
        />
        <UploadCard
          title="Logo"
          description="PNG/JPG/WebP — 238×88 LVGL 4-bit .bin'e çevrilir (.c de desteklenir)"
          icon={<HiOutlinePhoto />}
          accept=".c,.png,.jpg,.jpeg,.webp"
          fileType="logo"
          showLogoFields
          token={token}
          onUploaded={bumpRefresh}
        />
      </div>

      <OtaFileList token={token} refreshKey={refreshKey} />

      <OtaServerLogs token={token} />
    </div>
  );
}