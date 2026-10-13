import { useEffect, useState } from "react";
import { HiOutlineArrowUpTray, HiOutlinePhoto, HiOutlineInformationCircle } from "react-icons/hi2";
import { encodeLogoImageToIndexed4 } from "../utils/logoEncoder.js";

const LOGO_W = 238;
const LOGO_H = 88;
const LOGO_COMPANIES = [
  { value: "celikler", label: "Çelikler" },
  { value: "ctg", label: "CTG" },
  { value: "sepas", label: "Sepaş" },
  { value: "acrapol", label: "Acrapol" },
  { value: "estasyon", label: "Estasyon" },
  { value: "otopriz", label: "Otopriz" },
];

function decodeLogoPreview(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length !== 10536 && bytes.length !== 62832) return "";
  const canvas = document.createElement("canvas");
  canvas.width = LOGO_W; canvas.height = LOGO_H;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(LOGO_W, LOGO_H);
  for (let y = 0; y < LOGO_H; y++) for (let x = 0; x < LOGO_W; x++) {
    let r = 0, g = 0, b = 0, a = 255;
    if (bytes.length === 10536) {
      const packed = bytes[64 + y * ((LOGO_W + 1) >> 1) + (x >> 1)];
      const index = (x & 1) ? (packed & 0x0f) : (packed >> 4);
      const p = index * 4;
      b = bytes[p]; g = bytes[p + 1]; r = bytes[p + 2]; a = bytes[p + 3];
    } else {
      const p = (y * LOGO_W + x) * 3;
      const rgb565 = bytes[p] | (bytes[p + 1] << 8);
      r = Math.round(((rgb565 >> 11) & 0x1f) * 255 / 31);
      g = Math.round(((rgb565 >> 5) & 0x3f) * 255 / 63);
      b = Math.round((rgb565 & 0x1f) * 255 / 31);
      a = bytes[p + 2];
    }
    const i = (y * LOGO_W + x) * 4;
    image.data[i] = r; image.data[i + 1] = g; image.data[i + 2] = b; image.data[i + 3] = a;
  }
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

function normalizeLogoName(value) {
  return String(value || "").trim().replace(/\.bin$/i, "");
}

