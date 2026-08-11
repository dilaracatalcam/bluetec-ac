import Sidebar from "../components/Sidebar.jsx";
import Panel from "../components/Panel.jsx";
import MetricCard from "../components/MetricCard.jsx";
import ActionButton from "../components/ActionButton.jsx";
import EditableRow from "../components/EditableRow.jsx";
import InfoRow from "../components/InfoRow.jsx";
import UserManagement from "../components/UserManagement.jsx";
import Connections from "../components/Connections.jsx";
import DeviceSelect from "../components/DeviceSelect.jsx";
import DeviceManagement from "../components/DeviceManagement.jsx";
import DeviceSetup from "../components/DeviceSetup.jsx";
import BulkUpdate from "../components/BulkUpdate.jsx";
import OtaServerControl from "../components/OtaServerControl.jsx";
import DeviceVersions from "../components/DeviceVersions.jsx";
import OtaServerLogs from "../components/OtaServerLogs.jsx";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";

import {
  HiOutlineGlobeAlt, HiOutlineLink, HiOutlineQrCode,
  HiOutlineBolt, HiOutlineWifi, HiOutlineLockClosed,
  HiOutlinePhone, HiOutlinePhoto, HiOutlineTag,
  HiOutlineCog6Tooth, HiOutlineArrowPath, HiOutlineStop,
  HiOutlineCpuChip, HiOutlineClock, HiOutlineExclamationTriangle,
  HiOutlineArrowUpTray, HiOutlineKey,
  HiOutlineAdjustmentsHorizontal, HiOutlineCommandLine,
  HiOutlinePencilSquare, HiOutlineIdentification,
  HiOutlineWrenchScrewdriver, HiOutlineServerStack,
  HiOutlineFingerPrint, HiOutlineCircleStack, HiOutlineBars3,
  HiOutlineSignal, HiOutlineUsers, HiOutlineDocumentMagnifyingGlass
} from "react-icons/hi2";
import { TbPlugConnected, TbBrandApple, TbBrandGooglePlay, TbGauge, TbColorSwatch, TbTargetArrow, TbActivity, TbAlertCircle, TbTemperature, TbDroplet, TbEngine } from "react-icons/tb";
import { BsLightningCharge, BsBattery, BsUsbSymbol, BsShieldLock, BsThermometer, BsSpeedometer } from "react-icons/bs";
import { MdOutlineRestartAlt, MdSignalCellularAlt, MdOutlineElectricalServices, MdOutlinePower } from "react-icons/md";

/* ── Parametre Tanımları ── */
const OCPP_WIFI = [
  { id: 1,  icon: <HiOutlineGlobeAlt />,       label: "OCPP URL" },
  { id: 2,  icon: <HiOutlineLink />,           label: "OCPP ID" },
  { id: 3,  icon: <HiOutlineQrCode />,         label: "QR Kod" },
  { id: 4,  icon: <HiOutlineBolt />,           label: "Maks. Güç" },
  { id: 5,  icon: <HiOutlineWifi />,           label: "WiFi SSID" },
  { id: 6,  icon: <HiOutlineLockClosed />,     label: "WiFi Şifre" },
  { id: 44, icon: <HiOutlineTag />,            label: "Box Seri No" },
];

const UI_PARAMS = [
  { id: 7,  icon: <TbPlugConnected />,         label: "Bağlantı Türü",
    type: "dropdown", options: [
      { value: "0", label: "CommSupported" },
      { value: "1", label: "GSM" },
      { value: "2", label: "WiFi" },
      { value: "3", label: "ETH" },
    ]},
  { id: 37, icon: <HiOutlineWifi />,           label: "Bağlantı Tipi", readOnly: true,
    dependsOn: 7, dependsValue: "0",
    depMessage: "Sadece Bağlantı Türü \"CommSupported\" iken okunabilir" },
  { id: 9,  icon: <HiOutlinePhone />,          label: "Şirket Tel", type: "phone" },
  { id: 10, icon: <HiOutlineGlobeAlt />,       label: "Site" },
  { id: 11, icon: <TbBrandApple />,            label: "Appstore" },
  { id: 12, icon: <TbBrandGooglePlay />,       label: "Play Store" },
  { id: 13, icon: <HiOutlinePhoto />,          label: "Logo / Yazı",
    type: "dropdown", options: [
      { value: "1", label: "Logo" },
      { value: "0", label: "Yazı" },
    ]},
  { id: 14, icon: <HiOutlineTag />,            label: "Şirket Adı", dependsOn: 13, dependsValue: "0" },
  { id: 35, icon: <TbColorSwatch />,           label: "Gradient/Renk",
    type: "dropdown", options: [
      { value: "0", label: "Gradient" },
      { value: "1", label: "Renk" },
    ]},
  { id: 36, icon: <TbTargetArrow />,           label: "Renk Seçimi",
    type: "color", dependsOn: 35, dependsValue: "1",
    depMessage: "Renk seçimi yapabilmek için lütfen Gradient seçmeyin" },
  // Tarama
  { id: 62, icon: <HiOutlineWifi />,           label: "Scan List" },
];

const MSP_CONFIG_BASE = [
  { id: 15, icon: <MdOutlineRestartAlt />,     label: "Cihaz Reset",
    isOneShot: true, color: "red", sendValue: "1", successMsg: "Cihaz resetlendi ✓",
    btnLabel: "Reset" },
];

const MSP_CONFIG_ADMIN = [
  { id: 16, icon: <TbGauge />,                 label: "AC Ölçer",
    type: "dropdown", options: [
      { value: "0", label: "MSP Hesaplama" },
      { value: "1", label: "AC Meter" },
    ]},
  { id: 17, icon: <HiOutlineAdjustmentsHorizontal />, label: "Konfig Modu",
    type: "dropdown", options: [
      { value: "0", label: "Ürün Modu" },
      { value: "1", label: "Test Modu" },
    ]},
  { id: 18, icon: <HiOutlineCpuChip />,        label: "Model",
    type: "dropdown", options: [
      { value: "0", label: "Kablosuz" },
      { value: "1", label: "Kablolu" },
    ]},
  { id: 69, icon: <HiOutlineCommandLine />,    label: "MSP Modu",
    type: "dropdown", options: [
      { value: "0", label: "Üretim Modu" },
      { value: "1", label: "Test Modu" },
    ]},
];

// MSP HW/SW Versiyonları — set + read (EditableRow ile render edilecek)
const MSP_VERSIONS = [
  { id: 60, icon: <HiOutlineCpuChip />,        label: "MSP HW Version" },
  { id: 61, icon: <HiOutlineCommandLine />,    label: "MSP SW Version" },
];

const OTA = [
  { id: 31, icon: <HiOutlineArrowUpTray />,    label: "OTA Update",
    type: "dropdown", options: [
      { value: "1", label: "ESP" },
      { value: "2", label: "MSP" },
    ]},
  { id: 32, icon: <HiOutlineKey />,            label: "OTA Key" },
  { id: 33, icon: <HiOutlineTag />,            label: "ESP Software Versiyon",
    type: "dropdown" },
  // ESP Hardware Versiyon — OTA Sunucu Kontrolü'ndeki firmware.json'da gerçekten var olan
  // versiyonlardan seçilir (bkz. espHwVersionOptions state'i), serbest metin değil.
  { id: 68, icon: <HiOutlineCpuChip />,        label: "ESP Hardware Versiyon",
    type: "dropdown" },
  // MSP HW/SW Versiyon — MSP Konfigürasyon sayfasındaki (id 60/61) ile AYNI değişken ID'leri,
  // yani değerler otomatik senkron — burada ayrıca yazılmıyor, tek kaynak MSP Konfigürasyon.
  { id: 60, icon: <HiOutlineCpuChip />,        label: "MSP Hardware Versiyon" },
  { id: 61, icon: <HiOutlineCommandLine />,    label: "MSP Software Versiyon" },
  { id: 20, icon: <MdOutlineRestartAlt />,     label: "Güncelleme Başlat",
    isOneShot: true, color: "red", sendValue: "1", successMsg: "Güncelleme başlatıldı ✓",
    btnLabel: "Başlat" },
  // Logo Yönetimi — seçenekler artık sabit değil, 85.105'teki gerçek logo dosyalarından
  // (bkz. OTA Sunucu Kontrolü'nde yüklenenler) dinamik olarak çekiliyor (bkz. logoOptions state'i)
  { id: 64, icon: <HiOutlinePhoto />,          label: "Logo Adı",
    type: "dropdown" },
  { id: 63, icon: <HiOutlineArrowPath />,      label: "Logo Güncelle",
    isOneShot: true, color: "blue", sendValue: "1", successMsg: "Logo aktifleştirildi ✓",
    btnLabel: "Activate" },
];

const ESP_CTRL = [
  { id: 19, icon: <HiOutlineCommandLine />,    label: "ESP Modu", isEditable: true,
    type: "dropdown", options: [
      { value: "0", label: "Plug & Charge" },
      { value: "1", label: "RFID Charge" },
      { value: "2", label: "OCPP Charge" },
    ]},
  { id: 38, icon: <HiOutlineGlobeAlt />,      label: "OCPP Aktif",  isToggle: true, color: "blue",
    toggleLabels: { off: "Deaktif", on: "Aktif" }},
  { id: 45, icon: <TbPlugConnected />,         label: "OCPP Bağlantı", isInfo: true, isReadable: true },
  { id: 8,  icon: <BsShieldLock />,            label: "Kilit Aç",
    isOneShot: true, color: "red", sendValue: "1", successMsg: "Kilit açıldı ✓",
    btnLabel: "Aç" },
  { id: 20, icon: <HiOutlineArrowPath />,      label: "ESP Reset",
    isOneShot: true, color: "red", sendValue: "1", successMsg: "ESP resetlendi ✓",
    btnLabel: "Reset" },
  { id: 21, icon: <HiOutlineStop />,           label: "Şarj Durdur",
    isOneShot: true, color: "red", sendValue: "1", successMsg: "Şarj durduruldu ✓",
    btnLabel: "Durdur" },
  { id: 33, icon: <HiOutlineTag />,              label: "ESP Software Versiyon", isInfo: true, isReadable: true },
  { id: 68, icon: <HiOutlineCpuChip />,          label: "ESP Hardware Versiyon", isEditable: true, adminEditOnly: true },
  { id: 66, icon: <HiOutlineArrowPath />,        label: "RFID Update",
    isOneShot: true, color: "blue", sendValue: "1", successMsg: "RFID aktifleştirildi ✓",
    btnLabel: "Aktifleştir" },
  { id: 67, icon: <HiOutlineWifi />,             label: "Aktif Main RFID", isInfo: true, isReadable: true },
];

