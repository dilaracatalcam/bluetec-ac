import { useState, useEffect, useCallback, useRef } from "react";
import {
  HiOutlineCpuChip, HiOutlinePlus, HiOutlineTrash, HiOutlineArrowDownTray, HiOutlineArrowUpTray,
  HiOutlineXMark, HiOutlineExclamationCircle, HiOutlineMagnifyingGlass,
  HiOutlinePencilSquare, HiOutlineDocumentMagnifyingGlass, HiOutlineAdjustmentsHorizontal,
} from "react-icons/hi2";
import ScrollableTable from "./ScrollableTable.jsx";

const EMPTY_FORM = {
  company: "", location: "", latitude: "", longitude: "", device_code: "", serial_no: "", mac: "",
  connection: "", sw_version: "", msp_fw: "", msp_sw: "", hw_version: "", logo: "", note: "",
  extra_fields: {},
};

const BULK_FIELD_LABELS = {
  company: "Şirket",
  location: "Konum",
  latitude: "Enlem",
  longitude: "Boylam",
  connection: "Bağlantı",
  logo: "Logo",
  sw_version: "Yazılım Versiyonu",
  msp_fw: "MSP FW Versiyonu",
  msp_sw: "MSP SW Versiyonu",
  hw_version: "Donanım Versiyonu",
  note: "Açıklama",
};

// Şirket alanı boş ya da bireysel ise cihaz "Atanabilir" sayılır (bkz. backend server.js)
function isIndividualCompany(company) {
  const key = String(company || "").trim().toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return !key || ["bireysel", "individual", "kisisel", "private", "ozel"].includes(key);
}

function Field({ label, value, onChange, placeholder, required = false, mono = false, list, readOnly = false }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold tracking-wide uppercase text-[var(--text-muted)] mb-1">
        {label}{required && <span className="text-rose-400 ml-1">*</span>}
      </label>
      <input type="text" value={value} onChange={onChange} placeholder={placeholder} list={list} readOnly={readOnly}
        className={`w-full bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                   px-2.5 py-1.5 rounded-md text-[13px] outline-none
                   focus:border-[var(--accent)] transition placeholder:text-[var(--text-muted)]
                   ${mono ? "font-mono" : ""} ${readOnly ? "opacity-70 cursor-not-allowed" : ""}`} />
    </div>
  );
}