export default function LogoUploadPanel({
  token,
  currentUser,
  logoOptions = [],
  selectedLogo = "",
  activeLogo = "",
  onSelectLogo,
  onReadActiveLogo,
  readingActiveLogo = false,
  onUploaded,
  onApply,
  applySuccessMessage = "Logo güncelleme tamamlandı; cihazdaki aktif logo doğrulandı.",
  onDeleted,
  allowDelete = true,
  compact = false,
}) {
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [uploadedPreviewUrl, setUploadedPreviewUrl] = useState("");
  const [uploadedLogo, setUploadedLogo] = useState("");
  const [selectedRemotePreviewUrl, setSelectedRemotePreviewUrl] = useState("");
  const [activeRemotePreviewUrl, setActiveRemotePreviewUrl] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [activePreviewError, setActivePreviewError] = useState("");
  const [previewNonce, setPreviewNonce] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageOk, setMessageOk] = useState(false);
  const [applying, setApplying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [logoCompany, setLogoCompany] = useState(currentUser?.company || "");
  const role = currentUser?.role;
  const isUnrestricted = role === "superadmin" || role === "admin";
  const canUpload = isUnrestricted || !!currentUser?.company;
  const companyLabel = currentUser?.company || "Yönetici kapsamı";

  useEffect(() => {
    if (currentUser?.company) setLogoCompany(currentUser.company);
  }, [currentUser?.company]);

  useEffect(() => {
    if (!file) { setPreviewUrl(""); return undefined; }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => () => {
    if (uploadedPreviewUrl) URL.revokeObjectURL(uploadedPreviewUrl);
  }, [uploadedPreviewUrl]);

  useEffect(() => {
    let cancelled = false;
    setSelectedRemotePreviewUrl("");
    setActiveRemotePreviewUrl("");
    setPreviewError("");
    setActivePreviewError("");
    const selectedPreviewName = String(selectedLogo || uploadedLogo || "").trim();
    const names = [...new Set([selectedPreviewName, activeLogo].map((v) => String(v || "").trim()).filter(Boolean))];
    if (!names.length) {
      setPreviewLoading(false);
      return undefined;
    }
    setPreviewLoading(true);
    (async () => {
      let loaded = 0;
      let failed = 0;
      await Promise.all(names.map(async (name) => {
        try {
          // Cache kullanma: aynı isimli bir logo yeniden yüklendiğinde eski
          // görselin gösterilmesini engeller.
          const r = await fetch(`/api/ota-server/logo/${encodeURIComponent(name)}?t=${Date.now()}`, {
            cache: "no-store",
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const dataUrl = decodeLogoPreview(await r.arrayBuffer());
          if (!dataUrl) throw new Error("Logo formatı tanınmadı");
          if (!cancelled) {
            if (name === selectedPreviewName) setSelectedRemotePreviewUrl(dataUrl);
            if (name === String(activeLogo || "").trim()) setActiveRemotePreviewUrl(dataUrl);
          }
          loaded += 1;
        } catch {
          failed += 1;
          if (!cancelled && name === String(activeLogo || "").trim()) {
            setActivePreviewError(`Cihazın aktif logosu (${name}) sunucuda bulunamadı`);
          }
        }
      }));
      if (!cancelled) {
        setPreviewLoading(false);
        if (!loaded && failed) setPreviewError("Logo önizlemesi sunucudan okunamadı");
      }
    })();
    return () => { cancelled = true; };
  }, [selectedLogo, uploadedLogo, activeLogo, token, previewNonce]);

  const upload = async () => {
    if (!file || !canUpload || (isUnrestricted && !logoCompany)) return;
    setUploading(true); setMessage("");
    try {
      const isRaster = /\.(png|jpe?g|webp)$/i.test(file.name);
      const uploadFile = isRaster ? await encodeLogoImageToIndexed4(file) : file;
      const form = new FormData();
      form.append("file", uploadFile, uploadFile.name);
      form.append("fileType", "logo");
      if (isRaster) form.append("logoFormat", "indexed4");
      // Şirket hesabında backend şirket adını kendisi belirler; bu alan yalnızca
      // superadmin/admin için isteğe bağlı isimlendirmedir.
      if (isUnrestricted) form.append("company", logoCompany);
      const r = await fetch("/api/ota-server/upload", {
        method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form,
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Logo yüklenemedi");
      const value = d.logoName || "";
      // Sunucu cevabı/React state'i bir sonraki render'da güncellense bile
      // yeni yüklenen logonun doğru adıyla önizleme hemen başlasın.
      if (value) setUploadedLogo(value);
      if (file) setUploadedPreviewUrl(URL.createObjectURL(file));
      if (value) onSelectLogo?.(value);
      await onUploaded?.(d);
      // Yükleme tamamlandıktan sonra yerel dosya önizlemesini kaldır; artık
      // sunucudaki gerçek logo seçili ve remote önizleme gösterilsin.
      setFile(null);
      setMessageOk(true);
      setMessage(`${d.fileName || "Logo"} yüklendi. Bu logo yalnızca yetkili cihazlarda seçilebilir.`);
    } catch (e) {
      setMessageOk(false); setMessage(e?.message || "Logo hazırlanamadı");
    } finally { setUploading(false); }
  };

  const apply = async () => {
    if (!selectedLogo || !onApply) return;
    setApplying(true); setMessage("");
    try {
      const reportProgress = (text) => { setMessageOk(true); setMessage(text); };
      await onApply(selectedLogo, reportProgress);
      setMessageOk(true); setMessage(applySuccessMessage);
    }
    catch (e) { setMessageOk(false); setMessage(e?.message || "Logo cihaza gönderilemedi"); }
    finally { setApplying(false); }
  };

  const remove = async () => {
    if (!selectedLogo || deleting) return;
    if (activeLogo && normalizeLogoName(selectedLogo) === normalizeLogoName(activeLogo)) {
      setMessageOk(false);
      setMessage("Bu logo şu anda cihazda aktif. Önce başka bir logoyu cihaza uygulayın; sonra bunu silebilirsiniz.");
      return;
    }
    if (!window.confirm(`${selectedLogo} logosunu silmek istediğinize emin misiniz?`)) return;
    setDeleting(true); setMessage("");
    try {
      const r = await fetch("/api/ota-server/delete", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        // Dropdown'daki gerçek dosya taban adını gönder. Böylece
        // sepas_logo_1 seçildiğinde yanlışlıkla sepas_logo.bin silinmez.
        body: JSON.stringify({ fileType: "logo", logoName: selectedLogo }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.fileDeleted) throw new Error(d.error || d.fileError || "Logo silinemedi");
      onDeleted?.(selectedLogo);
      setMessageOk(true); setMessage("Logo silindi.");
    } catch (e) { setMessageOk(false); setMessage(e?.message || "Logo silinemedi"); }
    finally { setDeleting(false); }
  };

  return (
    <div className={`mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)] ${compact ? "p-3" : "p-4"}`}>
      <div className="flex items-center gap-2 mb-2">
        <HiOutlinePhoto className="text-[var(--accent)]" />
        <span className="text-[12px] font-bold text-[var(--text-primary)]">Logo seçimi ve yükleme</span>
        <span className="ml-auto text-[11px] text-[var(--text-muted)]">{companyLabel}</span>
      </div>

      <div className="flex gap-2">
        <select value={selectedLogo} onChange={(e) => { setPreviewError(""); setUploadedLogo(""); setUploadedPreviewUrl(""); onSelectLogo?.(e.target.value); }}
          className="min-w-0 flex-1 bg-[var(--bg)] border border-[var(--border-subtle)] text-[var(--text-primary)] px-3 py-2 rounded-lg text-[13px] outline-none focus:border-[var(--accent)]">
          <option value="">Logo seçin...</option>
          {logoOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button type="button" disabled={!selectedLogo || previewLoading}
          onClick={() => { setPreviewError(""); setPreviewNonce((n) => n + 1); }}
          className="shrink-0 px-3 py-2 rounded-lg border border-[var(--border-subtle)] text-[12px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50">
          Önizle
        </button>
      </div>
      {onReadActiveLogo && (
        <button type="button" onClick={onReadActiveLogo} disabled={readingActiveLogo}
          className="mt-2 text-[12px] font-semibold px-3 py-1.5 rounded-md border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50">
          <HiOutlinePhoto className="inline mr-1" /> {readingActiveLogo ? "Aktif logo okunuyor…" : "Cihazdaki aktif logoyu oku"}
        </button>
      )}
      {selectedLogo && onApply && (
        <button type="button" onClick={apply} disabled={applying}
          className={`mt-2 text-[12px] font-bold px-3 py-1.5 rounded-md border ${applying ? "opacity-50 cursor-not-allowed" : "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-border)]"}`}>
          {applying ? "Güncelleniyor..." : "Seçili logoyu cihaza uygula"}
        </button>
      )}
      {selectedLogo && canUpload && allowDelete && (
        <button type="button" onClick={remove} disabled={deleting}
          className="ml-2 mt-2 text-[12px] font-semibold px-3 py-1.5 rounded-md border border-rose-500/30 text-rose-500 hover:bg-rose-500/10 disabled:opacity-50">
          {deleting ? "Siliniyor..." : "Seçili logoyu sil"}
        </button>
      )}

      {selectedRemotePreviewUrl && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] mb-1">Seçili logo: {selectedLogo} (238×88)</div>
          <div className="rounded-md bg-slate-700 p-2 flex justify-center overflow-hidden">
            <img src={selectedRemotePreviewUrl} alt="Seçili logo önizleme" className="max-w-full h-auto max-h-[88px] object-contain" />
          </div>
        </div>
      )}

      {activeRemotePreviewUrl && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-[0.12em] text-emerald-600 dark:text-emerald-300 mb-1">Cihazdaki aktif logo: {activeLogo} (238×88)</div>
          <div className="rounded-md bg-slate-700 p-2 flex justify-center overflow-hidden">
            <img src={activeRemotePreviewUrl} alt="Cihazdaki aktif logo önizleme" className="max-w-full h-auto max-h-[88px] object-contain" />
          </div>
        </div>
      )}
      {activePreviewError && <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-300">{activePreviewError}</p>}
      {uploadedPreviewUrl && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-[0.12em] text-emerald-600 dark:text-emerald-300 mb-1">Yüklenen dosyanın önizlemesi (238×88)</div>
          <div className="rounded-md bg-slate-700 p-2 flex justify-center overflow-hidden">
            <img src={uploadedPreviewUrl} alt="Yüklenen logo önizleme" className="max-w-full h-auto max-h-[88px] object-contain" />
          </div>
        </div>
      )}
      {previewLoading && <p className="mt-2 text-[11px] text-[var(--text-muted)]">Logo önizlemesi okunuyor…</p>}
      {previewError && <p className="mt-2 text-[11px] text-rose-500">{previewError}</p>}

      <div className="mt-3 rounded-lg border border-dashed border-[var(--border-subtle)] p-3">
        <div className="flex items-center gap-2 mb-2">
          <HiOutlineArrowUpTray className="text-[var(--text-muted)]" />
          <span className="text-[12px] font-semibold text-[var(--text-secondary)]">Yeni logo ekle</span>
        </div>
        {!canUpload ? (
          <p className="text-[11px] text-[var(--text-muted)]">Bireysel hesaplar logo yükleyemez. Şirket logosu yetkili şirket hesabından yüklenir.</p>
        ) : (
          <>
            {isUnrestricted && (
              <select value={logoCompany} onChange={(e) => setLogoCompany(e.target.value)}
                className="mb-2 w-full bg-[var(--bg)] border border-[var(--border-subtle)] text-[var(--text-primary)] px-3 py-2 rounded-lg text-[12px] outline-none focus:border-[var(--accent)]">
                <option value="">Firma logosu seçin...</option>
                {LOGO_COMPANIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            )}
            <input type="file" accept=".png,.jpg,.jpeg,.webp,.c"
              onChange={(e) => { setFile(e.target.files?.[0] || null); setUploadedPreviewUrl(""); setUploadedLogo(""); setMessage(""); }}
              className="w-full text-[12px] text-[var(--text-primary)] file:mr-2 file:px-3 file:py-1.5 file:rounded-md file:border-0 file:bg-[var(--accent-soft)] file:text-[var(--accent)] file:text-[11px] file:font-bold file:cursor-pointer cursor-pointer" />
            {previewUrl && (
              <div className="mt-3">
                <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] mb-1">Yeni logonun önizlemesi (238×88)</div>
                <div className="rounded-md bg-slate-700 p-2 flex justify-center overflow-hidden">
                  <img src={previewUrl} alt="Logo önizleme" className="max-w-full h-auto max-h-[88px] object-contain" />
                </div>
              </div>
            )}
            <button type="button" onClick={upload} disabled={!file || uploading || (isUnrestricted && !logoCompany)}
              className={`mt-3 inline-flex items-center gap-1.5 text-[12px] font-bold px-3 py-1.5 rounded-md border transition ${!file || uploading ? "opacity-50 cursor-not-allowed bg-[var(--bg)] text-[var(--text-muted)] border-[var(--border-subtle)]" : "bg-[var(--accent)] text-white border-[var(--accent)] hover:brightness-110"}`}>
              <HiOutlineArrowUpTray /> {uploading ? "Yükleniyor..." : "Logoyu yükle"}
            </button>
          </>
        )}
      </div>

      <div className="mt-3 flex gap-2 text-[11px] leading-4 text-[var(--text-muted)]">
        <HiOutlineInformationCircle className="shrink-0 mt-0.5" />
        <span>PNG/JPG/WebP dosyası cihaz formatına çevrilir. Yükledikten sonra logoyu seçip <b>Logo Güncelle</b> komutunu gönderin; cihaz logoyu indirip yeniden başlatır. {isUnrestricted && "Yöneticiler tüm şirket logolarını görebilir."}</span>
      </div>
      {message && <p className={`mt-2 text-[11px] font-medium ${messageOk ? "text-emerald-500" : "text-rose-500"}`}>{message}</p>}
    </div>
  );
}