const TELEMETRY = [
  { id: 22, icon: <HiOutlineClock />,          label: "Şarj Süresi",      unit: "dk" },
  { id: 23, icon: <BsLightningCharge />,       label: "Çıkış Gücü",       unit: "kW" },
  { id: 24, icon: <BsBattery />,               label: "Tüketilen Enerji",  unit: "kWh" },
  { id: 25, icon: <TbAlertCircle />,           label: "Durum" },
  { id: 34, icon: <MdSignalCellularAlt />,     label: "GSM Sinyal" },
  { id: 27, icon: <HiOutlineExclamationTriangle />, label: "Hata" },
  { id: 26, icon: <BsUsbSymbol />,             label: "UART" },
];

const MSP_TELEMETRY = [
  { id: 46, icon: <HiOutlineCog6Tooth />,      label: "Aktüatör",         unit: "" },
  { id: 47, icon: <TbTemperature />,            label: "Sıcaklık",         unit: "°C" },
  { id: 48, icon: <TbDroplet />,                label: "Kaçak Akım",       unit: "" },
  { id: 49, icon: <TbActivity />,               label: "MSP Durum",        unit: "" },
  { id: 51, icon: <BsSpeedometer />,            label: "CP Voltaj",        unit: "V" },
  { id: 52, icon: <MdOutlinePower />,           label: "Röle Çıkış",       unit: "" },
  { id: 53, icon: <MdOutlineElectricalServices />, label: "PWM",           unit: "" },
  { id: 54, icon: <BsLightningCharge />,        label: "L1 Voltaj",        unit: "V" },
  { id: 55, icon: <BsLightningCharge />,        label: "L1 Akım",          unit: "A" },
  { id: 56, icon: <BsLightningCharge />,        label: "L2 Voltaj",        unit: "V" },
  { id: 57, icon: <BsLightningCharge />,        label: "L2 Akım",          unit: "A" },
  { id: 58, icon: <BsLightningCharge />,        label: "L3 Voltaj",        unit: "V" },
  { id: 59, icon: <BsLightningCharge />,        label: "L3 Akım",          unit: "A" },
];

const OCPP_CREDS = [
  { id: 39, icon: <HiOutlineIdentification />,     label: "CP Vendor" },
  { id: 40, icon: <HiOutlineServerStack />,         label: "CP Model" },
  { id: 41, icon: <HiOutlineFingerPrint />,         label: "CP Seri No" },
  { id: 42, icon: <HiOutlineCircleStack />,         label: "Meter Seri No" },
  { id: 43, icon: <HiOutlineWrenchScrewdriver />,   label: "Meter Tipi" },
  { id: 44, icon: <HiOutlineTag />,                 label: "Box Seri No" },
];

/* ── Helpers ── */
function mapValue(id, raw) {
  if (raw === undefined || raw === null) return "——";
  const v = String(raw);
  if (id === 7) return ({ "0": "CommSupported", "1": "GSM", "2": "WiFi", "3": "ETH" })[v] || v;
  if (id === 13) return v === "0" ? "Yazı" : v === "1" ? "Logo" : v;
  if (id === 35) return v === "0" ? "Gradient" : v === "1" ? "Renk" : v;
  if (id === 27) return v === "0" ? "Hata Yok" : `Hata: ${v}`;
  if (id === 25) return ({ "0": "Beklemede", "1": "Şarj Oluyor", "2": "Tamamlandı" })[v] || v;
  if (id === 15) return v === "0" ? "Kapalı" : v === "1" ? "Aktif" : v;
  if (id === 16) return v === "0" ? "MSP Hesaplama" : v === "1" ? "AC Meter" : v;
  if (id === 17) return v === "0" ? "Ürün Modu" : v === "1" ? "Test Modu" : v;
  if (id === 18) return v === "0" ? "Kablosuz" : v === "1" ? "Kablolu" : v;
  if (id === 19) return ({ "0": "Plug & Charge", "1": "RFID Charge", "2": "OCPP Charge" })[v] || v;
  if (id === 69) return v === "0" ? "Üretim Modu" : v === "1" ? "Test Modu" : v;
  if (id === 37) return ({ "NONE": "Bağlı Değil", "GSM": "GSM", "WiFi": "WiFi", "ETH": "Ethernet" })[v] || v;
  if (id === 38) return v === "0" ? "Deaktif" : v === "1" ? "Aktif" : v;
  if (id === 45) return v === "0" ? "Kopuk" : v === "1" ? "Bağlı" : v;
  if (id === 46) return v === "0" ? "Kapalı" : v === "1" ? "Açık" : v;
  if (id === 48) return v === "0" ? "Yok" : v === "1" ? "Var ⚠️" : v;
  if (id === 52) return v === "0" ? "Kapalı" : v === "1" ? "Açık" : v;
  if (id === 53) return v === "0" ? "Pasif" : v === "1" ? "Aktif" : v;
  if (id === 64 || id === 65) return ({
    "acrapol_logo":  "Acrapol",
    "celikler_logo": "Çelikler",
    "ctg_logo":      "CTG",
    "sepas_logo":    "Sepas",
  })[v] || v;
  return v;
}
function csColor(raw) {
  const v = String(raw);
  return v === "0" ? "yellow" : v === "1" ? "green" : v === "2" ? "blue" : undefined;
}

/* ── Section tanımları — sidebar için ── */
const SECTIONS = [
  { key: "device-select", label: "Cihaz Sec", icon: <HiOutlineCpuChip /> },
  { key: "ocpp-wifi",    label: "OCPP & WiFi",       icon: <HiOutlineGlobeAlt /> },
  { key: "ui",           label: "Bağlantı & UI",     icon: <TbPlugConnected /> },
  { key: "msp-config",   label: "MSP Konfigürasyon", icon: <HiOutlineCog6Tooth /> },
  { key: "esp-ctrl",     label: "ESP Kontrol",       icon: <HiOutlineCpuChip /> },
  { key: "telemetry",    label: "Canlı Telemetri",   icon: <TbActivity />, badge: "LIVE" },
  { key: "msp-tele",     label: "MSP Telemetri",     icon: <HiOutlineSignal /> },
  { key: "ocpp-creds",   label: "OCPP Credentials",  icon: <HiOutlineIdentification /> },
  { key: "ota",          label: "OTA Güncelleme",    icon: <HiOutlineArrowUpTray />, superadminOnly: true, adminOnly: true },
  { key: "connections",  label: "Aktif Bağlantılar", icon: <HiOutlineSignal />, adminOnly: true },
  { key: "users",        label: "Kullanıcı Yönetimi", icon: <HiOutlineUsers />, superadminOnly: true, adminOnly: true },
  { key: "device-mgmt",  label: "Cihaz Yönetimi",    icon: <HiOutlineCpuChip />, superadminOnly: true, adminOnly: true },
  { key: "device-setup", label: "Cihaz Kurulum",    icon: <HiOutlineWrenchScrewdriver />, superadminOnly: true, adminOnly: true },
  { key: "bulk-update",  label: "Toplu Güncelleme", icon: <HiOutlineArrowUpTray />, superadminOnly: true, adminOnly: true },
  { key: "ota-server",   label: "OTA Sunucu Kontrolü", icon: <HiOutlineServerStack />, superadminOnly: true, adminOnly: true },
  { key: "device-versions", label: "Cihaz Versiyonları", icon: <HiOutlineDocumentMagnifyingGlass />, superadminOnly: true, adminOnly: true },
];