export default function DeviceManagement({ token, currentUser }) {
  const [devices, setDevices] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [search, setSearch] = useState("");
  const [filterCompany, setFilterCompany] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = yeni ekleme, dolu = düzenleme
  // Gerçek bir şirketin admini sahipliği yalnızca "Bireysel" ya da kendi şirketi olarak seçebilir
  const companyAdmin = currentUser?.role === "admin" && !isIndividualCompany(currentUser?.company);

  // ── Toplu düzenleme ──
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkField, setBulkField] = useState("sw_version");
  const [bulkMode, setBulkMode] = useState("set"); // set | replace
  const [bulkValue, setBulkValue] = useState("");
  const [bulkFind, setBulkFind] = useState("");
  const [bulkReplace, setBulkReplace] = useState("");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState("");
  const [bulkIsCustom, setBulkIsCustom] = useState(false);

  // ── Özel alan tanımları (panelden yeni bir cihaz özelliği tanımlama) ──
  const [customFields, setCustomFields] = useState([]);
  const [showFieldManager, setShowFieldManager] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [fieldManagerError, setFieldManagerError] = useState("");
  const [fieldManagerSaving, setFieldManagerSaving] = useState(false);
  const [showInlineFieldAdd, setShowInlineFieldAdd] = useState(false); // Toplu Düzenle içinden hızlı alan ekleme

  const authFetch = useCallback((url, opts = {}) => fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), "Authorization": `Bearer ${token}` },
  }), [token]);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    try {
      const r = await authFetch("/api/devices");
      const d = await r.json();
      setDevices(d.devices || []);
    } catch { setError("Cihazlar yüklenemedi"); }
    finally { setLoading(false); }
  }, [authFetch]);

  const loadCompanies = useCallback(async () => {
    try {
      const r = await authFetch("/api/devices/companies");
      const d = await r.json();
      setCompanies(d.companies || []);
    } catch {}
  }, [authFetch]);

  const loadCustomFields = useCallback(async () => {
    try {
      const r = await authFetch("/api/device-fields");
      const d = await r.json();
      setCustomFields(d.fields || []);
    } catch {}
  }, [authFetch]);

  useEffect(() => { loadDevices(); loadCompanies(); loadCustomFields(); }, [loadDevices, loadCompanies, loadCustomFields]);

  const [sortBy, setSortBy] = useState("newest"); // newest | oldest | az | za

  const filtered = devices
    .filter((d) => {
      if (filterCompany && d.company !== filterCompany) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        (d.location || "").toLowerCase().includes(q) ||
        (d.device_code || "").toLowerCase().includes(q) ||
        (d.serial_no || "").toLowerCase().includes(q) ||
        (d.mac || "").toLowerCase().includes(q) ||
        (d.company || "").toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (sortBy === "az") return (a.location || "").localeCompare(b.location || "", "tr");
      if (sortBy === "za") return (b.location || "").localeCompare(a.location || "", "tr");
      // Panele gerçekten ne zaman eklendiği — dosyadaki "TARİH" gibi iş alanlarıyla karıştırılmaz
      const dateA = new Date(a.created_at || 0).getTime();
      const dateB = new Date(b.created_at || 0).getTime();
      return sortBy === "oldest" ? dateA - dateB : dateB - dateA; // "newest" varsayılan
    });

  const setField = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  const setExtraField = (key) => (e) => setForm((prev) => ({ ...prev, extra_fields: { ...prev.extra_fields, [key]: e.target.value } }));

  const handleExport = async () => {
    try {
      const r = await authFetch("/api/devices/export");
      if (!r.ok) { setError("Export başarısız"); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "bluetech_cihazlar.ods";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Not: URL.revokeObjectURL() bilinçli olarak çağrılmıyor. Mobil tarayıcılarda
      // indirme asenkron başlıyor; sabit bir sürede revoke etmek indirme bitmeden
      // URL'i geçersiz kılıp boş/bozuk dosya inmesine yol açabiliyordu. Tarayıcı
      // blob URL'lerini sayfa/sekme kapandığında zaten temizler.
    } catch { setError("Export başarısız"); }
  };

  const fileInputRef = useRef(null);
  const [importing, setImporting] = useState(false);

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError(""); setInfo("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const r = await authFetch("/api/devices/import", { method: "POST", body: formData });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "İçe aktarılamadı"); return; }
      setInfo(d.message);
      setTimeout(() => setInfo(""), 5000);
      await loadDevices();
      await loadCompanies();
    } catch { setError("Sunucuya ulaşılamadı"); }
    finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const [selectedDetail, setSelectedDetail] = useState(null);

  const handleSave = async () => {
    setFormError("");
    if (!form.mac) { setFormError("MAC adresi zorunlu"); return; }
    setSaving(true);
    try {
      const isEdit = editingId !== null;
      const r = await authFetch(isEdit ? `/api/devices/${editingId}` : "/api/devices", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (!r.ok) { setFormError(d.error || (isEdit ? "Güncellenemedi" : "Eklenemedi")); return; }
      setInfo(isEdit ? "Cihaz güncellendi" : "Cihaz eklendi");
      setTimeout(() => setInfo(""), 3000);
      setForm(EMPTY_FORM);
      setShowForm(false);
      setEditingId(null);
      setTemplateSourceId(null);
      await loadDevices();
      await loadCompanies();
    } catch { setFormError("Sunucuya ulaşılamadı"); }
    finally { setSaving(false); }
  };

  const startEdit = (d) => {
    setEditingId(d.id);
    setTemplateSourceId(null);
    setForm({
      company: d.company || "", location: d.location || "", latitude: d.latitude ?? "", longitude: d.longitude ?? "",
      device_code: d.device_code || "",
      serial_no: d.serial_no || "", mac: d.mac || "", connection: d.connection || "",
      sw_version: d.sw_version || "", msp_fw: d.msp_fw || "", msp_sw: d.msp_sw || "", hw_version: d.hw_version || "",
      logo: d.logo || "", note: d.note || "",
      extra_fields: { ...(d.extra_fields || {}) },
    });
    setFormError("");
    setShowForm(true);
  };

  const [templateSourceId, setTemplateSourceId] = useState(null); // çift tıklanan satır — görsel vurgu için

  // Listedeki bir cihaza ÇİFT TIKLANINCA bilgilerini "yeni cihaz ekle" formuna taşır —
  // SADECE form zaten açıksa (Yeni Cihaz'a basılmışsa) çalışır — kapalıyken yanlışlıkla açılmasın diye
  // editingId set edilmez, yani Kaydet'e basınca YENİ bir cihaz oluşturulur (var olanı değiştirmez)
  const startFromTemplate = (d) => {
    if (!showForm || editingId !== null) return; // form kapalıysa veya düzenleme modundaysa hiçbir şey yapma
    setForm({
      company: d.company || "", location: d.location || "", latitude: d.latitude ?? "", longitude: d.longitude ?? "",
      device_code: d.device_code || "",
      serial_no: d.serial_no || "", mac: d.mac || "", connection: d.connection || "",
      sw_version: d.sw_version || "", msp_fw: d.msp_fw || "", msp_sw: d.msp_sw || "", hw_version: d.hw_version || "",
      logo: d.logo || "", note: d.note || "",
      extra_fields: { ...(d.extra_fields || {}) },
    });
    setFormError("");
    setTemplateSourceId(d.id);
  };

  const cancelForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setTemplateSourceId(null);
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (ids) => {
    setSelectedIds((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      return allSelected ? new Set() : new Set(ids);
    });
  };

  const openBulkModal = () => {
    setBulkError("");
    setBulkValue(""); setBulkFind(""); setBulkReplace("");
    setBulkField("sw_version"); setBulkIsCustom(false);
    setShowInlineFieldAdd(false); setNewFieldLabel(""); setFieldManagerError("");
    setShowBulkModal(true);
  };

  const handleAddField = async () => {
    setFieldManagerError("");
    if (!newFieldLabel.trim()) { setFieldManagerError("Alan adı boş olamaz"); return; }
    setFieldManagerSaving(true);
    try {
      const r = await authFetch("/api/device-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newFieldLabel.trim() }),
      });
      const d = await r.json();
      if (!r.ok) { setFieldManagerError(d.error || "Alan eklenemedi"); return; }
      setNewFieldLabel("");
      await loadCustomFields();
      // Yeni eklenen alanı, açıksa Toplu Düzenle'de otomatik seçili hale getir
      setBulkField(d.field.field_key);
      setBulkIsCustom(true);
      setShowInlineFieldAdd(false);
    } catch { setFieldManagerError("Sunucuya ulaşılamadı"); }
    finally { setFieldManagerSaving(false); }
  };

  const handleDeleteField = async (fieldKey) => {
    if (!window.confirm(`"${fieldKey}" alanını silmek istediğine emin misin?\n\nCihazlardaki mevcut değerler silinmez, sadece bu alan artık formda/listede görünmez.`)) return;
    try {
      await authFetch(`/api/device-fields/${fieldKey}`, { method: "DELETE" });
      await loadCustomFields();
      // Silinen alan o an Toplu Düzenle'de seçiliyse, artık var olmayan bir alanda kalmasın
      if (bulkIsCustom && bulkField === fieldKey) {
        setBulkField("sw_version");
        setBulkIsCustom(false);
      }
    } catch {}
  };

  const handleBulkApply = async () => {
    setBulkError("");
    if (bulkMode === "replace" && !bulkFind) { setBulkError("'Bul' alanı boş olamaz"); return; }
    setBulkSaving(true);
    try {
      const r = await authFetch("/api/devices/bulk-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: Array.from(selectedIds),
          field: bulkField,
          isCustom: bulkIsCustom,
          mode: bulkMode,
          value: bulkValue,
          find: bulkFind,
          replace: bulkReplace,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setBulkError(d.error || "Toplu güncelleme başarısız"); return; }
      setInfo(d.message);
      setTimeout(() => setInfo(""), 4000);
      setShowBulkModal(false);
      setSelectedIds(new Set());
      await loadDevices();
      await loadCompanies();
    } catch { setBulkError("Sunucuya ulaşılamadı"); }
    finally { setBulkSaving(false); }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const r = await authFetch(`/api/devices/${confirmDelete}`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) { setError(d.error || "Silinemedi"); return; }
      setInfo("Cihaz silindi");
      setTimeout(() => setInfo(""), 3000);
      setConfirmDelete(null);
      await loadDevices();
      await loadCompanies();
    } catch { setError("Sunucuya ulaşılamadı"); }
    finally { setDeleting(false); }
  };

  return (
    <>
      <div className="mb-4 flex justify-end">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => { setFieldManagerError(""); setNewFieldLabel(""); setShowFieldManager(true); }}
              className="flex items-center gap-1.5 text-[12px] font-bold px-3 py-1.5 rounded-md border transition
                         bg-[var(--bg-sunken)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--border-strong)] cursor-pointer">
              <HiOutlineAdjustmentsHorizontal className="text-[14px]" />
              Özel Alanlar
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".ods"
              className="hidden"
              onChange={handleImportFile}
            />
            <button onClick={() => fileInputRef.current?.click()} disabled={importing}
              className="flex items-center gap-1.5 text-[12px] font-bold px-3 py-1.5 rounded-md border transition
                         bg-[var(--bg-sunken)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:border-[var(--border-strong)] cursor-pointer disabled:opacity-50">
              <HiOutlineArrowUpTray className={`text-[14px] ${importing ? "animate-pulse" : ""}`} />
              {importing ? "Aktarılıyor..." : "İçe Aktar"}
            </button>
            <button onClick={handleExport}
              className="flex items-center gap-1.5 text-[13px] font-semibold px-3.5 py-2 rounded-lg border transition
                         bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-border)] hover:bg-[var(--accent-soft-hover)] cursor-pointer">
              <HiOutlineArrowDownTray className="text-[14px]" />
              Dışa Aktar
            </button>
            <button onClick={() => { setEditingId(null); setShowForm(true); setFormError(""); setForm(EMPTY_FORM); setTemplateSourceId(null); }}
              className="flex items-center gap-1.5 text-[12px] font-bold px-3 py-1.5 rounded-md border transition
                         bg-[var(--accent)] hover:brightness-110 text-white border-[var(--accent)] cursor-pointer">
              <HiOutlinePlus className="text-[14px]" />
              Yeni Cihaz
            </button>
          </div>
        </div>
      </div>

      {(error || info) && (
        <div className={`mb-4 px-3 py-2 rounded-lg text-[13px] font-medium border
          ${error ? "bg-rose-500/10 border-rose-500/30 text-rose-500" : "bg-emerald-500/10 border-emerald-500/30 text-emerald-500"}`}>
          {error || info}
        </div>
      )}

      {showForm && (
        <div className="bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-xl p-4 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-bold text-[var(--text-primary)] tracking-wide uppercase flex items-center gap-2">
              {editingId !== null ? <HiOutlinePencilSquare className="text-[var(--accent)]" /> : <HiOutlinePlus className="text-[var(--accent)]" />}
              {editingId !== null ? "Cihazı Düzenle" : "Yeni Cihaz Ekle"}
            </h3>
            <button onClick={cancelForm}
              className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition cursor-pointer">
              <HiOutlineXMark className="text-[16px]" />
            </button>
          </div>

          {formError && (
            <div className="mb-3 px-2.5 py-1.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-500 text-[12px] font-medium flex items-center gap-1.5">
              <HiOutlineExclamationCircle className="text-[13px]" />{formError}
            </div>
          )}

          <datalist id="companies-list">
            {companies.map((c) => <option key={c} value={c} />)}
          </datalist>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {companyAdmin ? (
              <div>
                <label className="block text-[11px] font-semibold tracking-wide uppercase text-[var(--text-muted)] mb-1">Firma / Sahiplik</label>
                <select value={form.company || ""} onChange={setField("company")}
                  className="w-full bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)] px-2.5 py-1.5 rounded-md text-[13px] outline-none focus:border-[var(--accent)] transition cursor-pointer">
                  {editingId !== null && !form.company && <option value="">Atanabilir — firma/kişi daha sonra seçilecek</option>}
                  <option value="Bireysel">Bireysel — benim cihazım</option>
                  <option value={currentUser.company}>{currentUser.company}</option>
                </select>
                <p className="text-[10px] text-[var(--text-muted)] mt-1">
                  Cihazı kendiniz için alıyorsanız Bireysel, şirket için alıyorsanız şirketinizi seçin.
                </p>
              </div>
            ) : (
              <Field label="Firma / Sahiplik" value={form.company} onChange={setField("company")} placeholder="Bireysel veya boş = Atanabilir" list="companies-list" />
            )}
            <Field label="Konum" value={form.location} onChange={setField("location")} placeholder="İstanbul Merkez" />
            <Field label="Enlem" value={form.latitude} onChange={setField("latitude")} placeholder="41.0422" mono />
            <Field label="Boylam" value={form.longitude} onChange={setField("longitude")} placeholder="29.0010" mono />
            <Field label="OCPP ID" value={form.device_code} onChange={setField("device_code")} placeholder="AKBAT1AC" mono />
            <Field label="Seri No" value={form.serial_no} onChange={setField("serial_no")} placeholder="BT110S222509171140" mono />
            <Field label="MAC Adresi" value={form.mac} onChange={setField("mac")} placeholder="30:ED:A0:31:B2:E0" required mono readOnly={editingId !== null} />
            <div>
              <label className="block text-[11px] font-semibold tracking-wide uppercase text-[var(--text-muted)] mb-1">Bağlantı</label>
              <select value={form.connection} onChange={setField("connection")}
                className="w-full bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                           px-2.5 py-1.5 rounded-md text-[13px] outline-none focus:border-[var(--accent)] transition cursor-pointer">
                <option value="">Seçin...</option>
                <option value="GSM">GSM</option>
                <option value="WiFi">WiFi</option>
                <option value="ETH">ETH</option>
              </select>
            </div>
            <Field label="Yazılım Versiyonu" value={form.sw_version} onChange={setField("sw_version")} placeholder="1.0.0" mono />
            <Field label="MSP FW Versiyonu" value={form.msp_fw} onChange={setField("msp_fw")} placeholder="2.0.0" mono />
            <Field label="MSP SW Versiyonu" value={form.msp_sw} onChange={setField("msp_sw")} placeholder="v003" mono />
            <Field label="Donanım Versiyonu" value={form.hw_version} onChange={setField("hw_version")} placeholder="3.0.0" mono />
            <Field label="Logo" value={form.logo} onChange={setField("logo")} placeholder="logo_adi" />
            <div className="sm:col-span-2">
              <Field label="Açıklama" value={form.note} onChange={setField("note")} placeholder="Ek bilgi..." />
            </div>
            {customFields.map((f) => (
              <Field key={f.field_key} label={f.label}
                value={form.extra_fields?.[f.field_key] || ""}
                onChange={setExtraField(f.field_key)}
                placeholder={`${f.label}...`} />
            ))}
          </div>

          <div className="flex justify-end mt-3">
            <button onClick={handleSave} disabled={saving}
              className={`flex items-center gap-1.5 text-[12px] font-semibold px-4 py-1.5 rounded-lg border transition
                ${saving ? "bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed" : "bg-[var(--accent)] hover:brightness-110 text-white border-[var(--accent)] cursor-pointer"}`}>
              {editingId !== null ? <HiOutlinePencilSquare className="text-[14px]" /> : <HiOutlinePlus className="text-[14px]" />}
              {saving ? "Kaydediliyor..." : (editingId !== null ? "Kaydet" : "Ekle")}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <select value={filterCompany} onChange={(e) => setFilterCompany(e.target.value)}
          className="flex-1 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                     px-3 py-2 rounded-lg text-[13px] outline-none focus:border-[var(--accent)] transition cursor-pointer">
          <option value="">Tüm Şirketler</option>
          {companies.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="relative flex-1">
          <HiOutlineMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] text-[14px]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Konum, ID, MAC veya seri no ara..."
            className="w-full bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                       pl-8 pr-3 py-2 rounded-lg text-[13px] outline-none focus:border-[var(--accent)] transition
                       placeholder:text-[var(--text-muted)]" />
        </div>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
          className="bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                     px-3 py-2 rounded-lg text-[13px] outline-none focus:border-[var(--accent)] transition cursor-pointer shrink-0">
          <option value="newest">Panele Eklenme (Yeni→Eski)</option>
          <option value="oldest">Panele Eklenme (Eski→Yeni)</option>
          <option value="az">Konum (A-Z)</option>
          <option value="za">Konum (Z-A)</option>
        </select>
      </div>

      <div className="flex items-center justify-between mb-3 px-1">
        <span className="text-[12px] text-[var(--text-muted)]">
          {loading ? "Yükleniyor..." : (
            <><span className="text-[var(--accent)] font-semibold">{filtered.length}</span> / {devices.length} cihaz</>
          )}
        </span>
        <button onClick={loadDevices} disabled={loading}
          className="text-[11px] font-semibold text-[var(--accent)] hover:underline disabled:opacity-50">
          Yenile
        </button>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between mb-3 px-3 py-2 rounded-lg bg-[var(--accent-soft)] border border-[var(--accent-border)]">
          <span className="text-[13px] font-semibold text-[var(--accent)]">{selectedIds.size} cihaz seçildi</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelectedIds(new Set())}
              className="text-[12px] font-semibold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition">
              Seçimi Temizle
            </button>
            <button onClick={openBulkModal}
              className="flex items-center gap-1.5 text-[13px] font-semibold px-3.5 py-2 rounded-lg border transition
                         bg-[var(--accent)] text-white border-[var(--accent)] hover:opacity-90 cursor-pointer">
              <HiOutlinePencilSquare className="text-[13px]" />
              Toplu Düzenle
            </button>
          </div>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="border border-[var(--border-subtle)] rounded-xl overflow-hidden">
          <ScrollableTable minWidth="722px">
            <div className="grid grid-cols-[32px_minmax(180px,1.3fr)_minmax(110px,0.8fr)_130px_80px_108px] px-4 py-2 bg-[var(--bg-subtle)] border-b border-[var(--border-subtle)]">
              <input type="checkbox"
                checked={filtered.length > 0 && filtered.every((d) => selectedIds.has(d.id))}
                onChange={() => toggleSelectAll(filtered.map((d) => d.id))}
                className="cursor-pointer" />
              <span className="text-[11px] font-bold text-[var(--text-muted)] tracking-[0.1em] uppercase">Konum — ID</span>
              <span className="text-[11px] font-bold text-[var(--text-muted)] tracking-[0.1em] uppercase">Şirket</span>
              <span className="text-[11px] font-bold text-[var(--text-muted)] tracking-[0.1em] uppercase">MAC</span>
              <span className="text-[11px] font-bold text-[var(--text-muted)] tracking-[0.1em] uppercase">Bağlantı</span>
              <span />
            </div>
            <div className="max-h-[500px] overflow-y-auto custom-scroll">
              {filtered.map((d) => {
                const isTemplateSource = templateSourceId === d.id;
                return (
                <div key={d.id}
                  onDoubleClick={() => startFromTemplate(d)}
                  title={showForm && editingId === null ? "Çift tıkla: bu cihazın bilgileriyle yeni cihaz ekle" : undefined}
                  className={`grid grid-cols-[32px_minmax(180px,1.3fr)_minmax(110px,0.8fr)_130px_80px_108px] items-center px-4 py-3 border-b border-[var(--border-subtle)] last:border-b-0 transition-colors
                    ${isTemplateSource
                      ? "bg-[var(--accent-soft)] border-l-2 border-l-[var(--accent)]"
                      : "hover:bg-[var(--bg-hover)]"
                    }
                    ${showForm && editingId === null ? "cursor-pointer" : ""}`}>
                  <input type="checkbox"
                    checked={selectedIds.has(d.id)}
                    onChange={() => toggleSelect(d.id)}
                    onDoubleClick={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    className="cursor-pointer" />
                  <div>
                    <div className="text-[13px] text-[var(--text-primary)] font-medium leading-tight">
                      {d.location || "—"}
                      {d.device_code && <span className="text-[var(--text-muted)]"> — {d.device_code}</span>}
                    </div>
                    {d.serial_no && <div className="text-[11px] text-[var(--text-muted)] font-mono mt-0.5">{d.serial_no}</div>}
                  </div>
                  <div className="text-[13px] text-[var(--text-secondary)] truncate pr-2">{d.company || "—"}</div>
                  <div className="text-[12px] text-[var(--text-muted)] font-mono truncate pr-2">{d.mac || "—"}</div>
                  <div>
                    {d.connection ? (
                      <span className={`inline-flex items-center text-[11px] font-bold px-2 py-[3px] rounded-full
                        ${d.connection.toLowerCase().includes("wifi")
                          ? "bg-sky-500/10 text-sky-400 border border-sky-500/20"
                          : "bg-amber-500/10 text-amber-400 border border-amber-500/20"}`}>
                        {d.connection}
                      </span>
                    ) : <span className="text-[12px] text-[var(--text-muted)]">—</span>}
                  </div>
                  <div className="flex justify-end gap-1.5" onDoubleClick={(e) => e.stopPropagation()}>
                    <button onClick={() => setSelectedDetail(d)} title="Detayları göster"
                      className="p-1.5 rounded-md border bg-[var(--bg-sunken)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] hover:border-[var(--accent-border)] transition cursor-pointer">
                      <HiOutlineDocumentMagnifyingGlass className="text-[13px]" />
                    </button>
                    <button onClick={() => startEdit(d)} title="Düzenle"
                      className="p-1.5 rounded-md border bg-[var(--bg-sunken)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] hover:border-[var(--accent-border)] transition cursor-pointer">
                      <HiOutlinePencilSquare className="text-[13px]" />
                    </button>
                    <button onClick={() => setConfirmDelete(d.id)} title="Sil"
                      className="p-1.5 rounded-md border bg-[var(--bg-sunken)] border-[var(--border-subtle)] text-[var(--text-muted)] hover:bg-rose-500/10 hover:text-rose-500 hover:border-rose-500/30 transition cursor-pointer">
                      <HiOutlineTrash className="text-[13px]" />
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          </ScrollableTable>
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-12 text-[var(--text-muted)]">
          <HiOutlineCpuChip className="text-[32px] mx-auto mb-2 opacity-40" />
          <p className="text-[13px]">Eşleşen cihaz bulunamadı</p>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-6 max-w-sm w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-500 text-[18px]">
                <HiOutlineExclamationCircle />
              </div>
              <h3 className="text-[14px] font-bold text-[var(--text-primary)] font-display">Cihazı Sil?</h3>
            </div>
            <p className="text-[13px] text-[var(--text-secondary)] mb-5 leading-relaxed">
              Bu cihaz kalıcı olarak silinecek. Bu işlem geri alınamaz.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} disabled={deleting}
                className="text-[12px] font-semibold px-3 py-1.5 rounded-md border bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition cursor-pointer disabled:opacity-50">
                İptal
              </button>
              <button onClick={handleDelete} disabled={deleting}
                className={`flex items-center gap-1.5 text-[13px] font-semibold px-3.5 py-2 rounded-lg border transition
                  ${deleting ? "bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed" : "bg-rose-500 hover:bg-rose-400 text-white border-rose-400 cursor-pointer"}`}>
                <HiOutlineTrash className="text-[14px]" />
                {deleting ? "Siliniyor..." : "Sil"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          onClick={() => setSelectedDetail(null)}>
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-5 max-w-md w-full shadow-2xl max-h-[80vh] overflow-y-auto custom-scroll"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-[14px] font-bold text-[var(--text-primary)] font-display">Cihaz Detayları</h3>
                <p className="text-[12px] text-[var(--text-muted)] font-mono mt-0.5">{selectedDetail.mac}</p>
              </div>
              <button onClick={() => setSelectedDetail(null)}
                className="p-1.5 rounded-md border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition">
                <HiOutlineXMark className="text-[14px]" />
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {[
                ["Kayıt ID", selectedDetail.id],
                ["OCPP ID", selectedDetail.device_code],
                ["Seri No", selectedDetail.serial_no],
                ["MAC Adresi", selectedDetail.mac],
                ["Şirket", selectedDetail.company || "Atanabilir"],
                ["Konum", selectedDetail.location],
                ["Enlem", selectedDetail.latitude],
                ["Boylam", selectedDetail.longitude],
                ["Bağlantı", selectedDetail.connection],
                ["Logo", selectedDetail.logo],
                ["Yazılım Versiyonu", selectedDetail.sw_version],
                ["MSP FW Versiyonu", selectedDetail.msp_fw],
                ["MSP SW Versiyonu", selectedDetail.msp_sw],
                ["Donanım Versiyonu", selectedDetail.hw_version],
                ["Açıklama", selectedDetail.note],
                ["Güncellenme Tarihi", selectedDetail.updated_at],
                ["Panele Eklenme Tarihi", selectedDetail.created_at],
                ["Revizyon mu?", selectedDetail.is_revision ? "Evet" : "Hayır"],
                ...Object.entries(selectedDetail.extra_fields || {}).map(([key, val]) => {
                  const def = customFields.find((f) => f.field_key === key);
                  return [def ? def.label : key, val];
                }),
              ].map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-3 text-[12px] py-1.5 border-b border-[var(--border-subtle)] last:border-b-0">
                  <span className="text-[var(--text-muted)] shrink-0">{label}</span>
                  <span className="text-[var(--text-primary)] font-mono text-right break-all">
                    {value === "" || value === null || value === undefined ? "—" : String(value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          onClick={() => !bulkSaving && setShowBulkModal(false)}>
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-5 max-w-md w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-[14px] font-bold text-[var(--text-primary)] font-display">Toplu Düzenle</h3>
                <p className="text-[12px] text-[var(--text-muted)] mt-0.5">{selectedIds.size} cihaz etkilenecek</p>
              </div>
              <button onClick={() => setShowBulkModal(false)} disabled={bulkSaving}
                className="p-1.5 rounded-md border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition">
                <HiOutlineXMark className="text-[14px]" />
              </button>
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-semibold tracking-wide uppercase text-[var(--text-muted)]">Alan</label>
                  <button onClick={() => { setShowInlineFieldAdd((v) => !v); setNewFieldLabel(""); setFieldManagerError(""); }}
                    className="flex items-center gap-1 text-[11px] font-bold text-[var(--accent)] hover:underline cursor-pointer">
                    <HiOutlinePlus className="text-[11px]" />
                    Yeni Alan
                  </button>
                </div>

                {showInlineFieldAdd && (
                  <div className="flex gap-1.5 mb-2">
                    <input type="text" value={newFieldLabel}
                      onChange={(e) => setNewFieldLabel(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAddField()}
                      placeholder="örn: Kurulum Ekibi" autoFocus
                      className="flex-1 bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                                 px-2.5 py-1.5 rounded-md text-[13px] outline-none focus:border-[var(--accent)] transition
                                 placeholder:text-[var(--text-muted)]" />
                    <button onClick={handleAddField} disabled={fieldManagerSaving}
                      className={`text-[13px] font-semibold px-3.5 py-2 rounded-lg border transition shrink-0
                        ${fieldManagerSaving ? "bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed" : "bg-[var(--accent)] hover:brightness-110 text-white border-[var(--accent)] cursor-pointer"}`}>
                      Ekle
                    </button>
                  </div>
                )}
                {showInlineFieldAdd && fieldManagerError && (
                  <p className="text-[11px] text-rose-500 font-medium mb-2">{fieldManagerError}</p>
                )}

                <div className="flex gap-1.5">
                  <select value={bulkIsCustom ? `custom:${bulkField}` : bulkField}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v.startsWith("custom:")) { setBulkIsCustom(true); setBulkField(v.slice(7)); }
                      else { setBulkIsCustom(false); setBulkField(v); }
                    }}
                    className="flex-1 min-w-0 bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                               px-2.5 py-1.5 rounded-md text-[13px] outline-none focus:border-[var(--accent)] transition cursor-pointer">
                    {Object.entries(BULK_FIELD_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                    {customFields.length > 0 && (
                      <optgroup label="Özel Alanlar">
                        {customFields.map((f) => (
                          <option key={f.field_key} value={`custom:${f.field_key}`}>{f.label}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  {bulkIsCustom && (
                    <button onClick={() => handleDeleteField(bulkField)} title="Bu özel alanı sil"
                      className="p-1.5 rounded-md border bg-[var(--bg-sunken)] border-[var(--border-subtle)] text-[var(--text-muted)]
                                 hover:bg-rose-500/10 hover:text-rose-500 hover:border-rose-500/30 transition cursor-pointer shrink-0">
                      <HiOutlineTrash className="text-[14px]" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex gap-4">
                <label className="flex items-center gap-1.5 text-[13px] text-[var(--text-secondary)] cursor-pointer">
                  <input type="radio" checked={bulkMode === "set"} onChange={() => setBulkMode("set")} />
                  Aynı değeri ata
                </label>
                <label className="flex items-center gap-1.5 text-[13px] text-[var(--text-secondary)] cursor-pointer">
                  <input type="radio" checked={bulkMode === "replace"} onChange={() => setBulkMode("replace")} />
                  Bul ve Değiştir
                </label>
              </div>

              {bulkMode === "set" ? (
                <div>
                  <label className="block text-[11px] font-semibold tracking-wide uppercase text-[var(--text-muted)] mb-1">
                    Yeni Değer (seçili {selectedIds.size} cihazın hepsine aynen yazılır)
                  </label>
                  <input type="text" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}
                    placeholder="örn: v4.0.5"
                    className="w-full bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                               px-2.5 py-1.5 rounded-md text-[13px] outline-none focus:border-[var(--accent)] transition
                               placeholder:text-[var(--text-muted)]" />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold tracking-wide uppercase text-[var(--text-muted)] mb-1">Bul</label>
                    <input type="text" value={bulkFind} onChange={(e) => setBulkFind(e.target.value)}
                      placeholder="örn: A Parsel"
                      className="w-full bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                                 px-2.5 py-1.5 rounded-md text-[13px] outline-none focus:border-[var(--accent)] transition
                                 placeholder:text-[var(--text-muted)]" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold tracking-wide uppercase text-[var(--text-muted)] mb-1">Değiştir</label>
                    <input type="text" value={bulkReplace} onChange={(e) => setBulkReplace(e.target.value)}
                      placeholder="örn: B Parsel"
                      className="w-full bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                                 px-2.5 py-1.5 rounded-md text-[13px] outline-none focus:border-[var(--accent)] transition
                                 placeholder:text-[var(--text-muted)]" />
                  </div>
                  <p className="col-span-2 text-[11px] text-[var(--text-muted)] italic">
                    Yalnızca seçilen alanda "{bulkFind || "..."}" geçen cihazlar etkilenir, geri kalanı olduğu gibi kalır.
                  </p>
                </div>
              )}

              {bulkError && (
                <div className="text-[12px] text-rose-500 font-medium px-2.5 py-1.5 rounded-md bg-rose-500/10 border border-rose-500/25">
                  {bulkError}
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowBulkModal(false)} disabled={bulkSaving}
                className="text-[12px] font-semibold px-3 py-1.5 rounded-md border bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition cursor-pointer disabled:opacity-50">
                İptal
              </button>
              <button onClick={handleBulkApply} disabled={bulkSaving}
                className={`flex items-center gap-1.5 text-[12px] font-semibold px-4 py-1.5 rounded-lg border transition
                  ${bulkSaving ? "bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed" : "bg-[var(--accent)] hover:brightness-110 text-white border-[var(--accent)] cursor-pointer"}`}>
                {bulkSaving ? "Uygulanıyor..." : `${selectedIds.size} Cihaza Uygula`}
              </button>
            </div>
          </div>
        </div>
      )}

      {showFieldManager && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
          onClick={() => setShowFieldManager(false)}>
          <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-5 max-w-sm w-full shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-[14px] font-bold text-[var(--text-primary)] font-display">Özel Alanlar</h3>
                <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
                  Panelden yeni bir cihaz özelliği tanımla — Excel'e gerek kalmadan
                </p>
              </div>
              <button onClick={() => setShowFieldManager(false)}
                className="p-1.5 rounded-md border border-[var(--border-subtle)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-strong)] transition">
                <HiOutlineXMark className="text-[14px]" />
              </button>
            </div>

            {/* Mevcut özel alanlar listesi */}
            <div className="flex flex-col gap-1.5 mb-4 max-h-[200px] overflow-y-auto custom-scroll">
              {customFields.length === 0 ? (
                <p className="text-[12px] text-[var(--text-muted)] italic px-1">Henüz özel alan tanımlanmamış</p>
              ) : customFields.map((f) => (
                <div key={f.field_key} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md bg-[var(--bg-sunken)] border border-[var(--border-subtle)]">
                  <div className="min-w-0">
                    <span className="text-[13px] text-[var(--text-primary)] font-medium">{f.label}</span>
                    <span className="text-[10px] text-[var(--text-muted)] font-mono ml-1.5">#{f.field_key}</span>
                  </div>
                  <button onClick={() => handleDeleteField(f.field_key)} title="Alanı sil"
                    className="p-1 rounded-md text-[var(--text-muted)] hover:text-rose-500 hover:bg-rose-500/10 transition cursor-pointer shrink-0">
                    <HiOutlineTrash className="text-[13px]" />
                  </button>
                </div>
              ))}
            </div>

            {/* Yeni alan ekleme */}
            <div className="border-t border-[var(--border-subtle)] pt-3">
              <label className="block text-[11px] font-semibold tracking-wide uppercase text-[var(--text-muted)] mb-1">Yeni Alan Adı</label>
              <div className="flex gap-2">
                <input type="text" value={newFieldLabel}
                  onChange={(e) => setNewFieldLabel(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddField()}
                  placeholder="örn: Kurulum Ekibi"
                  className="flex-1 bg-[var(--bg-sunken)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                             px-2.5 py-1.5 rounded-md text-[13px] outline-none focus:border-[var(--accent)] transition
                             placeholder:text-[var(--text-muted)]" />
                <button onClick={handleAddField} disabled={fieldManagerSaving}
                  className={`flex items-center gap-1 text-[13px] font-semibold px-3.5 py-2 rounded-lg border transition shrink-0
                    ${fieldManagerSaving ? "bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed" : "bg-[var(--accent)] hover:brightness-110 text-white border-[var(--accent)] cursor-pointer"}`}>
                  <HiOutlinePlus className="text-[13px]" />
                  Ekle
                </button>
              </div>
              {fieldManagerError && (
                <p className="text-[12px] text-rose-500 font-medium mt-2">{fieldManagerError}</p>
              )}
              <p className="text-[11px] text-[var(--text-muted)] italic mt-2">
                Eklenen alan otomatik olarak Ekle/Düzenle formunda, Toplu Düzenle'de ve Detay penceresinde görünür.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}