/* ── Main ── */
export default function Home({ token, onNavigate, onLogout, isAdmin = false }) {
  const authFetch = useCallback((url, options = {}) => {
    return fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        "Authorization": `Bearer ${token}`,
      },
    });
  }, [token]);

  const [espStatus, setEspStatus] = useState("unknown");
  const [isConnected, setIsConnected] = useState(false);
  // MAC adresi — F5 sonrası input'ta görünsün diye localStorage'da tutulur
  // ama isConnected restore EDİLMEZ — kullanıcı her seferinde BAĞLAN'a bassın
  const [mac, setMac] = useState(() => {
    try { return window.localStorage?.getItem("bluetech-mac") || ""; }
    catch { return ""; }
  });
  useEffect(() => {
    try { window.localStorage?.setItem("bluetech-mac", mac); }
    catch {}
  }, [mac]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [readValues, setReadValues] = useState({});
  const [setOkMap, setSetOkMap] = useState({});
  const [oneShotOk, setOneShotOk] = useState({});
  const [oneShotLoading, setOneShotLoading] = useState({});
  const [readLoading, setReadLoading] = useState({});
  const [readFeedback, setReadFeedback] = useState({});
  const isActive = isConnected && espStatus === "active";

  // ── OTA sunucusundaki gerçek logo dosyalarını "Logo Adı" dropdown'ı için çek ──
  // Sabit/elle yazılan liste yerine, OTA Sunucu Kontrolü'nde yüklenen logolar ne ise onlar gösterilir.
  const [logoOptions, setLogoOptions] = useState([]);
  const [espSwVersionOptions, setEspSwVersionOptions] = useState([]);
  const [espHwVersionOptions, setEspHwVersionOptions] = useState([]);
  useEffect(() => {
    authFetch("/api/ota-server/list")
      .then((r) => r.json())
      .then((d) => {
        const opts = (d.logos || [])
          .map((f) => f.name.replace(/\.bin$/i, ""))
          .map((val) => ({ value: val, label: val.replace(/_logo$/i, "").replace(/_/g, " ") }));
        setLogoOptions(opts);
      })
      .catch(() => {});

    // OTA Sunucu Kontrolü'ndeki firmware.json'da gerçekten var olan versiyonlar/hw'ler —
    // software (v@4.0.4 gibi) ve hardware (13, 31, 61 gibi) ayrı listeler
    authFetch("/api/ota-server/firmware-versions")
      .then((r) => r.json())
      .then((d) => {
        setEspSwVersionOptions((d.espVersions || []).map((v) => ({ value: v, label: v })));
        setEspHwVersionOptions((d.espHardware || []).map((v) => ({ value: v, label: v })));
      })
      .catch(() => {});
  }, [authFetch]);

  /* ── Sidebar / UI state ── */
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "dark";
    try { return window.localStorage?.getItem("bluetech-theme") || "dark"; } catch { return "dark"; }
  });
  const [activeSection, setActiveSection] = useState("device-select");
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);

  // Mevcut kullanıcı bilgisi — /api/me ile çekilir
  const [currentUser, setCurrentUser] = useState(null); // { username, fullName, role }
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await authFetch("/api/me");
        if (!r.ok) return;
        const data = await r.json();
        if (!cancelled) setCurrentUser(data);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [authFetch]);

  /* ── Operatör cihaz seçimi ──
     Operatörlere /api/devices MAC göndermiyor (backend siliyor), bu yüzden
     serbest MAC girişi yerine cihaz listesinden seçim yapılır ve backend'e
     deviceId gönderilir — MAC'i backend çözer. */
  const isOperator = currentUser?.role === "operator";
  const [myDevices, setMyDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [connectedLabel, setConnectedLabel] = useState("");

  useEffect(() => {
    if (!isOperator) return;
    authFetch("/api/devices")
      .then((r) => r.json())
      .then((d) => setMyDevices(d.devices || []))
      .catch(() => {});
  }, [isOperator, authFetch]);

  // Çoklu kullanıcı — aynı MAC'e bağlı diğer kullanıcılar + deactivate uyarısı
  const [otherUsersOnSameMac, setOtherUsersOnSameMac] = useState([]); // [{ username, fullName }]
  const [deactivatedByModal, setDeactivatedByModal] = useState(null); // string | null


  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("theme-dark", "theme-light");
    root.classList.add(theme === "dark" ? "theme-dark" : "theme-light");
    try { window.localStorage?.setItem("bluetech-theme", theme); } catch {}
  }, [theme]);

  const visibleSections = useMemo(
    () => SECTIONS.filter((s) => {
      if (s.adminOnly && !isAdmin) return false;
      if (s.superadminOnly && currentUser?.role !== "superadmin") return false;
      return true;
    }),
    [isAdmin, currentUser]
  );

  // Dashboard/Panel arası geçişte, o an açık olan bölüm artık sidebar'da görünmüyorsa
  // (örn. Panel'e özel bir sayfadaydık, Dashboard'a geçtik) güvenli bir varsayılana dön
  useEffect(() => {
    if (activeSection === "device-select") return; // bu her zaman görünür, dokunma
    const stillVisible = visibleSections.some((s) => s.key === activeSection);
    if (!stillVisible) setActiveSection("ocpp-wifi");
  }, [visibleSections, activeSection]);

  useEffect(() => {
    if (!isActive) return;
    const readOcppState = async () => {
      try {
        await authFetch("/api/send-command", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "read", variable: 38, value: "" }),
        });
      } catch {}
    };
    readOcppState();
  }, [isActive, authFetch]);

  useEffect(() => {
    if (!isConnected) { setEspStatus("unknown"); return; }
    const f = async () => {
      try {
        const r = await authFetch("/api/get-status");
        const d = await r.json();
        setEspStatus(d.espState);
        if (d.timedOut) { setIsConnected(false); setMessage("10dk inaktivite — bağlantı kesildi."); }
        // Başkası deaktif etti uyarısı
        if (d.deactivatedBy && !deactivatedByModal) {
          setDeactivatedByModal(d.deactivatedBy);
        }
      } catch { setEspStatus("nonactive"); }
    };
    f(); const iv = setInterval(f, 3000);
    return () => clearInterval(iv);
  }, [isConnected, authFetch, deactivatedByModal]);

  // Aynı MAC'e bağlı diğer kullanıcılar — 5sn'de bir
  useEffect(() => {
    if (!isConnected) { setOtherUsersOnSameMac([]); return; }
    const f = async () => {
      try {
        const r = await authFetch("/api/connections");
        if (!r.ok) return;
        const j = await r.json();
        const others = (j.connections || []).filter((c) => c.sameMac);
        setOtherUsersOnSameMac(others);
      } catch {}
    };
    f(); const iv = setInterval(f, 5000);
    return () => clearInterval(iv);
  }, [isConnected, authFetch]);

  // Modal kapatma — backend bayrağını da temizle
  const ackDeactivatedBy = useCallback(async () => {
    setDeactivatedByModal(null);
    setIsConnected(false); // bağlantı zaten kopmuş
    setEspStatus("nonactive");
    try {
      await authFetch("/api/ack-deactivated", { method: "POST" });
    } catch {}
  }, [authFetch]);


  useEffect(() => {
    if (!isConnected) return;
    const f = () => authFetch("/api/keepalive", { method: "POST", headers: { "Content-Type": "application/json" } }).catch(() => {});
    f(); const iv = setInterval(f, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [isConnected, authFetch]);

  useEffect(() => {
    if (!isConnected) { setReadValues({}); setSetOkMap({}); return; }
    const f = async () => {
      try {
        const r = await authFetch("/api/responses");
        const j = await r.json();
        const ok = {}, rv = {};

        const msgs = j.message_response || [];
        const now = Date.now();
        msgs.forEach((entry) => {
          if (!entry) return;
          const cmd = Number(entry.cmd);
          const msg = Number(entry.msg);
          const data = entry.data;

          if (data === "SET OK") ok[msg] = true;

          if (cmd === 2 && data !== undefined && data !== null) {
            const pending = pendingSetsRef.current[msg];
            if (pending && now < pending.until && String(data) !== pending.value) {
              // Bu, az önce set ettiğimiz değerle çelişen bir okuma cevabı — muhtemelen
              // set'ten ÖNCE atılmış eski bir okumanın MQTT üzerinden geç gelen cevabı.
              // Görmezden geliyoruz, yoksa az önce ayarladığımız değerin üzerine yazar.
              return;
            }
            if (pending && String(data) === pending.value) {
              delete pendingSetsRef.current[msg]; // gerçek onay geldi, koruma penceresine artık gerek yok
            }
            rv[msg] = data;
          }
        });

        setSetOkMap((prev) => ({ ...prev, ...ok }));
        setReadValues((prev) => ({ ...prev, ...rv }));
      } catch (e) {
        console.error("[POLL] Hata:", e);
      }
    };
    f(); const iv = setInterval(f, 1000);
    return () => clearInterval(iv);
  }, [isConnected, authFetch]);

  // Bir "set" yapıldıktan sonra, o değişkene KISA BİR SÜRE içinde gelen ÇELİŞKİLİ bir
  // "read" cevabı gelirse (muhtemelen set'ten önce atılmış eski/gecikmiş bir okumanın
  // MQTT üzerinden geç gelen cevabı), bunu görmezden geliyoruz — yoksa tek mesaj slotu
  // mimarisinde bu eski cevap, az önce set ettiğimiz değerin üzerine geçici olarak yazabiliyor.
  const pendingSetsRef = useRef({}); // { [variableId]: { value: string, until: number } }
  const SET_GRACE_MS = 4000;

  const sendCommand = useCallback(async (type, variable, value = "") => {
    if (!isActive) { setMessage("ESP aktif değil"); return false; }

    // Read komutu atılırken eski değeri hemen sil — böylece yeni değer gelene kadar
    // ekranda "—" görünür, eski/bayat değerle yeni okunan değer karışmaz
    if (type === "read") {
      setReadValues((prev) => {
        const next = { ...prev };
        delete next[variable];
        return next;
      });
    }

    try {
      const r = await authFetch("/api/send-command", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, variable, value }),
      });
      const d = await r.json();
      if (!r.ok) { setMessage(d.message || "Hata"); return false; }

      if (type === "set" && value !== undefined && value !== null) {
        setReadValues((prev) => ({ ...prev, [variable]: String(value) }));
        pendingSetsRef.current[variable] = { value: String(value), until: Date.now() + SET_GRACE_MS };
      }

      setMessage(type === "set" ? "Değer gönderildi…" : "Okunuyor…");
      setTimeout(() => setMessage(""), 3000);
      return true;
    } catch { setMessage("Sunucuya ulaşılamadı"); return false; }
  }, [isActive, authFetch]);

  const fireOneShot = useCallback(async (id, value, successMsg) => {
    if (!isActive) return;
    setOneShotOk((prev) => ({ ...prev, [id]: null }));
    setOneShotLoading((prev) => ({ ...prev, [id]: true }));

    const ok = await sendCommand("set", id, value);
    if (!ok) { setOneShotLoading((prev) => ({ ...prev, [id]: false })); return; }

    let success = false;
    for (let retry = 0; retry < 3; retry++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const resp = await authFetch("/api/responses");
        const j = await resp.json();
        const msgs = j.message_response || [];
        const found = msgs.find((m) => Number(m.msg) === id && m.data === "SET OK");
        if (found) { success = true; break; }
      } catch {}
    }

    setOneShotLoading((prev) => ({ ...prev, [id]: false }));
    if (success) {
      setOneShotOk((prev) => ({ ...prev, [id]: successMsg }));
      setTimeout(() => setOneShotOk((prev) => ({ ...prev, [id]: null })), 4000);
    } else {
      setOneShotOk((prev) => ({ ...prev, [id]: "Yanıt alınamadı ✕" }));
      setTimeout(() => setOneShotOk((prev) => ({ ...prev, [id]: null })), 4000);
    }
  }, [isActive, sendCommand, authFetch]);

  const fireRead = useCallback(async (id) => {
    if (!isActive) {
      setReadFeedback((prev) => ({ ...prev, [id]: "ESP aktif değil ✕" }));
      setTimeout(() => setReadFeedback((prev) => ({ ...prev, [id]: null })), 4000);
      return;
    }
    setReadFeedback((prev) => ({ ...prev, [id]: null }));
    setReadLoading((prev) => ({ ...prev, [id]: true }));

    // Eski değeri hemen sil — yeni okunan değerle eski/bayat değer karışmasın
    setReadValues((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

    let sent = false;
    try {
      const r = await authFetch("/api/send-command", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "read", variable: id, value: "" }),
      });
      if (r.ok) sent = true;
    } catch {}

    if (!sent) {
      setReadLoading((prev) => ({ ...prev, [id]: false }));
      setReadFeedback((prev) => ({ ...prev, [id]: "Gönderilemedi ✕" }));
      setTimeout(() => setReadFeedback((prev) => ({ ...prev, [id]: null })), 4000);
      return;
    }

    let success = false;
    for (let retry = 0; retry < 4; retry++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const resp = await authFetch("/api/responses");
        const j = await resp.json();
        const msgs = j.message_response || [];
        const found = msgs.find((m) => Number(m.cmd) === 2 && Number(m.msg) === id);
        if (found && found.data !== undefined && found.data !== null) {
          setReadValues((prev) => ({ ...prev, [id]: found.data }));
          success = true;
          break;
        }
      } catch {}
    }

    setReadLoading((prev) => ({ ...prev, [id]: false }));
    if (!success) {
      setReadFeedback((prev) => ({ ...prev, [id]: "Yanıt alınamadı ✕" }));
      setTimeout(() => setReadFeedback((prev) => ({ ...prev, [id]: null })), 4000);
    }
  }, [isActive, authFetch]);

  const handleSubmit = async (e, force = false) => {
    e?.preventDefault?.(); setMessage("");

    if (isOperator && !selectedDeviceId) {
      setMessage("Önce bir cihaz seçin");
      setTimeout(() => setMessage(""), 3000);
      return;
    }

    setLoading(true);
    try {
      const body = isOperator ? { deviceId: selectedDeviceId, force } : { newTarget: mac, force };
      const r = await authFetch("/api/update-target", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();

      // Cihaz başka bir kullanıcıda meşgul — sadece superadmin devralabilir.
      if (!r.ok && r.status === 409 && d.code === "DEVICE_OCCUPIED" && currentUser?.role === "superadmin") {
        setLoading(false);
        if (window.confirm(`Bu cihaz şu anda ${d.occupiedBy} tarafından kullanılıyor.\n\nBağlantısını keserek devralmak istiyor musunuz?`)) {
          handleSubmit(null, true);
        }
        return;
      }

      if (!r.ok) { setMessage(d.error || "Hata"); setIsConnected(false); }
      else {
        setMessage("");
        setIsConnected(true);
        if (isOperator) {
          const dev = myDevices.find((x) => String(x.id) === String(selectedDeviceId));
          setConnectedLabel(dev ? (dev.location || dev.device_code || `#${dev.id}`) : "Cihaz");
        } else {
          setConnectedLabel(mac);
        }
      }
    } catch { setMessage("Sunucuya ulaşılamadı"); setIsConnected(false); }
    finally { setLoading(false); }
  };

  const handleDisconnect = async () => {
    try {
      await authFetch("/api/disconnect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newTarget: mac }),
      });
    } catch {}
    setIsConnected(false);
    setEspStatus("unknown");
    setReadValues({});
    setSetOkMap({});
    setFailedReads({});
    setOneShotOk({});
    setOneShotLoading({});
    setReadLoading({});
    setReadFeedback({});
    setMessage("Bağlantı koparıldı.");
    setTimeout(() => setMessage(""), 3000);
  };

  const badge = (() => {
    if (!isConnected) return { t: "Bağlantı Yok", c: "border-[var(--border-subtle)] text-[var(--text-muted)] bg-[var(--bg-subtle)]", d: "bg-[var(--text-muted)]" };
    if (espStatus === "active") return { t: "Çevrimiçi", c: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400", d: "bg-emerald-400 animate-pulse" };
    if (espStatus === "unknown") return { t: "Bekleniyor…", c: "bg-amber-500/10 border-amber-500/30 text-amber-400", d: "bg-amber-400 animate-pulse" };
    return { t: "Çevrimdışı", c: "bg-rose-500/10 border-rose-500/30 text-rose-400", d: "bg-rose-400" };
  })();

  const V = (id) => mapValue(id, readValues[id]);

  /* ── Toplu Read / Set state'leri ── */
  const [batchReadingId, setBatchReadingId] = useState(null);
  const [batchProgress, setBatchProgress] = useState("");
  const [failedReads, setFailedReads] = useState({});

  const batchRead = async (params, panelId) => {
    if (!isActive || batchReadingId) return;
    setBatchReadingId(panelId);
    const failed = {};

    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      setBatchProgress(`${p.label} okunuyor… (${i + 1}/${params.length})`);

      await sendCommand("read", p.id);
      await new Promise((r) => setTimeout(r, 500));

      let success = false;
      for (let retry = 0; retry < 2; retry++) {
        try {
          const resp = await authFetch("/api/responses");
          const j = await resp.json();
          const msgs = j.message_response || [];
          const found = msgs.find((m) => Number(m.cmd) === 2 && Number(m.msg) === p.id);
          if (found && found.data !== undefined && found.data !== null) {
            setReadValues((prev) => ({ ...prev, [p.id]: found.data }));
            success = true;
            break;
          }
        } catch {}
        if (retry === 0) await new Promise((r) => setTimeout(r, 500));
      }

      failed[p.id] = !success;
    }

    setFailedReads((prev) => ({ ...prev, ...failed }));

    const failCount = Object.values(failed).filter(Boolean).length;
    setBatchProgress("");
    setBatchReadingId(null);

    if (failCount > 0) setMessage(`${params.length - failCount} değer okundu, ${failCount} değer okunamadı ⚠️`);
    else setMessage("Tüm değerler okundu ✓");
    setTimeout(() => setMessage(""), 4000);
  };

  const [bulkEditingId, setBulkEditingId] = useState(null);
  const [bulkDrafts, setBulkDrafts] = useState({});
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkProgress, setBulkProgress] = useState("");
  const [failedSets, setFailedSets] = useState({});

  const startBulkEdit = (params, panelId) => {
    if (!isActive || bulkSaving) return;
    const drafts = {};
    params.forEach((p) => {
      const v = readValues[p.id];
      drafts[p.id] = (v !== undefined && v !== null && v !== "——") ? String(v) : "";
    });
    setBulkDrafts(drafts);
    setBulkEditingId(panelId);
    setFailedSets({});
  };

  const cancelBulkEdit = () => {
    setBulkEditingId(null);
    setBulkDrafts({});
  };

  const updateBulkDraft = (id, value) => {
    setBulkDrafts((prev) => ({ ...prev, [id]: value }));
  };

  const batchSet = async (params, panelId) => {
    if (!isActive || bulkSaving) return;
    setBulkSaving(true);
    const failed = {};

    const toSend = params.filter((p) => {
      const draft = bulkDrafts[p.id] ?? "";
      return draft !== "";
    });

    for (let i = 0; i < toSend.length; i++) {
      const p = toSend[i];
      const val = bulkDrafts[p.id];
      setBulkProgress(`${p.label} kaydediliyor… (${i + 1}/${toSend.length})`);

      await sendCommand("set", p.id, val);
      await new Promise((r) => setTimeout(r, 500));

      let success = false;
      for (let retry = 0; retry < 2; retry++) {
        try {
          const resp = await authFetch("/api/responses");
          const j = await resp.json();
          const msgs = j.message_response || [];
          const found = msgs.find((m) => Number(m.msg) === p.id && m.data === "SET OK");
          if (found) {
            success = true;
            setSetOkMap((prev) => ({ ...prev, [p.id]: true }));
            break;
          }
        } catch {}
        if (retry === 0) await new Promise((r) => setTimeout(r, 500));
      }

      failed[p.id] = !success;
    }

    const failedItems = toSend.filter((p) => failed[p.id]);

    if (failedItems.length > 0) {
      setBulkProgress(`${failedItems.map((p) => p.label).join(", ")} kaydedilemedi, tekrar deneniyor…`);
      setFailedSets((prev) => {
        const updated = { ...prev };
        failedItems.forEach((p) => { updated[p.id] = true; });
        return updated;
      });

      await new Promise((r) => setTimeout(r, 600));

      for (let i = 0; i < failedItems.length; i++) {
        const p = failedItems[i];
        const val = bulkDrafts[p.id];
        setBulkProgress(`${p.label} tekrar kaydediliyor… (${i + 1}/${failedItems.length})`);

        await sendCommand("set", p.id, val);
        await new Promise((r) => setTimeout(r, 1000));

        let success = false;
        for (let retry = 0; retry < 3; retry++) {
          try {
            const resp = await authFetch("/api/responses");
            const j = await resp.json();
            const msgs = j.message_response || [];
            const found = msgs.find((m) => Number(m.msg) === p.id && m.data === "SET OK");
            if (found) {
              success = true;
              setSetOkMap((prev) => ({ ...prev, [p.id]: true }));
              break;
            }
          } catch {}
          if (retry < 2) await new Promise((r) => setTimeout(r, 500));
        }

        failed[p.id] = !success;
      }
    }

    setFailedSets((prev) => ({ ...prev, ...failed }));

    const successValues = {};
    toSend.forEach((p) => {
      if (!failed[p.id]) successValues[p.id] = bulkDrafts[p.id];
    });
    setReadValues((prev) => ({ ...prev, ...successValues }));

    const finalFailCount = Object.values(failed).filter(Boolean).length;
    const retried = failedItems.length > 0;
    setBulkProgress("");
    setBulkSaving(false);
    setBulkEditingId(null);
    setBulkDrafts({});

    if (finalFailCount > 0) {
      const stillFailedNames = toSend.filter((p) => failed[p.id]).map((p) => p.label).join(", ");
      setMessage(`${toSend.length - finalFailCount} değer kaydedildi, ${stillFailedNames} kaydedilemedi ⚠️`);
    } else if (retried) {
      setMessage(`${toSend.length} değer kaydedildi (${failedItems.length} tanesi tekrar denemede başarılı) ✓`);
    } else {
      setMessage(`${toSend.length} değer başarıyla kaydedildi ✓`);
    }
    setTimeout(() => setMessage(""), 5000);
  };

  /* ──────────────────────────── */
  /* ── Section Renderers ── */
  /* ──────────────────────────── */

  const BatchControls = ({ params, panelId, showBulk = true }) => {
    const progressMsg =
      (batchReadingId === panelId && batchProgress) ? batchProgress :
      (bulkSaving && bulkProgress && bulkEditingId === panelId) ? bulkProgress : "";
    return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-4 mt-3 border-t border-[var(--border-subtle)]">
      <span className="text-[11px] text-[var(--accent)] font-medium animate-pulse font-mono min-h-[16px] truncate"
        style={{ visibility: progressMsg ? 'visible' : 'hidden' }}>
        {progressMsg || " "}
      </span>

      <div className="flex items-center gap-2">
        {showBulk && (bulkEditingId === panelId ? (
          <>
            <button onClick={cancelBulkEdit}
              className="text-[10px] font-semibold px-2.5 py-[5px] rounded-md
                         bg-[var(--bg-subtle)] text-[var(--text-muted)] border border-[var(--border-subtle)]
                         hover:text-[var(--text-primary)] transition cursor-pointer tracking-wide uppercase">
              İptal
            </button>
            <button onClick={() => batchSet(params, panelId)}
              disabled={!isActive || bulkSaving}
              className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-[5px] rounded-md border transition tracking-wide uppercase
                ${(!isActive || bulkSaving)
                  ? "bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
                  : "bg-emerald-500 text-white border-emerald-400 hover:bg-emerald-400 shadow-sm shadow-emerald-500/30 cursor-pointer"
                }`}>
              <HiOutlinePencilSquare className={`text-[12px] ${bulkSaving ? "animate-spin" : ""}`} />
              {bulkSaving ? "Kaydediliyor…" : "Tümünü Kaydet"}
            </button>
          </>
        ) : (
          <button onClick={() => startBulkEdit(params, panelId)}
            disabled={!isActive || !!bulkEditingId || !!batchReadingId || bulkSaving}
            className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-[5px] rounded-md border transition tracking-wide uppercase
              ${(!isActive || !!bulkEditingId || !!batchReadingId || bulkSaving)
                ? "bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
                : "bg-amber-500/10 text-amber-500 border-amber-500/30 hover:bg-amber-500/20 cursor-pointer"
              }`}>
            <HiOutlinePencilSquare className="text-[12px]" />
            Toplu Edit
          </button>
        ))}

        <button onClick={() => batchRead(params, panelId)}
          disabled={!isActive || !!batchReadingId || !!bulkEditingId || bulkSaving}
          className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-[5px] rounded-md border transition tracking-wide uppercase
            ${(!isActive || !!batchReadingId || !!bulkEditingId || bulkSaving)
              ? "bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
              : "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-border)] hover:bg-[var(--accent-soft-hover)] cursor-pointer"
            }`}>
          <HiOutlineArrowPath className={`text-[12px] ${batchReadingId === panelId ? "animate-spin" : ""}`} />
          {batchReadingId === panelId ? "Okunuyor…" : "Tümünü Oku"}
        </button>
      </div>
    </div>
    );
  };

  const SectionHeader = ({ icon, title, subtitle }) => (
    <div className="mb-5 pb-4 border-b border-[var(--border-subtle)]">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[var(--accent-soft)] border border-[var(--accent-border)] flex items-center justify-center text-[var(--accent)] text-[18px] shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <h2 className="text-[17px] font-bold text-[var(--text-primary)] font-display tracking-tight leading-tight">
            {title}
          </h2>
          {subtitle && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{subtitle}</p>}
        </div>
      </div>
    </div>
  );

  const renderOcppWifi = () => (
    <>
      <SectionHeader icon={<HiOutlineGlobeAlt />} title="OCPP & WiFi Ayarları" subtitle="OCPP endpoint ve kablosuz ağ konfigürasyonu" />
      <div className="px-1">
        {OCPP_WIFI.map((p, i) => (
          <EditableRow key={p.id} icon={p.icon} label={p.label} id={p.id}
            value={V(p.id)} setOk={setOkMap[p.id]} disabled={!isActive}
            failed={failedReads[p.id]} setFailed={failedSets[p.id]}
            bulkEditing={bulkEditingId === "ocpp"}
            bulkDraft={bulkDrafts[p.id] ?? ""} onBulkDraftChange={updateBulkDraft}
            onSet={(id, val) => sendCommand("set", id, val)}
            onRead={(id) => { setFailedReads((prev) => ({ ...prev, [id]: false })); sendCommand("read", id); }}
            last={i === OCPP_WIFI.length - 1} />
        ))}
      </div>
      <BatchControls params={OCPP_WIFI} panelId="ocpp" />
    </>
  );

  const renderUI = () => (
    <>
      <SectionHeader icon={<TbPlugConnected />} title="Bağlantı & UI Ayarları" subtitle="İstasyon görünümü ve haberleşme tercihleri" />
      <div className="px-1">
        {UI_PARAMS.map((p, i) => {
          let depDisabled = false;
          if (p.dependsOn !== undefined) {
            const parentVal = bulkEditingId === "ui"
              ? (bulkDrafts[p.dependsOn] ?? String(readValues[p.dependsOn] ?? ""))
              : String(readValues[p.dependsOn] ?? "");
            depDisabled = parentVal !== p.dependsValue;
          }

          return (
            <EditableRow key={p.id} icon={p.icon} label={p.label} id={p.id}
              value={V(p.id)} setOk={setOkMap[p.id]}
              disabled={!isActive || depDisabled}
              depDisabled={depDisabled} depMessage={p.depMessage}
              failed={failedReads[p.id]} setFailed={failedSets[p.id]}
              inputType={p.type} options={p.options} allowCustom={p.allowCustom} readOnly={p.readOnly}
              bulkEditing={bulkEditingId === "ui" && !depDisabled}
              bulkDraft={bulkDrafts[p.id] ?? ""} onBulkDraftChange={updateBulkDraft}
              onSet={(id, val) => sendCommand("set", id, val)}
              onRead={(id) => { setFailedReads((prev) => ({ ...prev, [id]: false })); sendCommand("read", id); }}
              last={false} />
          );
        })}

      </div>
      <BatchControls params={UI_PARAMS} panelId="ui" />
    </>
  );

  const renderMspConfig = () => {
    const items = [...MSP_CONFIG_BASE, ...(isAdmin ? MSP_CONFIG_ADMIN : [])];
    const oneShotItems = items.filter((p) => p.isOneShot);
    const dropdownItems = items.filter((p) => !p.isOneShot);

    return (
      <>
        <SectionHeader icon={<HiOutlineCog6Tooth />} title="MSP Konfigürasyon"
          subtitle={isAdmin ? "Cihaz modu, ölçüm ayarları ve reset" : "Cihaz reset kontrolü"} />

        {oneShotItems.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mb-4">
            {oneShotItems.map((p) => {
              const isLoading = oneShotLoading[p.id];
              const okMsg = oneShotOk[p.id];
              const isFail = okMsg && okMsg.includes("✕");
              return (
                <div key={p.id} className="flex flex-col gap-1.5 w-full px-3.5 py-2.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] text-[var(--text-muted)] shrink-0">{p.icon}</span>
                    <span className="text-[12px] text-[var(--text-secondary)] font-medium flex-1 text-left">{p.label}</span>
                    <button
                      disabled={!isActive || isLoading}
                      onClick={() => fireOneShot(p.id, p.sendValue || "1", p.successMsg)}
                      className={`text-[10px] font-bold px-3 py-[4px] rounded-md border transition tracking-wide uppercase
                        ${(!isActive || isLoading)
                          ? "bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
                          : "bg-rose-500/10 text-rose-500 border-rose-500/30 hover:bg-rose-500/20 cursor-pointer"
                        }`}
                    >
                      {isLoading ? "Bekleniyor…" : (p.btnLabel || "Gönder")}
                    </button>
                  </div>
                  {okMsg && (
                    <span className={`text-[10px] font-medium pl-6 font-mono ${isFail ? "text-rose-400" : "text-emerald-400"}`}>
                      {okMsg}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* AC Ölçer / Konfig Modu / Model / ESP Modu — "Bağlantı & UI Ayarları" ile birebir aynı, tam genişlik liste */}
        {dropdownItems.length > 0 && (
          <div className="px-1">
            {dropdownItems.map((p, i) => (
              <EditableRow key={p.id} icon={p.icon} label={p.label} id={p.id}
                value={V(p.id)} setOk={setOkMap[p.id]} disabled={!isActive}
                failed={failedReads[p.id]} setFailed={failedSets[p.id]}
                inputType={p.type} options={p.options}
                onSet={(id, val) => sendCommand("set", id, val)}
                onRead={(id) => { setFailedReads((prev) => ({ ...prev, [id]: false })); sendCommand("read", id); }}
                last={i === dropdownItems.length - 1} />
            ))}
          </div>
        )}

        {/* MSP HW/SW Version — set + read, sadece admin */}
        {isAdmin && (
          <div className="mt-5 pt-4 border-t border-[var(--border-subtle)]">
            <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-[var(--text-muted)] mb-2 px-1">
              Donanım & Yazılım
            </div>
            <div className="px-1">
              {MSP_VERSIONS.map((p, i) => (
                <EditableRow key={p.id} icon={p.icon} label={p.label} id={p.id}
                  value={V(p.id)} setOk={setOkMap[p.id]} disabled={!isActive}
                  failed={failedReads[p.id]} setFailed={failedSets[p.id]}
                  bulkEditing={bulkEditingId === "msp-ver"}
                  bulkDraft={bulkDrafts[p.id] ?? ""} onBulkDraftChange={updateBulkDraft}
                  onSet={(id, val) => sendCommand("set", id, val)}
                  onRead={(id) => { setFailedReads((prev) => ({ ...prev, [id]: false })); sendCommand("read", id); }}
                  last={i === MSP_VERSIONS.length - 1} />
              ))}
            </div>
            <BatchControls params={MSP_VERSIONS} panelId="msp-ver" />
          </div>
        )}
      </>
    );
  };

  const renderEspCtrl = () => {
    const isPlugAndCharge = String(readValues[19] ?? "") === "0";
    const visibleEspCtrl = ESP_CTRL.filter((p) => {
      if (p.id === 19 && !isAdmin) return false; // ESP Modu sadece Panel'de (Dashboard'da gizli)
      if ((p.id === 66 || p.id === 67) && !isPlugAndCharge) return false; // sadece "Plug & Charge" iken
      return true;
    });

    return (
    <>
      <SectionHeader icon={<HiOutlineCpuChip />} title="ESP Kontrol" subtitle="Anlık cihaz kontrolü ve ağ bağlantı durumu" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {visibleEspCtrl.map((p) => {
          const curVal = String(readValues[p.id] ?? "0");

          if (p.isInfo) {
            const isRdLoading = readLoading[p.id];
            const rdFb = readFeedback[p.id];
            const rdFail = rdFb && rdFb.includes("✕");
            return (
              <div key={p.id} className="flex flex-col gap-1 px-3.5 py-2.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] text-[var(--text-muted)]">{p.icon}</span>
                  <span className="text-[12px] text-[var(--text-muted)]">{p.label}:</span>
                  <span className="text-[12px] text-[var(--text-primary)] font-semibold flex-1 font-mono">{V(p.id)}</span>
                  {p.isReadable && (
                    <button
                      onClick={() => fireRead(p.id)}
                      disabled={!isActive || isRdLoading}
                      className={`p-[4px] rounded-md border transition shrink-0
                        ${(!isActive || isRdLoading)
                          ? "bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
                          : "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-border)] hover:bg-[var(--accent-soft-hover)] cursor-pointer"
                        }`}
                    >
                      <HiOutlineArrowPath className={`text-[11px] ${isRdLoading ? "animate-spin" : ""}`} />
                    </button>
                  )}
                </div>
                {rdFb && (
                  <span className={`text-[10px] font-medium pl-6 font-mono ${rdFail ? "text-rose-400" : "text-emerald-400"}`}>
                    {rdFb}
                  </span>
                )}
              </div>
            );
          }

          if (p.isToggle) {
            const isOn = curVal === "1";
            const lblOff = p.toggleLabels?.off || "Kapalı";
            const lblOn  = p.toggleLabels?.on  || "Aktif";
            return (
              <button key={p.id}
                disabled={!isActive}
                onClick={() => {
                  const next = isOn ? "0" : "1";
                  if (p.id === 38 && next === "0") {
                    if (!window.confirm("OCPP bağlantısı kopacak!\nResetlediğiniz anda tekrar bağlantı olmaz.\n\nDevam etmek istiyor musunuz?")) return;
                  }
                  sendCommand("set", p.id, next);
                  setReadValues((prev) => ({ ...prev, [p.id]: next }));
                }}
                className={`flex items-center gap-2 w-full px-3.5 py-2.5 rounded-lg border transition-all duration-150
                  ${!isActive ? "opacity-50 cursor-not-allowed bg-[var(--bg-subtle)] border-[var(--border-subtle)]" :
                    "hover:bg-[var(--bg-hover)] cursor-pointer bg-[var(--bg-subtle)] border-[var(--border-subtle)]"}`}
              >
                <span className="text-[14px] text-[var(--text-muted)] shrink-0">{p.icon}</span>
                <span className="text-[12px] text-[var(--text-secondary)] font-medium flex-1 text-left">{p.label}</span>
                <span className={`text-[9px] font-bold mr-1 tracking-wider uppercase ${isOn ? "text-emerald-400" : "text-[var(--text-muted)]"}`}>
                  {isOn ? lblOn : lblOff}
                </span>
                <div className={`relative w-9 h-[20px] rounded-full transition-colors duration-200
                  ${isOn ? (p.color === "blue" ? "bg-[var(--accent)]" : "bg-emerald-500") : "bg-[var(--border-subtle)]"}`}>
                  <div className={`absolute top-[2px] w-[16px] h-[16px] rounded-full bg-white shadow transition-all duration-200
                    ${isOn ? "left-[21px]" : "left-[2px]"}`} />
                </div>
              </button>
            );
          }

          if (p.isOneShot) {
            const isLoading = oneShotLoading[p.id];
            const okMsg = oneShotOk[p.id];
            const isFail = okMsg && okMsg.includes("✕");
            return (
              <div key={p.id} className="flex flex-col gap-1.5 w-full px-3.5 py-2.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] text-[var(--text-muted)] shrink-0">{p.icon}</span>
                  <span className="text-[12px] text-[var(--text-secondary)] font-medium flex-1 text-left">{p.label}</span>
                  <button
                    disabled={!isActive || isLoading}
                    onClick={() => fireOneShot(p.id, p.sendValue || "1", p.successMsg)}
                    className={`text-[10px] font-bold px-3 py-[4px] rounded-md border transition tracking-wide uppercase
                      ${(!isActive || isLoading)
                        ? "bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
                        : "bg-rose-500/10 text-rose-500 border-rose-500/30 hover:bg-rose-500/20 cursor-pointer"
                      }`}
                  >
                    {isLoading ? "Bekleniyor…" : (p.btnLabel || "Gönder")}
                  </button>
                </div>
                {okMsg && (
                  <span className={`text-[10px] font-medium pl-6 font-mono ${isFail ? "text-rose-400" : "text-emerald-400"}`}>
                    {okMsg}
                  </span>
                )}
              </div>
            );
          }

          /* ── Hem okunabilir hem düzenlenebilir (örn. ESP Hardware Versiyon, ESP Modu) ── */
          if (p.isEditable) {
            return (
              <div key={p.id} className="rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] px-3.5 py-1">
                <EditableRow icon={p.icon} label={p.label} id={p.id}
                  value={V(p.id)} setOk={setOkMap[p.id]} disabled={!isActive}
                  failed={failedReads[p.id]} setFailed={failedSets[p.id]}
                  inputType={p.type} options={p.options}
                  readOnly={p.adminEditOnly && isOperator}
                  bulkEditing={false} bulkDraft="" onBulkDraftChange={() => {}}
                  onSet={(id, val) => sendCommand("set", id, val)}
                  onRead={(id) => { setFailedReads((prev) => ({ ...prev, [id]: false })); sendCommand("read", id); }}
                  last={true} />
              </div>
            );
          }

          return (
            <ActionButton key={p.id} icon={p.icon} label={p.label}
              badge={V(p.id)} color={p.color} disabled={!isActive} />
          );
        })}
      </div>

      {/* Şarj Durumu */}
      <div className="flex flex-col gap-1 mt-3 px-3.5 py-2.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)]">
        <div className="flex items-center gap-2">
          <TbActivity className="text-[14px] text-[var(--text-muted)]" />
          <span className="text-[12px] text-[var(--text-muted)]">Şarj Durumu:</span>
          <span className={`text-[12px] font-bold flex-1 font-mono ${
            csColor(readValues[25]) === "green" ? "text-emerald-400" :
            csColor(readValues[25]) === "yellow" ? "text-amber-400" :
            csColor(readValues[25]) === "blue" ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"
          }`}>{V(25)}</span>
          <button
            onClick={() => fireRead(25)}
            disabled={!isActive || readLoading[25]}
            className={`p-[4px] rounded-md border transition shrink-0
              ${(!isActive || readLoading[25])
                ? "bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
                : "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-border)] hover:bg-[var(--accent-soft-hover)] cursor-pointer"
              }`}
          >
            <HiOutlineArrowPath className={`text-[11px] ${readLoading[25] ? "animate-spin" : ""}`} />
          </button>
        </div>
        {readFeedback[25] && (
          <span className={`text-[10px] font-medium pl-6 font-mono ${readFeedback[25].includes("✕") ? "text-rose-400" : "text-emerald-400"}`}>
            {readFeedback[25]}
          </span>
        )}
      </div>
    </>
    );
  };

  const renderTelemetryCard = (p, showStateColor = false) => (
    <div key={p.id} className="bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-2 flex flex-col hover:border-[var(--accent-border)] transition-colors min-h-[110px]">
      <div className="flex items-center gap-1 mb-1.5 min-h-[14px]">
        {p.icon && <span className="text-[11px] text-[var(--text-secondary)] shrink-0">{p.icon}</span>}
        <span className="text-[9px] text-[var(--text-secondary)] font-semibold tracking-wide uppercase truncate">{p.label}</span>
        <span className="text-[8px] text-amber-400 ml-auto font-mono shrink-0" style={{ visibility: failedReads[p.id] ? 'visible' : 'hidden' }}>!</span>
      </div>
      <div className="flex items-baseline gap-1 mb-2 min-h-[20px]">
        <span className={`text-[14px] font-bold tracking-tight font-display leading-none truncate ${
          showStateColor && p.id === 25 ? (
            csColor(readValues[25]) === "green" ? "text-emerald-400" :
            csColor(readValues[25]) === "yellow" ? "text-amber-400" :
            csColor(readValues[25]) === "blue" ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
          ) : "text-[var(--text-primary)]"
        }`}>
          {V(p.id) || "——"}
        </span>
        {p.unit && <span className="text-[9px] font-semibold text-[var(--text-secondary)] font-mono shrink-0">{p.unit}</span>}
      </div>
      <button
        onClick={() => { setFailedReads((prev) => ({ ...prev, [p.id]: false })); sendCommand("read", p.id); }}
        disabled={!isActive || !!batchReadingId}
        className={`mt-auto flex items-center justify-center gap-1 w-full py-[3px] rounded-md border text-[9px] font-semibold transition tracking-wider uppercase
          ${(!isActive || !!batchReadingId)
            ? "bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
            : "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-border)] hover:bg-[var(--accent-soft-hover)] active:bg-[var(--accent-soft-hover)] cursor-pointer"
          }`}
      >
        <HiOutlineArrowPath className="text-[9px]" />
        Oku
      </button>
    </div>
  );

  const renderTelemetry = () => (
    <>
      <SectionHeader icon={<TbActivity />} title="Canlı Telemetri" subtitle="Anlık şarj verileri ve cihaz durumu" />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] tracking-widest uppercase font-bold text-emerald-400 font-mono">Live Stream</span>
          <span className="text-[10px] text-[var(--accent)] font-medium animate-pulse ml-3 font-mono truncate"
            style={{ visibility: (batchReadingId === "tele" && batchProgress) ? 'visible' : 'hidden' }}>
            {(batchReadingId === "tele" && batchProgress) || " "}
          </span>
        </div>
        <button
          onClick={() => batchRead(TELEMETRY, "tele")}
          disabled={!isActive || !!batchReadingId || !!bulkEditingId || bulkSaving}
          className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-[5px] rounded-md border transition tracking-wide uppercase self-start sm:self-auto
            ${(!isActive || !!batchReadingId || !!bulkEditingId || bulkSaving)
              ? "bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
              : "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-border)] hover:bg-[var(--accent-soft-hover)] cursor-pointer"
            }`}
        >
          <HiOutlineArrowPath className={`text-[12px] ${batchReadingId === "tele" ? "animate-spin" : ""}`} />
          {batchReadingId === "tele" ? "Okunuyor…" : "Tümünü Oku"}
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {TELEMETRY.map((p) => renderTelemetryCard(p, true))}
      </div>
    </>
  );

  const renderMspTelemetry = () => (
    <>
      <SectionHeader icon={<HiOutlineSignal />} title="MSP Telemetri" subtitle="Faz voltajları, akımlar ve MSP output verileri" />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          <span className="text-[10px] tracking-widest uppercase font-bold text-amber-400 font-mono">Read-Only</span>
          <span className="text-[10px] text-[var(--accent)] font-medium animate-pulse ml-3 font-mono truncate"
            style={{ visibility: (batchReadingId === "msp" && batchProgress) ? 'visible' : 'hidden' }}>
            {(batchReadingId === "msp" && batchProgress) || " "}
          </span>
        </div>
        <button
          onClick={() => batchRead(MSP_TELEMETRY, "msp")}
          disabled={!isActive || !!batchReadingId || !!bulkEditingId || bulkSaving}
          className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-[5px] rounded-md border transition tracking-wide uppercase self-start sm:self-auto
            ${(!isActive || !!batchReadingId || !!bulkEditingId || bulkSaving)
              ? "bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
              : "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-border)] hover:bg-[var(--accent-soft-hover)] cursor-pointer"
            }`}
        >
          <HiOutlineArrowPath className={`text-[12px] ${batchReadingId === "msp" ? "animate-spin" : ""}`} />
          {batchReadingId === "msp" ? "Okunuyor…" : "Tümünü Oku"}
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {MSP_TELEMETRY.map((p) => renderTelemetryCard(p))}
      </div>
    </>
  );

  const renderOcppCreds = () => (
    <>
      <SectionHeader icon={<HiOutlineIdentification />} title="OCPP Credentials"
        subtitle={isAdmin ? "Vendor, model ve seri numarası bilgileri" : "Salt okunur — değişiklik için admin paneline geçin"} />
      <div className="px-1">
        {isAdmin ? (
          OCPP_CREDS.map((p, i) => (
            <EditableRow key={p.id} icon={p.icon} label={p.label} id={p.id}
              value={V(p.id)} setOk={setOkMap[p.id]} disabled={!isActive}
              failed={failedReads[p.id]} setFailed={failedSets[p.id]}
              bulkEditing={bulkEditingId === "creds"}
              bulkDraft={bulkDrafts[p.id] ?? ""} onBulkDraftChange={updateBulkDraft}
              onSet={(id, val) => sendCommand("set", id, val)}
              onRead={(id) => { setFailedReads((prev) => ({ ...prev, [id]: false })); sendCommand("read", id); }}
              last={i === OCPP_CREDS.length - 1} />
          ))
        ) : (
          OCPP_CREDS.map((p, i) => (
            <InfoRow key={p.id} icon={p.icon} label={p.label}
              value={V(p.id)} disabled={!isActive}
              failed={failedReads[p.id]}
              onRead={() => { setFailedReads((prev) => ({ ...prev, [p.id]: false })); sendCommand("read", p.id); }}
              last={i === OCPP_CREDS.length - 1} />
          ))
        )}
      </div>
      <BatchControls params={OCPP_CREDS} panelId="creds" showBulk={isAdmin} />
    </>
  );

  const renderOTA = () => (
    <>
      <SectionHeader icon={<HiOutlineArrowUpTray />} title="OTA Güncelleme" subtitle="Firmware güncelleme, key yönetimi ve ESP reset" />
      <div className="px-1">
        {OTA.map((p, i) => {
          if (p.isOneShot) {
            const isLoading = oneShotLoading[p.id];
            const okMsg = oneShotOk[p.id];
            const isFail = okMsg && okMsg.includes("✕");
            const btnColor = p.color === "blue"
              ? "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-border)] hover:bg-[var(--accent-soft-hover)]"
              : "bg-rose-500/10 text-rose-500 border-rose-500/30 hover:bg-rose-500/20";
            return (
              <div key={`ota-${p.id}`} className={`flex flex-col gap-1 py-[10px] min-h-[44px] ${i !== OTA.length - 1 ? "border-b border-[var(--border-subtle)]" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] text-[var(--text-muted)]">{p.icon}</span>
                    <span className="text-[12px] text-[var(--text-secondary)] font-medium">{p.label}</span>
                  </div>
                  <button
                    disabled={!isActive || isLoading}
                    onClick={() => fireOneShot(p.id, p.sendValue || "1", p.successMsg)}
                    className={`text-[10px] font-bold px-3 py-[4px] rounded-md border transition shrink-0 tracking-wide uppercase
                      ${(!isActive || isLoading)
                        ? "bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
                        : `${btnColor} cursor-pointer`
                      }`}
                  >
                    {isLoading ? "Bekleniyor…" : (p.btnLabel || "Gönder")}
                  </button>
                </div>
                {okMsg && (
                  <span className={`text-[10px] font-medium pl-6 font-mono ${isFail ? "text-rose-400" : "text-emerald-400"}`}>
                    {okMsg}
                  </span>
                )}
              </div>
            );
          }
          return (
            <EditableRow key={`ota-${p.id}`} icon={p.icon} label={p.label} id={p.id}
              value={V(p.id)} setOk={setOkMap[p.id]} disabled={!isActive}
              failed={failedReads[p.id]} setFailed={failedSets[p.id]}
              inputType={p.type} options={
                p.id === 64 ? logoOptions :
                p.id === 33 ? espSwVersionOptions :
                p.id === 68 ? espHwVersionOptions :
                p.options
              }
              bulkEditing={bulkEditingId === "ota"}
              bulkDraft={bulkDrafts[p.id] ?? ""} onBulkDraftChange={updateBulkDraft}
              onSet={(id, val) => sendCommand("set", id, val)}
              onRead={(id) => { setFailedReads((prev) => ({ ...prev, [id]: false })); sendCommand("read", id); }}
              last={i === OTA.length - 1} />
          );
        })}

        {/* ID 65 — Aktif Logo (read-only info kartı) */}
        {(() => {
          const isRdLoading = readLoading[65];
          const rdFb = readFeedback[65];
          const rdFail = rdFb && rdFb.includes("✕");
          return (
            <div className="flex flex-col gap-1 py-[10px] min-h-[44px] border-t border-[var(--border-subtle)] mt-2 pt-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] text-[var(--text-muted)]"><HiOutlineTag /></span>
                  <span className="text-[12px] text-[var(--text-muted)]">Aktif Logo:</span>
                  <span className="text-[12px] text-[var(--text-primary)] font-semibold font-mono">{V(65)}</span>
                  {failedReads[65] && (
                    <span className="text-[10px] text-amber-400 font-medium">okunamadı</span>
                  )}
                </div>
                <button
                  onClick={() => fireRead(65)}
                  disabled={!isActive || isRdLoading}
                  className={`p-[4px] rounded-md border transition shrink-0
                    ${(!isActive || isRdLoading)
                      ? "bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
                      : "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-border)] hover:bg-[var(--accent-soft-hover)] cursor-pointer"
                    }`}
                  title="Aktif logoyu oku"
                >
                  <HiOutlineArrowPath className={`text-[11px] ${isRdLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
              {rdFb && (
                <span className={`text-[10px] font-medium pl-6 font-mono ${rdFail ? "text-rose-400" : "text-emerald-400"}`}>
                  {rdFb}
                </span>
              )}
            </div>
          );
        })()}
      </div>
      <BatchControls params={OTA} panelId="ota" />

      <div className="mt-4">
        <OtaServerLogs token={token} />
      </div>
    </>
  );

  const renderSection = () => {
    switch (activeSection) {
      case "device-select": return <DeviceSelect token={token}
        isSuperadmin={currentUser?.role === "superadmin"}
        onSelect={(device) => { if (device?.mac) setMac(device.mac); }}
        onConnect={(mac, device) => {
          if (mac) setMac(mac);
          setConnectedLabel(device?.location || device?.device_code || mac || "Cihaz");
          setIsConnected(true);
          setActiveSection("ocpp-wifi");
        }} />;
      case "ocpp-wifi":  return renderOcppWifi();
      case "ui":         return renderUI();
      case "msp-config": return renderMspConfig();
      case "esp-ctrl":   return renderEspCtrl();
      case "telemetry":  return renderTelemetry();
      case "msp-tele":   return renderMspTelemetry();
      case "ocpp-creds": return renderOcppCreds();
      case "ota":        return currentUser?.role === "superadmin" ? renderOTA() : renderOcppWifi();
      case "connections": return isAdmin
                           ? <Connections token={token} isSuperadmin={currentUser?.role === "superadmin"} />
                           : renderOcppWifi();
      case "device-setup": return currentUser?.role === "superadmin"
                           ? <DeviceSetup token={token} isActive={isActive} sendCommand={sendCommand} setReadValues={setReadValues} />
                           : renderOcppWifi();
      case "bulk-update": return currentUser?.role === "superadmin"
                           ? <BulkUpdate token={token} />
                           : renderOcppWifi();
      case "device-mgmt": return currentUser?.role === "superadmin"
                           ? <DeviceManagement token={token} />
                           : renderOcppWifi();
      case "ota-server": return currentUser?.role === "superadmin"
                           ? <OtaServerControl token={token} />
                           : renderOcppWifi();
      case "device-versions": return currentUser?.role === "superadmin"
                           ? <DeviceVersions token={token} />
                           : renderOcppWifi();
      case "users":      return currentUser?.role === "superadmin"
                           ? <UserManagement token={token} currentUsername={currentUser?.username} />
                           : renderOcppWifi();
      default:           return renderOcppWifi();
    }
  };

  return (
    <div className="min-h-screen flex bg-[var(--bg-app)] text-[var(--text-primary)] font-body">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

        :root.theme-dark {
          --bg-app: #0a0f18;
          --bg-sidebar: #0d1420;
          --bg-surface: #111827;
          --bg-subtle: #1a2232;
          --bg-sunken: #0b1220;
          --bg-hover: #1e2a3f;
          --border-subtle: rgba(148, 163, 184, 0.12);
          --border-strong: rgba(148, 163, 184, 0.22);
          --text-primary: #e2e8f0;
          --text-secondary: #94a3b8;
          --text-muted: #64748b;
          --accent: #06b6d4;
          --accent-soft: rgba(6, 182, 212, 0.10);
          --accent-soft-hover: rgba(6, 182, 212, 0.18);
          --accent-border: rgba(6, 182, 212, 0.28);
        }
        :root.theme-light {
          --bg-app: #f5f7fb;
          --bg-sidebar: #ffffff;
          --bg-surface: #ffffff;
          --bg-subtle: #f1f5f9;
          --bg-sunken: #e2e8f0;
          --bg-hover: #e6edf5;
          --border-subtle: rgba(15, 23, 42, 0.10);
          --border-strong: rgba(15, 23, 42, 0.20);
          --text-primary: #0b1220;
          --text-secondary: #1e293b;
          --text-muted: #475569;
          --accent: #0891b2;
          --accent-soft: rgba(8, 145, 178, 0.10);
          --accent-soft-hover: rgba(8, 145, 178, 0.18);
          --accent-border: rgba(8, 145, 178, 0.35);
        }
        /* iOS PWA safe area — status bar yüksekliği */
        @supports (padding: max(0px)) {
          .safe-top    { padding-top: max(0.5rem, env(safe-area-inset-top)); }
          .safe-bottom { padding-bottom: max(0.5rem, env(safe-area-inset-bottom)); }
          .safe-left   { padding-left: max(1rem, env(safe-area-inset-left)); }
          .safe-right  { padding-right: max(1rem, env(safe-area-inset-right)); }
        }

        .font-display { font-family: 'Geist', ui-sans-serif, system-ui, sans-serif; font-feature-settings: 'cv11','ss01'; }
        .font-body    { font-family: 'Inter Tight', ui-sans-serif, system-ui, sans-serif; }
        .font-mono    { font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace; }

        .custom-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scroll::-webkit-scrollbar-track { background: transparent; }
        .custom-scroll::-webkit-scrollbar-thumb {
          background: var(--border-strong); border-radius: 3px;
        }
        .custom-scroll::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

        .theme-light input, .theme-light select { color-scheme: light; }
        .theme-dark input, .theme-dark select { color-scheme: dark; }
      `}</style>

      <Sidebar
        sections={visibleSections}
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        activePage={isAdmin ? "panel" : "dashboard"}
        onNavigate={onNavigate}
        onLogout={onLogout}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        mobileOpen={sidebarMobileOpen}
        onCloseMobile={() => setSidebarMobileOpen(false)}
        currentUser={currentUser}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Connection Bar — mobilde 2 satır, masaüstünde tek satır */}
        <header className="sticky top-0 z-20 bg-[var(--bg-app)]/95 backdrop-blur-md border-b border-[var(--border-subtle)] safe-top">
          {/* ── 1. Satır: Hamburger + Status Badge ── */}
          <div className="flex items-center gap-3 px-4 sm:px-6 min-h-[52px] sm:min-h-[60px]">
            <button
              onClick={() => setSidebarMobileOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-hover)] transition shrink-0"
              aria-label="Menu"
            >
              <HiOutlineBars3 className="text-xl" />
            </button>

            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-bold border tracking-wide shrink-0 ${badge.c}`}>
              <span className={`w-[6px] h-[6px] rounded-full ${badge.d}`} />
              {badge.t}
            </div>

            {isConnected && (connectedLabel || mac) && (
              <span className="hidden md:inline text-[11px] text-[var(--text-muted)] font-mono tracking-tight truncate">
                {connectedLabel || mac}
              </span>
            )}

            {/* Aynı MAC'e bağlı diğer kullanıcılar badge'i */}
            {isConnected && otherUsersOnSameMac.length > 0 && (
              <div
                className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold border tracking-wide
                           bg-amber-500/10 border-amber-500/30 text-amber-500 cursor-help shrink-0"
                title={"Aynı cihaza bağlı: " + otherUsersOnSameMac.map((u) => u.fullName || u.username).join(", ")}
              >
                <span className="w-[6px] h-[6px] rounded-full bg-amber-400 animate-pulse" />
                {otherUsersOnSameMac.length} kullanıcı daha bağlı
              </div>
            )}

            <div className="flex-1" />

            {/* Masaüstünde form sağda — mobilde GİZLİ, aşağıda 2. satıra düşer */}
            <form onSubmit={handleSubmit} className="hidden sm:flex gap-2 items-center shrink-0">
              {isOperator ? (
                <select value={selectedDeviceId} onChange={(e) => setSelectedDeviceId(e.target.value)} required
                  className="bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                             px-3 py-1.5 rounded-lg text-[12px] outline-none
                             focus:border-[var(--accent)] transition w-56 cursor-pointer">
                  <option value="">
                    {myDevices.length === 0 ? "Atanmış cihaz yok" : "Cihaz seçin…"}
                  </option>
                  {myDevices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.location || d.device_code || `#${d.id}`}
                      {d.company ? ` — ${d.company}` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <input value={mac} onChange={(e) => setMac(e.target.value)}
                  placeholder="AA:BB:CC:DD:EE:FF" required
                  className="bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                             px-3 py-1.5 rounded-lg text-[12px] font-mono outline-none placeholder:text-[var(--text-muted)]
                             focus:border-[var(--accent)] transition w-44" />
              )}
              <button disabled={loading}
                className={`px-4 py-1.5 rounded-lg text-[12px] font-bold transition cursor-pointer tracking-wide uppercase
                  ${loading ? "bg-[var(--bg-subtle)] text-[var(--text-muted)]" : "bg-emerald-500 hover:bg-emerald-400 text-white shadow-sm shadow-emerald-500/30"}`}>
                {loading ? "…" : "Bağlan"}
              </button>
              {isConnected && (
                <button type="button" onClick={handleDisconnect}
                  className="px-3 py-1.5 rounded-lg text-[12px] font-bold transition cursor-pointer tracking-wide uppercase
                             bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 border border-rose-500/30">
                  Kopar
                </button>
              )}
              {isConnected && isActive && (
                <button type="button" onClick={() => fireOneShot(20, "1", "ESP resetlendi ✓")}
                  disabled={oneShotLoading[20]}
                  title="ESP'yi resetle"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold transition tracking-wide uppercase shrink-0
                             bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border border-amber-500/30 disabled:opacity-50 cursor-pointer">
                  <HiOutlineArrowPath className={`text-[12px] ${oneShotLoading[20] ? "animate-spin" : ""}`} />
                  {oneShotLoading[20] ? "…" : "ESP Reset"}
                </button>
              )}
            </form>
          </div>

          {/* ── 2. Satır: Mobilde MAC input + butonlar ── */}
          <form onSubmit={handleSubmit} className="sm:hidden flex gap-2 items-center px-4 pb-3">
            {isOperator ? (
              <select value={selectedDeviceId} onChange={(e) => setSelectedDeviceId(e.target.value)} required
                className="flex-1 min-w-0 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                           px-3 py-2 rounded-lg text-[13px] outline-none
                           focus:border-[var(--accent)] transition">
                <option value="">
                  {myDevices.length === 0 ? "Atanmış cihaz yok" : "Cihaz seçin…"}
                </option>
                {myDevices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.location || d.device_code || `#${d.id}`}
                  </option>
                ))}
              </select>
            ) : (
              <input value={mac} onChange={(e) => setMac(e.target.value)}
                placeholder="AA:BB:CC:DD:EE:FF" required
                className="flex-1 min-w-0 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                           px-3 py-2 rounded-lg text-[13px] font-mono outline-none placeholder:text-[var(--text-muted)]
                           focus:border-[var(--accent)] transition" />
            )}
            <button disabled={loading}
              className={`px-4 py-2 rounded-lg text-[12px] font-bold transition cursor-pointer tracking-wide uppercase shrink-0
                ${loading ? "bg-[var(--bg-subtle)] text-[var(--text-muted)]" : "bg-emerald-500 active:bg-emerald-400 text-white shadow-sm shadow-emerald-500/30"}`}>
              {loading ? "…" : "Bağlan"}
            </button>
            {isConnected && (
              <button type="button" onClick={handleDisconnect}
                className="px-3 py-2 rounded-lg text-[12px] font-bold transition cursor-pointer tracking-wide uppercase shrink-0
                           bg-rose-500/10 active:bg-rose-500/20 text-rose-500 border border-rose-500/30">
                Kopar
              </button>
            )}
            {isConnected && isActive && (
              <button type="button" onClick={() => fireOneShot(20, "1", "ESP resetlendi ✓")}
                disabled={oneShotLoading[20]}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-bold transition tracking-wide uppercase shrink-0
                           bg-amber-500/10 active:bg-amber-500/20 text-amber-500 border border-amber-500/30 disabled:opacity-50">
                <HiOutlineArrowPath className={`text-[12px] ${oneShotLoading[20] ? "animate-spin" : ""}`} />
                {oneShotLoading[20] ? "…" : "Reset"}
              </button>
            )}
          </form>

          {/* MAC mobilde küçük altta — sadece bağlıyken göster */}
          {isConnected && (connectedLabel || mac) && (
            <div className="md:hidden px-4 pb-2 text-[10px] text-[var(--text-muted)] font-mono tracking-tight">
              {connectedLabel || mac}
              {otherUsersOnSameMac.length > 0 && (
                <span className="ml-2 text-amber-500 font-bold">
                  · {otherUsersOnSameMac.length} kullanıcı daha
                </span>
              )}
            </div>
          )}

          {/* Mesaj — her zaman alan kapla (layout shift önle) */}
          {/* Mobilde alan kaplamasın diye sm:min-h kullan, mobil tasarımda ekstra padding rahatsız etmesin */}
          <div className="px-4 sm:px-6 pb-2 min-h-0 sm:min-h-[44px]" aria-live="polite">
            <div className={`w-full px-3 py-1.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[12px] text-[var(--text-secondary)] font-mono transition-opacity duration-200
              ${message ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
              style={{ visibility: message ? 'visible' : 'hidden' }}>
              {message || " "}
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
          <div className="max-w-[1200px] mx-auto">
            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-2xl p-5 sm:p-7 shadow-sm">
              {renderSection()}
            </div>

            <div className="mt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 text-[10px] text-[var(--text-muted)] font-mono tracking-wide">
              <span>
                {isAdmin ? "ADMIN PANEL" : "DASHBOARD"}
                <span className="mx-2 opacity-40">·</span>
                bluetech EV charge controller
              </span>
              <span>
                {isActive ? "● ESP active" : isConnected ? "◐ ESP waiting" : "○ no connection"}
              </span>
            </div>
          </div>
        </main>
      </div>

      {/* ── "Başkası deaktif etti" Modal ── */}
      {deactivatedByModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="bg-[var(--bg-surface)] border border-rose-500/30 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-500 text-[22px] shrink-0">
                ⚠
              </div>
              <h3 className="text-[16px] font-bold text-[var(--text-primary)] font-display tracking-tight">
                Bağlantı Kapatıldı
              </h3>
            </div>
            <p className="text-[13px] text-[var(--text-secondary)] mb-2 leading-relaxed">
              Bu şarj cihazına bağlantınız
              {" "}
              <span className="font-bold text-[var(--text-primary)]">{deactivatedByModal}</span>
              {" "}
              tarafından deaktif edildi.
            </p>
            <p className="text-[11px] text-[var(--text-muted)] mb-5 leading-relaxed">
              Tekrar bağlanmak isterseniz üstteki "BAĞLAN" butonuna tıklayabilirsiniz.
            </p>
            <div className="flex justify-end">
              <button
                onClick={ackDeactivatedBy}
                className="px-5 py-2 rounded-lg text-[13px] font-bold transition cursor-pointer tracking-wide uppercase
                           bg-rose-500 hover:bg-rose-400 text-white border border-rose-400 shadow-sm shadow-rose-500/30"
              >
                Tamam
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}