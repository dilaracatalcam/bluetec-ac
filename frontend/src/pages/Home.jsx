import Sidebar from "../components/Sidebar.jsx";
import Panel from "../components/Panel.jsx";
import MetricCard from "../components/MetricCard.jsx";
import ActionButton from "../components/ActionButton.jsx";
import EditableRow from "../components/EditableRow.jsx";
import InfoRow from "../components/InfoRow.jsx";
import UserManagement from "../components/UserManagement.jsx";
import Connections from "../components/Connections.jsx";
import LocationEditButton from "../components/LocationEditButton";
import DeviceSelect from "../components/DeviceSelect.jsx";
import DeviceManagement from "../components/DeviceManagement.jsx";
import DeviceSetup from "../components/DeviceSetup.jsx";
import BulkUpdate from "../components/BulkUpdate.jsx";
import BulkParamUpdate from "../components/BulkParamUpdate.jsx";
import LogoUploadPanel from "../components/LogoUploadPanel.jsx";
import DeviceStatusBoard from "../components/DeviceStatusBoard.jsx";
import TelemetryHero from "../components/TelemetryHero.jsx";
import AccountSettings from "../components/AccountSettings.jsx";
import OtaServerControl from "../components/OtaServerControl.jsx";
import DeviceVersions from "../components/DeviceVersions.jsx";
import OtaServerLogs from "../components/OtaServerLogs.jsx";
import DeviceLogs from "../components/DeviceLogs.jsx";
import Overview from "../components/Overview.jsx";
import { mapValue, csColor } from "../lib/deviceValueMapping.js";
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
  HiOutlineSignal, HiOutlineUsers, HiOutlineDocumentMagnifyingGlass, HiOutlineUserCircle,
  HiOutlineSquares2X2, HiOutlineSun, HiOutlineMoon, HiOutlineArrowRightOnRectangle,
  HiOutlineViewColumns, HiOutlineChevronDown, HiOutlineEllipsisVertical, HiOutlineXMark, HiOutlinePlus
} from "react-icons/hi2";
import { TbPlugConnected, TbBrandApple, TbBrandGooglePlay, TbGauge, TbColorSwatch, TbTargetArrow, TbActivity, TbAlertCircle, TbTemperature, TbDroplet, TbEngine } from "react-icons/tb";
import { BsLightningCharge, BsBattery, BsUsbSymbol, BsShieldLock, BsThermometer, BsSpeedometer } from "react-icons/bs";
import { MdOutlineRestartAlt, MdSignalCellularAlt, MdOutlineElectricalServices, MdOutlinePower } from "react-icons/md";

// Cihaz cevabı bazı eski daemon sürümlerinde dizi, bazılarında tek nesne
// olarak gelir. Logo okuma/aktivasyon akışı her iki biçimi de kabul eder.
function responseMessages(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value && typeof value === "object" ? [value] : [];
}

function normalizeLogoName(value) {
  return String(value ?? "").trim().replace(/\.bin$/i, "");
}

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
  { id: 13, icon: <HiOutlinePhoto />,          label: "Logo / Yazı",
    type: "dropdown", options: [
      { value: "1", label: "Logo" },
      { value: "0", label: "Yazı" },
    ]},
  { id: 14, icon: <HiOutlineTag />,            label: "Şirket Adı", dependsOn: 13, dependsValue: "0" },
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
  { id: 69, icon: <HiOutlineCommandLine />,    label: "OCPP Sanal Mod",
    type: "dropdown", options: [
      { value: "0", label: "Disable" },
      { value: "1", label: "Soket Takılı" },
      { value: "2", label: "Şarja Geç" },
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

/* ── Section tanımları — sidebar için ──
   group: sidebar'da hangi başlık altında görüneceği (sıra, ilk geçtiği yere göre). */
const SECTIONS = [
  { group: "", key: "overview", label: "Genel Bakış", icon: <HiOutlineSquares2X2 /> },

  { group: "Cihaz", key: "device-select", title: "Cihaz Seç", desc: "Bağlanmak istediğiniz cihazı seçin", label: "Cihaz Seç", icon: <HiOutlineCpuChip /> },
  { group: "Cihaz", key: "ocpp-wifi", title: "OCPP & WiFi Ayarları", desc: "OCPP endpoint ve kablosuz ağ konfigürasyonu",    label: "OCPP & WiFi",       icon: <HiOutlineGlobeAlt /> },
  { group: "Cihaz", key: "ui", title: "Bağlantı & UI Ayarları", desc: "İstasyon görünümü ve haberleşme tercihleri",           label: "Bağlantı & UI",     icon: <TbPlugConnected /> },
  { group: "Cihaz", key: "msp-config", title: "MSP Konfigürasyon", desc: "Metering & Supply Processor: ölçüm ve güç besleme portalı",   label: "MSP Konfigürasyon", icon: <HiOutlineCog6Tooth /> },
  { group: "Cihaz", key: "esp-ctrl", title: "ESP Kontrol", desc: "Embedded Screen Processor: ekran ve arayüz portalı",     label: "ESP Kontrol",       icon: <HiOutlineCpuChip /> },
  { group: "Cihaz", key: "ocpp-creds", title: "OCPP Credentials", desc: "Şarj noktası kimlik ve seri bilgileri",   label: "OCPP Credentials",  icon: <HiOutlineIdentification /> },
  { group: "Cihaz", key: "device-setup", title: "Cihaz Kurulum", desc: "Şirket profili seçin, parametreleri düzenleyin ve toplu gönderin", label: "Cihaz Kurulum",    icon: <HiOutlineWrenchScrewdriver />, adminOnly: true },

  { group: "İzleme", key: "telemetry", title: "Canlı Telemetri", desc: "Anlık şarj verileri ve cihaz durumu",    label: "Canlı Telemetri",   icon: <TbActivity />, badge: "LIVE" },
  { group: "İzleme", key: "msp-tele", title: "MSP Telemetri", desc: "Metering & Supply Processor: ölçüm ve güç besleme portalı",     label: "MSP Telemetri",     icon: <HiOutlineSignal /> },
  { group: "İzleme", key: "logs", title: "Cihaz Logları", desc: "Verbose ve debug log akışını açın, canlı izleyin",         label: "Loglar",            icon: <HiOutlineCommandLine /> },
  { group: "İzleme", key: "connections", title: "Aktif Bağlantılar", desc: "Şu anda hangi kullanıcı hangi şarj cihazına bağlı",  label: "Aktif Bağlantılar", icon: <HiOutlineSignal />, adminOnly: true },

  // superadmin/admin panelden, operator (şirket hesabı) kendi dashboard'undan erişir.
  { group: "Toplu İşlemler", key: "device-status", title: "Toplu Okuma", desc: "Bir şirkete ait tüm cihazların canlı durumu", label: "Toplu Okuma",     icon: <HiOutlineViewColumns />, roles: ["superadmin", "admin", "operator"] },
  { group: "Toplu İşlemler", key: "bulk-param", title: "Toplu Parametre Güncelleme", desc: "Seçtiğiniz cihazlara parametreleri topluca okuyun veya yazın. İş sunucuda çalışır; sayfayı kapatsanız da devam eder.",   label: "Toplu Parametre",  icon: <HiOutlinePencilSquare />, roles: ["superadmin", "admin", "operator"] },
  { group: "Toplu İşlemler", key: "bulk-update", title: "Toplu Güncelleme", desc: "Seçtiğiniz cihazlara topluca firmware gönderin; şarj olan cihazlar atlanır. İş sunucuda çalışır; sayfayı kapatsanız da devam eder.",  label: "Toplu Güncelleme", icon: <HiOutlineArrowUpTray />, adminOnly: true },

  { group: "OTA", key: "ota", title: "OTA Güncelleme", desc: "Firmware güncelleme, key yönetimi ve ESP reset",          label: "OTA Güncelleme",    icon: <HiOutlineArrowUpTray />, superadminOnly: true, adminOnly: true },
  { group: "OTA", key: "ota-server", title: "OTA Sunucu Kontrolü", desc: "Yüklenen dosyalar cihaza değil, şirketin OTA sunucusuna gönderilir; cihazlar güncellemeyi oradan indirir.",   label: "OTA Sunucu Kontrolü", icon: <HiOutlineServerStack />, superadminOnly: true, adminOnly: true },
  { group: "OTA", key: "device-versions", title: "Cihaz Versiyonları", desc: "OTA sunucusundaki cihaz sürüm durumları", label: "Cihaz Versiyonları", icon: <HiOutlineDocumentMagnifyingGlass />, superadminOnly: true, adminOnly: true },

  { group: "Yönetim", key: "device-mgmt", title: "Cihaz Yönetimi", desc: "Cihazları görüntüle, ekle ve sil",  label: "Cihaz Yönetimi",    icon: <HiOutlineCpuChip />, adminOnly: true },
  { group: "Yönetim", key: "users", title: "Kullanıcı Yönetimi", desc: "Kullanıcı ekle, cihaz yetkisi ata, şifre değiştir",        label: "Kullanıcı Yönetimi", icon: <HiOutlineUsers />, superadminOnly: true, adminOnly: true },
  { group: "Yönetim", key: "account", title: "Hesap Yönetimi", desc: "E-posta, kullanıcı adı ve şifrenizi buradan yönetin",      label: "Hesap Yönetimi",   icon: <HiOutlineUserCircle /> },
];

// Kendi kartlarını çizen bölümler — dış beyaz kart olmadan, doğrudan zemine oturur
const BARE_SECTIONS = ["overview", "logs", "ota-server"];

function isIndividualDeviceRecord(device) {
  const normalized = String(device?.company || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return !normalized || ["bireysel", "individual", "kisisel", "private", "ozel"].includes(normalized);
}

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
  const [logoNotifications, setLogoNotifications] = useState([]);
  const [espSwVersionOptions, setEspSwVersionOptions] = useState([]);
  const [espHwVersionOptions, setEspHwVersionOptions] = useState([]);
  const refreshLogoOptions = useCallback(async () => {
    try {
      const r = await authFetch("/api/ota-server/list");
      const d = await r.json();
      const opts = (d.logos || []).map((f) => f.name.replace(/\.bin$/i, ""))
        .map((val) => ({ value: val, label: val.replace(/_logo$/i, "").replace(/_/g, " ") }));
      setLogoOptions(opts);
      setLogoNotifications(d.notifications || []);
    } catch {}
  }, [authFetch]);
  useEffect(() => {
    refreshLogoOptions();

    // OTA Sunucu Kontrolü'ndeki firmware.json'da gerçekten var olan versiyonlar/hw'ler —
    // software (v@4.0.4 gibi) ve hardware (13, 31, 61 gibi) ayrı listeler
    authFetch("/api/ota-server/firmware-versions")
      .then((r) => r.json())
      .then((d) => {
        setEspSwVersionOptions((d.espVersions || []).map((v) => ({ value: v, label: v })));
        setEspHwVersionOptions((d.espHardware || []).map((v) => ({ value: v, label: v })));
      })
      .catch(() => {});
  }, [authFetch, refreshLogoOptions]);

  /* ── Sidebar / UI state ── */
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "dark";
    try { return window.localStorage?.getItem("bluetech-theme-v2") || "light"; } catch { return "light"; }
  });
  // Sol menüdeki bölüm geçişleri URL hash'ine (#bölüm-anahtarı) yazılır —
  // böylece tarayıcının geri/ileri tuşları bölümler arasında gezinebiliyor.
  // Hash yalnızca istemci tarafında yorumlanır, sunucuya hiç gitmediği için
  // (server.js'te ayrıca bir route/değişiklik gerekmiyor) sayfa yenilemede de
  // aynı bölüm açık kalır.
  const readSectionFromHash = () => {
    try {
      const h = window.location.hash.replace(/^#/, "");
      return h || null;
    } catch { return null; }
  };
  const [activeSection, setActiveSectionState] = useState(() => readSectionFromHash() || "overview");
  const navigateToSection = (key) => {
    setActiveSectionState(key);
    try {
      if (window.location.hash.replace(/^#/, "") !== key) window.location.hash = key;
    } catch {}
  };
  useEffect(() => {
    // Geri tuşu panelin dışına değil, panel içinde Genel Bakış'a dönsün diye
    // geçmişin tabanına #overview girişi konur: hash'siz açılışta mevcut giriş
    // #overview yapılır; doğrudan bir bölüm adresiyle açılışta (yer imi vb.)
    // o bölümün ALTINA #overview eklenir. state işareti, sayfa yenilemede
    // (F5) aynı girişlerin tekrar tekrar eklenmesini önler.
    try {
      if (!window.history.state?.btPanel) {
        const h = readSectionFromHash();
        window.history.replaceState({ btPanel: true }, "", "#overview");
        if (h && h !== "overview") window.history.pushState({ btPanel: true }, "", "#" + h);
      }
    } catch {}
    const onHashChange = () => {
      // Hash'siz bir girişe dönüldüyse (eski geçmiş kaydı) Genel Bakış'ı göster
      setActiveSectionState(readSectionFromHash() || "overview");
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [diagOpen, setDiagOpen] = useState(false);
  const [emailBannerDismissed, setEmailBannerDismissed] = useState(false);
  const [connectMenuOpen, setConnectMenuOpen] = useState(false);
  useEffect(() => {
    if (!connectMenuOpen) return;
    const onDocClick = (e) => { if (!e.target.closest("[data-connect-menu]")) setConnectMenuOpen(false); };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [connectMenuOpen]);

  // Mevcut kullanıcı bilgisi — /api/me ile çekilir
  const [currentUser, setCurrentUser] = useState(null); // { username, fullName, role, email }
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
  const [deviceSelectClaimOpen, setDeviceSelectClaimOpen] = useState(false);
  const selectedDevice = useMemo(
    () => myDevices.find((device) => String(device.id) === String(selectedDeviceId)) || null,
    [myDevices, selectedDeviceId]
  );
  // Bireysel cihaz seçilmişken operator görünümü daraltılır. Admin/superadmin
  // için bu kısıt uygulanmaz; onlar yönetici kapsamını korur.
  const restrictedIndividualView = isOperator && !!selectedDevice && isIndividualDeviceRecord(selectedDevice);

  // DeviceSelect (Cihaz Seç) VE DeviceStatusBoard (Toplu Okuma popover'ındaki
  // "Cihaza Bağlan" butonu) AYNI akışı kullanıyor — bağlantı kurulunca cihaz
  // ekranına geçiş tek bir yerden yönetilsin diye ortak bir handler.
  const handleDeviceConnected = useCallback((mac, device) => {
    if (mac) setMac(mac);
    if (device?.id !== undefined && device?.id !== null) setSelectedDeviceId(String(device.id));
    setIsConnected(true);
    navigateToSection("ocpp-wifi");
  }, [setMac, navigateToSection]);

  useEffect(() => {
    if (!isOperator) return;
    authFetch("/api/devices")
      .then((r) => r.json())
      .then((d) => setMyDevices(d.devices || []))
      .catch(() => {});
  }, [isOperator, authFetch]);

  // Üst çubukta bağlı cihazın adı — admin/superadmin MAC'ten, operatör seçimden bulur
  const [deviceIndex, setDeviceIndex] = useState([]);
  useEffect(() => {
    if (!currentUser || isOperator) return;
    authFetch("/api/devices")
      .then((r) => r.json())
      .then((d) => setDeviceIndex(d.devices || []))
      .catch(() => {});
  }, [currentUser, isOperator, authFetch]);
  const connectedDevice = useMemo(() => {
    const norm = (s) => String(s || "").replace(/[^0-9a-f]/gi, "").toUpperCase();
    return (isOperator ? selectedDevice : deviceIndex.find((d) => d.mac && norm(d.mac) === norm(mac))) || null;
  }, [isOperator, selectedDevice, deviceIndex, mac]);
  const connectedName = connectedDevice?.location || connectedDevice?.device_code || "";
  // Üst çubuktaki kalemle konum kaydedilince ad hemen güncellensin
  const onConnectedLocationSaved = useCallback((updated) => {
    const merge = (list) => list.map((d) => (String(d.id) === String(updated.id) ? { ...d, ...updated, mac: d.mac } : d));
    setDeviceIndex(merge);
    setMyDevices(merge);
  }, []);
  const shownMac = isOperator ? "" : mac;

  // Çoklu kullanıcı — aynı MAC'e bağlı diğer kullanıcılar + deactivate uyarısı
  const [otherUsersOnSameMac, setOtherUsersOnSameMac] = useState([]); // [{ username, fullName }]
  const [deactivatedByModal, setDeactivatedByModal] = useState(null); // string | null


  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("theme-dark", "theme-light");
    root.classList.add(theme === "dark" ? "theme-dark" : "theme-light");
    try { window.localStorage?.setItem("bluetech-theme-v2", theme); } catch {}
  }, [theme]);

  const visibleSections = useMemo(
    () => SECTIONS.filter((s) => {
      if (s.adminOnly && !isAdmin) return false;
      if (s.superadminOnly && currentUser?.role !== "superadmin") return false;
      if (s.roles && !s.roles.includes(currentUser?.role)) return false;
      if (restrictedIndividualView && [
        "ocpp-creds", "logs", "device-status", "bulk-param", "bulk-update",
      ].includes(s.key)) return false;
      return true;
    }).map((s) => restrictedIndividualView && s.key === "ocpp-wifi"
      ? { ...s, label: "WiFi Ayarları", title: "WiFi Ayarları", desc: "Kablosuz ağ ayarları ve salt okunur Box bilgisi" }
      : s),
    [isAdmin, currentUser, restrictedIndividualView]
  );

  // Dashboard/Panel arası geçişte, o an açık olan bölüm artık sidebar'da görünmüyorsa
  // (örn. Panel'e özel bir sayfadaydık, Dashboard'a geçtik) güvenli bir varsayılana dön
  useEffect(() => {
    if (activeSection === "device-select" || activeSection === "overview") return; // bunlar her zaman görünür, dokunma
    const stillVisible = visibleSections.some((s) => s.key === activeSection);
    if (!stillVisible) {
      // Otomatik düşme — kullanıcının kendi geçmiş girdisi değil, bu yüzden
      // yeni bir history entry itmiyoruz (replace).
      setActiveSectionState("ocpp-wifi");
      try { window.history.replaceState(null, "", "#ocpp-wifi"); } catch {}
    }
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
        // Hareketsizlik: bağlantı 5. dakikada kapanır — uyarı penceresi açılmaz, üst
        // çubukta yazılır ve sunucudaki bayrak hemen temizlenir (yeniden bağlanırken
        // eski uyarı çıkmasın)
        const inactivity = /^İnaktivite/i.test(String(d.deactivatedBy || ""));
        if (inactivity || d.timedOut) {
          setIsConnected(false);
          setEspStatus("nonactive");
          setMessage("5 dakika işlem yapılmadığı için bağlantı kapatıldı.");
          if (inactivity) authFetch("/api/ack-deactivated", { method: "POST" }).catch(() => {});
          return;
        }
        // Başkası bağlantıyı devraldı uyarısı
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


  // Panelde gerçek kullanım (fare/klavye/kaydırma/dokunma) bağlantının 5 dk
  // hareketsizlik sayacını sıfırlar — en fazla dakikada bir bildirilir. Sekmenin
  // yalnızca açık durması sayılmaz (bkz. backend /api/activity).
  useEffect(() => {
    if (!isConnected) return undefined;
    let last = 0;
    const onUse = () => {
      const now = Date.now();
      if (now - last < 60 * 1000 || document.visibilityState !== "visible") return;
      last = now;
      authFetch("/api/activity", { method: "POST" }).catch(() => {});
    };
    const events = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"];
    events.forEach((e) => window.addEventListener(e, onUse, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, onUse));
  }, [isConnected, authFetch]);

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

        const msgs = responseMessages(j.message_response);
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

  const sendCommand = useCallback(async (type, variable, value = "", opts = {}) => {
    if (!isActive) { setMessage("ESP aktif değil"); return false; }
    const { keepStale = false, silent = false } = opts;

    // Read komutu atılırken eski değeri hemen sil — böylece yeni değer gelene kadar
    // ekranda "—" görünür, eski/bayat değerle yeni okunan değer karışmaz.
    // keepStale: canlı telemetri otomatik yenilemesi gibi arka plan okumalarında
    // eski değer ekranda kalmaya devam eder, yenisi gelince üzerine yazılır —
    // her ~10sn'de bir tüm kartların "——" olup tekrar dolması (flicker) önlenir.
    if (type === "read" && !keepStale) {
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
      if (!r.ok) { if (!silent) setMessage(d.message || "Hata"); return false; }

      if (type === "set" && value !== undefined && value !== null) {
        setReadValues((prev) => ({ ...prev, [variable]: String(value) }));
        pendingSetsRef.current[variable] = { value: String(value), until: Date.now() + SET_GRACE_MS };
      }

      if (!silent) {
        setMessage(type === "set" ? "Değer gönderildi…" : "Okunuyor…");
        setTimeout(() => setMessage(""), 3000);
      }
      return true;
    } catch { if (!silent) setMessage("Sunucuya ulaşılamadı"); return false; }
  }, [isActive, authFetch]);

  // Başarılı okuma/SET OK değerini cihazın MAC'iyle sunucu envanterine işler.
  // Sunucu MAC'i aktif oturumdan çözer; frontend tarafında MAC ifşa edilmez.
  const syncDeviceField = useCallback(async (variable, value) => {
    if (value === undefined || value === null || value === "" || value === "SET OK") return;
    try {
      await authFetch("/api/devices/sync-field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variable, value: String(value) }),
      });
    } catch {}
  }, [authFetch]);

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

  // ESP Reset GÜVENLİK KONTROLÜ: şarj veren bir cihaza yanlışlıkla basılıp
  // resetlenmesin diye, komutu göndermeden önce id 25'i (şarj durumu) kontrol
  // ediyoruz — bulk-jobs.js / device-status-poll.js'teki AYNI sözleşme:
  // cihaz string kod gönderiyor (P1_IDLE...P6_ERR), sadece "P4_CHARGING" =
  // şarjda. DİKKAT: genel "CHARG" değil tam "CHARGING" aranmalı — aksi halde
  // "P5_CHARGE_ENDED" (şarj BİTTİ, artık şarj etmiyor) de yanlışlıkla
  // "şarjda" sayılıp reset gereksiz yere engellenir. id 25 pasif telemetri
  // olduğu için (cihaz sadece durum
  // DEĞİŞİNCE kendiliğinden yayınlıyor, taze "oku" isteğine her zaman cevap
  // vermeyebiliyor) önce ekrandaki son bilinen değere bakıp sonra taze bir
  // okuma deniyoruz; hiçbir değer alınamazsa (doğrulanamıyor) sert engellemek
  // yerine açık bir uyarıyla onay istiyoruz.
  const handleEspReset = useCallback(async () => {
    if (!isActive || oneShotLoading[20]) return;
    setOneShotOk((prev) => ({ ...prev, 20: null }));
    setOneShotLoading((prev) => ({ ...prev, 20: true }));

    let raw = readValues[25];
    try {
      await sendCommand("read", 25, "", { keepStale: true, silent: true });
      for (let i = 0; i < 4; i++) {
        await new Promise((r) => setTimeout(r, 400));
        const resp = await authFetch("/api/responses");
        const j = await resp.json();
        const msgs = j.message_response || [];
        const found = msgs.find((m) => Number(m.cmd) === 2 && Number(m.msg) === 25 && m.data !== undefined && m.data !== null);
        if (found) { raw = found.data; break; }
      }
    } catch {}

    if (raw && (String(raw) === "1" || /CHARGING/i.test(String(raw)))) {
      setOneShotLoading((prev) => ({ ...prev, 20: false }));
      setOneShotOk((prev) => ({ ...prev, 20: "Cihaz şarj veriyor, reset engellendi ✕" }));
      setTimeout(() => setOneShotOk((prev) => ({ ...prev, 20: null })), 5000);
      return;
    }
    if (!raw && !window.confirm("Şarj durumu doğrulanamadı, cihaz şarj veriyor olabilir.\n\nYine de resetlemek istiyor musunuz?")) {
      setOneShotLoading((prev) => ({ ...prev, 20: false }));
      return;
    }

    await fireOneShot(20, "1", "ESP resetlendi ✓");
  }, [isActive, oneShotLoading, readValues, sendCommand, authFetch, fireOneShot]);

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
    // Logo değişkeni reset sonrası cevap verdiği için normal parametrelerden
    // daha geç gelebilir; 65 için daha uzun bir bekleme penceresi kullanılır.
    const maxRetries = id === 65 ? 12 : 4;
    for (let retry = 0; retry < maxRetries; retry++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const resp = await authFetch("/api/responses");
        const j = await resp.json();
        const msgs = responseMessages(j.message_response);
        const found = msgs.find((m) => Number(m.cmd) === 2 && Number(m.msg) === id);
        if (found && found.data !== undefined && found.data !== null) {
          setReadValues((prev) => ({ ...prev, [id]: found.data }));
          syncDeviceField(id, found.data);
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
  }, [isActive, authFetch, syncDeviceField]);

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
    if (!isConnected) return { t: "Bağlantı Yok", tc: "text-[var(--text-muted)]", d: "bg-[var(--text-muted)]" };
    if (espStatus === "active") return { t: "Çevrimiçi", tc: "text-emerald-500", d: "bg-emerald-400 animate-pulse" };
    if (espStatus === "unknown") return { t: "Bekleniyor…", tc: "text-amber-500", d: "bg-amber-400 animate-pulse" };
    return { t: "Çevrimdışı", tc: "text-rose-500", d: "bg-rose-400" };
  })();

  const V = (id) => mapValue(id, readValues[id]);

  /* ── Toplu Read / Set state'leri ── */
  const [batchReadingId, setBatchReadingId] = useState(null);
  const batchReadingIdRef = useRef(null);
  useEffect(() => { batchReadingIdRef.current = batchReadingId; }, [batchReadingId]);
  const [batchProgress, setBatchProgress] = useState("");
  const [failedReads, setFailedReads] = useState({});

  // Tek bir değişkeni okuyup readValues'a yazar — hem manuel "Tümünü Oku" hem
  // de aşağıdaki sessiz otomatik yenileme tarafından paylaşılan çekirdek mantık.
  // keepStale: true → cihazdan yeni yanıt gelene kadar eski değer ekranda kalır
  // (flicker olmaz). Kontrol aralığı sıklaştırıldı (300ms x 5 ≈ 1.5sn) — cihaz
  // hızlı cevap verdiğinde eskisine göre (500+500ms, sadece 2 kontrol) daha
  // erken yakalanıyor, toplam bekleme süresi de kısaldı.
  const readOneValue = async (p, { keepStale = false } = {}) => {
    await sendCommand("read", p.id, "", { keepStale, silent: keepStale });

    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise((r) => setTimeout(r, 300));
      try {
        const resp = await authFetch("/api/responses");
        const j = await resp.json();
        const msgs = j.message_response || [];
        // "" (boş veri) de bir cevap ama kullanışlı değil — cihaz bazı
        // telemetri alanlarına (şarj süresi, güç, durum...) pasif olarak
        // yalnızca durum DEĞİŞTİĞİNDE dolu değer basıyor; aradaki okuma
        // isteklerine boş string ile cevap verebiliyor. Bunu "değer" sayıp
        // ekranı "——"a düşürmek yerine (eski dolu değer varsa kaybolmasın
        // diye) yok sayıp bir sonraki turda tekrar deniyoruz.
        const found = msgs.find((m) => Number(m.cmd) === 2 && Number(m.msg) === p.id);
        if (found && found.data !== undefined && found.data !== null && found.data !== "") {
          setReadValues((prev) => ({ ...prev, [p.id]: found.data }));
          syncDeviceField(p.id, found.data);
          return true;
        }
      } catch {}
    }
    return false;
  };

  // Bireysel RFID cihazında ESP modu menüde gösterilmez; ancak Main RFID
  // satırının doğru görünüp görünmeyeceği bu değere göre belirlenir.
  useEffect(() => {
    if (!isActive || !restrictedIndividualView) return;
    readOneValue({ id: 19 }, { keepStale: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, restrictedIndividualView]);

  // "Cihaz Tanılama" üst bardaki (…) menüsünden HERHANGİ bir sekmedeyken
  // açılabiliyor — o yüzden Canlı Telemetri sekmesine özel arka plan
  // döngüsüne güvenmeden, modal açılır açılmaz bu 3 alanı bir kere taze okur.
  useEffect(() => {
    if (!diagOpen || !isActive) return;
    TELEMETRY.filter((p) => ![22, 23, 24, 25].includes(p.id)).forEach((p) => readOneValue(p, { keepStale: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagOpen]);

  const batchRead = async (params, panelId) => {
    if (!isActive || batchReadingId) return;
    setBatchReadingId(panelId);
    const failed = {};

    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      setBatchProgress(`${p.label} okunuyor… (${i + 1}/${params.length})`);
      const success = await readOneValue(p, { keepStale: true });
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

  // ── Canlı Telemetri / MSP Telemetri — otomatik yenileme ──
  // Bu iki sekmede manuel "Oku" butonu YOK — sayfaya girer girmez otomatik
  // başlar, değerler arka planda sessizce (mesaj/ilerleme göstermeden) art
  // arda okunup her turun bitiminde ~1 saniye beklenip yeniden başlar.
  // keepStale:true sayesinde yeni değer gelene kadar eskisi ekranda kalır —
  // "——" a dönüp tekrar dolma (flicker/yanıp sönme) olmaz.
  useEffect(() => {
    if (!isActive) return;
    if (activeSection !== "telemetry" && activeSection !== "msp-tele") return;
    const params = activeSection === "telemetry" ? TELEMETRY : MSP_TELEMETRY;

    let cancelled = false;
    let timer;
    const tick = async () => {
      if (cancelled) return;
      if (!batchReadingIdRef.current) {
        for (const p of params) {
          if (cancelled) return;
          if (batchReadingIdRef.current) break;
          await readOneValue(p, { keepStale: true });
        }
      }
      if (!cancelled) timer = setTimeout(tick, 1000);
    };
    tick();

    return () => { cancelled = true; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, activeSection]);

  // MSP Telemetri kartlarındaki tek değişken "Oku" butonu. Otomatik yenileme
  // döngüsü aynı anda çalışıp cevap yuvasını ezmesin diye okuma süresince
  // batchReadingId işaretleniyor (döngü bunu görüp o turu bırakıyor).
  const readSingleTelemetry = async (p) => {
    if (!isActive || batchReadingIdRef.current) return;
    const marker = `single-${p.id}`;
    batchReadingIdRef.current = marker;
    setBatchReadingId(marker);
    const ok = await readOneValue(p, { keepStale: true });
    setFailedReads((prev) => ({ ...prev, [p.id]: !ok }));
    batchReadingIdRef.current = null;
    setBatchReadingId(null);
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
          syncDeviceField(p.id, val);
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
              syncDeviceField(p.id, val);
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
      <span className="text-[12px] text-[var(--accent)] font-medium animate-pulse font-mono min-h-[16px] truncate"
        style={{ visibility: progressMsg ? 'visible' : 'hidden' }}>
        {progressMsg || " "}
      </span>

      <div className="flex items-center gap-2">
        {showBulk && (bulkEditingId === panelId ? (
          <>
            <button onClick={cancelBulkEdit}
              className="text-[11px] font-semibold px-2.5 py-[5px] rounded-lg
                         bg-[var(--bg-subtle)] text-[var(--text-muted)] border border-[var(--border-subtle)]
                         hover:text-[var(--text-primary)] transition cursor-pointer">
              İptal
            </button>
            <button onClick={() => batchSet(params, panelId)}
              disabled={!isActive || bulkSaving}
              className={`flex items-center gap-1.5 text-[12px] font-semibold px-3 py-[5px] rounded-md border transition
                ${(!isActive || bulkSaving)
                  ? "bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
                  : "bg-[var(--accent)] hover:brightness-110 text-white border-[var(--accent)] cursor-pointer"
                }`}>
              <HiOutlinePencilSquare className={`text-[13px] ${bulkSaving ? "animate-spin" : ""}`} />
              {bulkSaving ? "Kaydediliyor…" : "Tümünü Kaydet"}
            </button>
          </>
        ) : (
          <button onClick={() => startBulkEdit(params, panelId)}
            disabled={!isActive || !!bulkEditingId || !!batchReadingId || bulkSaving}
            className={`flex items-center gap-1.5 text-[12px] font-semibold px-3 py-[5px] rounded-md border transition
              ${(!isActive || !!bulkEditingId || !!batchReadingId || bulkSaving)
                ? "bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
                : "bg-amber-500/10 text-amber-500 border-amber-500/30 hover:bg-amber-500/20 cursor-pointer"
              }`}>
            <HiOutlinePencilSquare className="text-[13px]" />
            Toplu Edit
          </button>
        ))}

        <button onClick={() => batchRead(params, panelId)}
          disabled={!isActive || !!batchReadingId || !!bulkEditingId || bulkSaving}
          className={`flex items-center gap-1.5 text-[12px] font-semibold px-3 py-[5px] rounded-md border transition
            ${(!isActive || !!batchReadingId || !!bulkEditingId || bulkSaving)
              ? "bg-[var(--bg-subtle)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
              : "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent-border)] hover:bg-[var(--accent-soft-hover)] cursor-pointer"
            }`}>
          <HiOutlineArrowPath className={`text-[13px] ${batchReadingId === panelId ? "animate-spin" : ""}`} />
          {batchReadingId === panelId ? "Okunuyor…" : "Tümünü Oku"}
        </button>
      </div>
    </div>
    );
  };

  // Bölüm başlığı artık kartın dışında, sayfa düzeyinde çiziliyor (bkz. SECTIONS'taki title/desc)
  const SectionHeader = () => null;

  const renderOcppWifi = () => (
    <>
      <SectionHeader icon={<HiOutlineGlobeAlt />}
        title={restrictedIndividualView ? "WiFi Ayarları" : "OCPP & WiFi Ayarları"}
        subtitle={restrictedIndividualView ? "Kablosuz ağ ayarları ve salt okunur Box bilgisi" : "OCPP endpoint ve kablosuz ağ konfigürasyonu"} />
      <div className="px-1">
        {(restrictedIndividualView ? OCPP_WIFI.filter((p) => [5, 6, 44].includes(p.id)) : OCPP_WIFI).map((p, i, list) => (
          <EditableRow key={p.id} icon={p.icon} label={p.label} id={p.id}
            value={V(p.id)} setOk={setOkMap[p.id]} disabled={!isActive}
            failed={failedReads[p.id]} setFailed={failedSets[p.id]}
            readOnly={restrictedIndividualView && p.id === 44}
            bulkEditing={bulkEditingId === "ocpp"}
            bulkDraft={bulkDrafts[p.id] ?? ""} onBulkDraftChange={updateBulkDraft}
            onSet={(id, val) => sendCommand("set", id, val)}
            onRead={(id) => { setFailedReads((prev) => ({ ...prev, [id]: false })); sendCommand("read", id); }}
            last={i === list.length - 1} />
        ))}
      </div>
      {!restrictedIndividualView && <BatchControls params={OCPP_WIFI} panelId="ocpp" />}
    </>
  );

  const renderUI = () => (
    <>
      <SectionHeader icon={<TbPlugConnected />} title="Bağlantı & UI Ayarları" subtitle="İstasyon görünümü ve haberleşme tercihleri" />
      {(currentUser?.role === "superadmin" || currentUser?.role === "admin") && logoNotifications.length > 0 && (
        <div className="mb-3 px-3 py-2 rounded-lg border border-amber-400/30 bg-amber-400/10 text-[11px] text-amber-700 dark:text-amber-300">
          <b>Logo bildirimi:</b> {logoNotifications[0].company || "Şirket"} hesabı {logoNotifications[0].fileName || "bir logo"} yükledi ({new Date(logoNotifications[0].time).toLocaleString("tr-TR")}).
        </div>
      )}
      <div className="px-1">
        {(restrictedIndividualView ? UI_PARAMS.filter((p) => [7, 62].includes(p.id)) : UI_PARAMS)
          .filter((p) => {
            const logoMode = bulkEditingId === "ui"
              ? String(bulkDrafts[13] ?? readValues[13] ?? "")
              : String(readValues[13] ?? "");
            // Şirket Adı yalnızca Yazı modunda gösterilir.
            return p.id !== 14 || logoMode === "0";
          })
          .map((p, i, list) => {
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
              last={i === list.length - 1} />
          );
          })}

        {!restrictedIndividualView && String(bulkEditingId === "ui" ? (bulkDrafts[13] ?? readValues[13] ?? "") : (readValues[13] ?? "")) === "1" && (
          <LogoUploadPanel
            token={token}
            currentUser={currentUser}
            logoOptions={logoOptions}
            selectedLogo={String(bulkDrafts[64] ?? readValues[64] ?? "")}
            activeLogo={String(readValues[65] ?? "")}
            onSelectLogo={(logo) => {
              if (bulkEditingId === "ui") updateBulkDraft(64, logo);
              else setReadValues((prev) => ({ ...prev, 64: logo }));
            }}
            onReadActiveLogo={() => fireRead(65)}
            readingActiveLogo={!!readLoading[65]}
            onApply={async (logo, progress) => {
              if (!isActive) throw new Error("ESP aktif değil");
              progress?.("Logo adı cihaza atanıyor…");
              if (!await sendCommand("set", 64, logo)) throw new Error("Logo adı gönderilemedi");
              progress?.("Logo aktifleştiriliyor…");
              if (!await sendCommand("set", 63, "1")) throw new Error("Logo güncelleme başlatılamadı");
              // Güncelleme bayrağı ESP boot akışında işlenir; cihazın indirip
              // servera logo_report gönderebilmesi için reset başlatılır.
              progress?.("Cihaz yeniden başlatılıyor…");
              await new Promise((r) => setTimeout(r, 1200));
              if (!await sendCommand("set", 20, "1", { silent: true })) throw new Error("Cihaz reset komutu gönderilemedi");
              // ESP logo indirdikten sonra yeniden bağlanır. Aktif logo (65)
              // cevabı gelmeden işlemi tamamlanmış sayma.
              for (let i = 0; i < 45; i++) {
                await new Promise((r) => setTimeout(r, 1000));
                try {
                  if (i % 3 === 0) {
                    await authFetch("/api/send-command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "read", variable: 65, value: "" }) });
                  }
                  const resp = await authFetch("/api/responses");
                  const data = await resp.json();
                  const found = responseMessages(data.message_response).find((m) =>
                    Number(m.cmd) === 2 && Number(m.msg) === 65 &&
                    normalizeLogoName(m.data) === normalizeLogoName(logo));
                  if (found) {
                    progress?.("Sunucu bildirimi alındı; aktif logo kontrol ediliyor…");
                    setReadValues((prev) => ({ ...prev, 64: logo, 65: logo }));
                    return;
                  }
                } catch {}
              }
              throw new Error("Cihaz resetlendi ancak aktif logo doğrulaması alınamadı");
            }}
            onUploaded={async (d) => {
              await refreshLogoOptions();
              if (d?.logoName) setReadValues((prev) => ({ ...prev, 64: d.logoName }));
            }}
            onDeleted={() => { updateBulkDraft(64, ""); setReadValues((prev) => ({ ...prev, 64: "" })); refreshLogoOptions(); }}
          />
        )}

      </div>
      {!restrictedIndividualView && <BatchControls params={UI_PARAMS} panelId="ui" />}
    </>
  );

  const renderMspConfig = () => {
    const items = [...MSP_CONFIG_BASE, ...(isAdmin ? MSP_CONFIG_ADMIN : [])];
    const oneShotItems = items.filter((p) => p.isOneShot);
    const dropdownItems = items.filter((p) => !p.isOneShot);

    return (
      <>
        <SectionHeader icon={<HiOutlineCog6Tooth />} title="MSP Konfigürasyon"
          subtitle="Metering & Supply Processor: ölçüm ve güç besleme portalı" />

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
                    <span className="text-[13px] text-[var(--text-secondary)] font-medium flex-1 text-left">{p.label}</span>
                    <button
                      disabled={!isActive || isLoading}
                      onClick={() => fireOneShot(p.id, p.sendValue || "1", p.successMsg)}
                      className={`text-[11px] font-bold px-3 py-[4px] rounded-md border transition
                        ${(!isActive || isLoading)
                          ? "bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
                          : "bg-rose-500/10 text-rose-500 border-rose-500/30 hover:bg-rose-500/20 cursor-pointer"
                        }`}
                    >
                      {isLoading ? "Bekleniyor…" : (p.btnLabel || "Gönder")}
                    </button>
                  </div>
                  {okMsg && (
                    <span className={`text-[11px] font-medium pl-6 font-mono ${isFail ? "text-rose-400" : "text-emerald-400"}`}>
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
            <div className="text-[11px] font-bold tracking-[0.2em] uppercase text-[var(--text-muted)] mb-2 px-1">
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
    const isRfidCharge = String(readValues[19] ?? "") === "1";
    const visibleEspCtrl = ESP_CTRL.filter((p) => {
      if (p.id === 19 && !isAdmin) return false; // ESP Modu sadece Panel'de (Dashboard'da gizli)
      if (restrictedIndividualView && (p.id === 19 || p.id === 38 || p.id === 45)) return false; // OCPP alanları bireysel cihazda yok
      if ((p.id === 66 || p.id === 67) && !isRfidCharge) return false; // sadece RFID Charge iken
      return true;
    });

    return (
    <>
      <SectionHeader icon={<HiOutlineCpuChip />} title="ESP Kontrol" subtitle="Embedded Screen Processor: ekran ve arayüz portalı" />
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
                  <span className="text-[13px] text-[var(--text-muted)]">{p.label}:</span>
                  <span className="text-[13px] text-[var(--text-primary)] font-semibold flex-1 font-mono">{V(p.id)}</span>
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
                      <HiOutlineArrowPath className={`text-[12px] ${isRdLoading ? "animate-spin" : ""}`} />
                    </button>
                  )}
                </div>
                {rdFb && (
                  <span className={`text-[11px] font-medium pl-6 font-mono ${rdFail ? "text-rose-400" : "text-emerald-400"}`}>
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
                <span className="text-[13px] text-[var(--text-secondary)] font-medium flex-1 text-left">{p.label}</span>
                <span className={`text-[10px] font-bold mr-1 tracking-wider uppercase ${isOn ? "text-emerald-400" : "text-[var(--text-muted)]"}`}>
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
                  <span className="text-[13px] text-[var(--text-secondary)] font-medium flex-1 text-left">{p.label}</span>
                  <button
                    disabled={!isActive || isLoading}
                    onClick={() => fireOneShot(p.id, p.sendValue || "1", p.successMsg)}
                    className={`text-[11px] font-bold px-3 py-[4px] rounded-md border transition
                      ${(!isActive || isLoading)
                        ? "bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
                        : "bg-rose-500/10 text-rose-500 border-rose-500/30 hover:bg-rose-500/20 cursor-pointer"
                      }`}
                  >
                    {isLoading ? "Bekleniyor…" : (p.btnLabel || "Gönder")}
                  </button>
                </div>
                {okMsg && (
                  <span className={`text-[11px] font-medium pl-6 font-mono ${isFail ? "text-rose-400" : "text-emerald-400"}`}>
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
          <span className="text-[13px] text-[var(--text-muted)]">Şarj Durumu:</span>
          <span className={`text-[13px] font-bold flex-1 font-mono ${
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
            <HiOutlineArrowPath className={`text-[12px] ${readLoading[25] ? "animate-spin" : ""}`} />
          </button>
        </div>
        {readFeedback[25] && (
          <span className={`text-[11px] font-medium pl-6 font-mono ${readFeedback[25].includes("✕") ? "text-rose-400" : "text-emerald-400"}`}>
            {readFeedback[25]}
          </span>
        )}
      </div>
    </>
    );
  };

  // Bu kartlarda artık manuel "Oku" butonu yok — değerler sayfa açılır açılmaz
  // arka planda otomatik okunup sessizce güncelleniyor (bkz. yukarıdaki
  // otomatik yenileme efekti).
  // "Bağlan"/"Kopar" iki ayrı buton yerine tek bir açma/kapama switch —
  // kapalıyken tıklamak forma submit ettirip bağlanmayı tetikler (Enter ile
  // de çalışsın diye type=submit), açıkken tıklamak direkt koparir.
  const ConnectSwitch = () => (
    <button
      type={isConnected ? "button" : "submit"}
      onClick={isConnected ? handleDisconnect : undefined}
      disabled={loading}
      title={isConnected ? "Bağlantıyı kes" : "Bağlan"}
      className={`relative shrink-0 w-12 h-7 rounded-full border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed
        ${isConnected ? "bg-emerald-500 border-emerald-400" : "bg-[var(--bg-subtle)] border-[var(--border-subtle)]"}`}
    >
      <span className={`absolute top-[3px] w-[22px] h-[22px] rounded-full bg-white shadow transition-all duration-200 flex items-center justify-center
        ${isConnected ? "left-[23px]" : "left-[3px]"}`}>
        {loading && <HiOutlineArrowPath className="text-[12px] text-[var(--text-muted)] animate-spin" />}
      </span>
    </button>
  );

  // "ESP Reset" gibi kritik/az kullanılan işlemler artık ana barda ayrı bir
  // buton değil, üç nokta menüsünün içinde — yanlışlıkla tıklanma riski azalsın.
  const ConnectOptionsMenu = () => (
    <div className="relative shrink-0" data-connect-menu>
      <button type="button" onClick={() => setConnectMenuOpen((v) => !v)}
        title="Diğer işlemler"
        className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition cursor-pointer">
        <HiOutlineEllipsisVertical className="text-[16px]" />
      </button>
      {connectMenuOpen && (
        <div className="absolute right-0 top-full mt-1.5 z-30 w-44 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-lg py-1">
          <button type="button"
            onClick={() => { setConnectMenuOpen(false); handleEspReset(); }}
            disabled={!isConnected || !isActive || oneShotLoading[20]}
            className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-semibold text-amber-500 hover:bg-amber-500/10
                       disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition text-left">
            <HiOutlineArrowPath className={`text-[14px] ${oneShotLoading[20] ? "animate-spin" : ""}`} />
            {oneShotLoading[20] ? "Resetleniyor…" : "ESP Reset"}
          </button>
          <button type="button"
            onClick={() => { setConnectMenuOpen(false); setDiagOpen(true); }}
            disabled={!isConnected}
            className="w-full flex items-center gap-2 px-3 py-2 text-[13px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]
                       disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition text-left">
            <HiOutlineWrenchScrewdriver className="text-[14px]" />
            Cihaz Tanılama
          </button>
        </div>
      )}
    </div>
  );

  const renderTelemetryCard = (p, showStateColor = false, withRead = false) => (
    <div key={p.id} className="bg-[var(--bg-subtle)] border border-[var(--border-subtle)] rounded-lg px-2.5 py-2.5 flex flex-col hover:border-[var(--accent-border)] transition-colors">
      <div className="flex items-center gap-1 mb-1.5 min-h-[14px]">
        {p.icon && <span className="text-[12px] text-[var(--text-secondary)] shrink-0">{p.icon}</span>}
        <span className="text-[10px] text-[var(--text-secondary)] font-semibold tracking-wide uppercase truncate">{p.label}</span>
        <span className="text-[9px] text-amber-400 ml-auto font-mono shrink-0" style={{ visibility: failedReads[p.id] ? 'visible' : 'hidden' }}>!</span>
        {withRead && (
          <button type="button" title="Oku"
            disabled={!isActive || !!batchReadingId}
            onClick={() => readSingleTelemetry(p)}
            className={`shrink-0 w-5 h-5 rounded-full border flex items-center justify-center text-[12px] transition
              ${(!isActive || !!batchReadingId)
                ? "text-[var(--text-muted)] border-[var(--border-subtle)] opacity-50 cursor-not-allowed"
                : "text-[var(--accent)] border-[var(--accent-border)] hover:bg-[var(--accent-soft)] cursor-pointer"}`}>
            <HiOutlineArrowPath className={batchReadingId === `single-${p.id}` ? "animate-spin" : ""} />
          </button>
        )}
      </div>
      <div className="flex items-baseline gap-1 min-h-[20px]">
        <span className={`text-[14px] font-bold tracking-tight font-display leading-none truncate ${
          showStateColor && p.id === 25 ? (
            csColor(readValues[25]) === "green" ? "text-emerald-400" :
            csColor(readValues[25]) === "yellow" ? "text-amber-400" :
            csColor(readValues[25]) === "blue" ? "text-[var(--accent)]" : "text-[var(--text-primary)]"
          ) : "text-[var(--text-primary)]"
        }`}>
          {V(p.id) || "——"}
        </span>
        {p.unit && <span className="text-[10px] font-semibold text-[var(--text-secondary)] font-mono shrink-0">{p.unit}</span>}
      </div>
    </div>
  );

  const renderTelemetry = () => (
    <>
      <SectionHeader icon={<TbActivity />} title="Canlı Telemetri" subtitle="Anlık şarj verileri ve cihaz durumu" />
      <div className="flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-[11px] tracking-widest uppercase font-bold text-emerald-400 font-mono">Live Stream</span>
      </div>
      <TelemetryHero
        power={V(23)} energy={V(24)} duration={V(22)} status={V(25) || "——"}
        statusColor={csColor(readValues[25])} online={isActive} theme={theme}
        icons={{ power: <BsLightningCharge />, energy: <BsBattery />, duration: <HiOutlineClock />, status: <TbAlertCircle /> }}
      />
    </>
  );

  const renderMspTelemetry = () => (
    <>
      <SectionHeader icon={<HiOutlineSignal />} title="MSP Telemetri" subtitle="Metering & Supply Processor: ölçüm ve güç besleme portalı" />
      <div className="flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        <span className="text-[11px] tracking-widest uppercase font-bold text-amber-400 font-mono">Live Stream</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {MSP_TELEMETRY.map((p) => renderTelemetryCard(p, false, true))}
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
                    <span className="text-[13px] text-[var(--text-secondary)] font-medium">{p.label}</span>
                  </div>
                  <button
                    disabled={!isActive || isLoading}
                    onClick={() => fireOneShot(p.id, p.sendValue || "1", p.successMsg)}
                    className={`text-[11px] font-bold px-3 py-[4px] rounded-md border transition shrink-0
                      ${(!isActive || isLoading)
                        ? "bg-[var(--bg-sunken)] text-[var(--text-muted)] border-[var(--border-subtle)] cursor-not-allowed opacity-50"
                        : `${btnColor} cursor-pointer`
                      }`}
                  >
                    {isLoading ? "Bekleniyor…" : (p.btnLabel || "Gönder")}
                  </button>
                </div>
                {okMsg && (
                  <span className={`text-[11px] font-medium pl-6 font-mono ${isFail ? "text-rose-400" : "text-emerald-400"}`}>
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
                  <span className="text-[13px] text-[var(--text-muted)]">Aktif Logo:</span>
                  <span className="text-[13px] text-[var(--text-primary)] font-semibold font-mono">{V(65)}</span>
                  {failedReads[65] && (
                    <span className="text-[11px] text-amber-400 font-medium">okunamadı</span>
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
                  <HiOutlineArrowPath className={`text-[12px] ${isRdLoading ? "animate-spin" : ""}`} />
                </button>
              </div>
              {rdFb && (
                <span className={`text-[11px] font-medium pl-6 font-mono ${rdFail ? "text-rose-400" : "text-emerald-400"}`}>
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

  const activeMetaBase = SECTIONS.find((x) => x.key === activeSection);
  const activeMeta = restrictedIndividualView && activeSection === "ocpp-wifi"
    ? { ...activeMetaBase, title: "WiFi Ayarları", desc: "Kablosuz ağ ayarları ve salt okunur Box bilgisi" }
    : activeMetaBase;

  const renderSection = () => {
    switch (activeSection) {
      case "overview": return <Overview token={token} currentUser={currentUser} onNavigate={navigateToSection}
        canOpen={(key) => visibleSections.some((s) => s.key === key)} />;
      case "device-select": return <DeviceSelect token={token}
        autoOpenClaim={deviceSelectClaimOpen}
        onClaimOpenHandled={() => setDeviceSelectClaimOpen(false)}
        isSuperadmin={currentUser?.role === "superadmin"}
        onSelect={(device) => {
          if (device?.id !== undefined && device?.id !== null) setSelectedDeviceId(String(device.id));
          if (device?.mac) setMac(device.mac);
        }}
        onConnect={handleDeviceConnected} />;
      case "ocpp-wifi":  return renderOcppWifi();
      case "ui":         return renderUI();
      case "msp-config": return renderMspConfig();
      case "esp-ctrl":   return renderEspCtrl();
      case "telemetry":  return renderTelemetry();
      case "msp-tele":   return renderMspTelemetry();
      case "ocpp-creds": return restrictedIndividualView ? renderOcppWifi() : renderOcppCreds();
      case "logs":       return restrictedIndividualView ? renderOcppWifi() : <DeviceLogs token={token} isConnected={isConnected} isActive={isActive} mac={mac} />;
      case "ota":        return currentUser?.role === "superadmin" ? renderOTA() : renderOcppWifi();
      case "connections": return isAdmin
                           ? <Connections token={token} isSuperadmin={currentUser?.role === "superadmin"} />
                           : renderOcppWifi();
      case "device-setup": return (currentUser?.role === "superadmin" || currentUser?.role === "admin")
                           ? <DeviceSetup token={token} isActive={isActive} sendCommand={sendCommand} setReadValues={setReadValues} syncDeviceField={syncDeviceField} />
                           : renderOcppWifi();
      case "bulk-update": return (currentUser?.role === "superadmin" || currentUser?.role === "admin")
                           ? <BulkUpdate token={token} />
                           : renderOcppWifi();
      case "bulk-param":  return restrictedIndividualView ? renderOcppWifi() : (currentUser?.role === "superadmin" || currentUser?.role === "admin" || currentUser?.role === "operator")
                           ? <BulkParamUpdate token={token} />
                           : renderOcppWifi();
      case "device-status": return restrictedIndividualView ? renderOcppWifi() : (currentUser?.role === "superadmin" || currentUser?.role === "admin" || currentUser?.role === "operator")
                           ? <DeviceStatusBoard token={token} currentUser={currentUser} onConnect={handleDeviceConnected} />
                           : renderOcppWifi();
      case "device-mgmt": return (currentUser?.role === "superadmin" || currentUser?.role === "admin")
                           ? <DeviceManagement token={token} currentUser={currentUser} />
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
      case "account":    return <AccountSettings token={token} currentUser={currentUser}
                           onEmailUpdated={(email) => setCurrentUser((prev) => (prev ? { ...prev, email } : prev))}
                           onLogout={onLogout} />;
      default:           return renderOcppWifi();
    }
  };

  return (
    <div className="min-h-screen flex bg-[var(--bg-app)] text-[var(--text-primary)] font-body">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

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
          --bg-input: #0b1220;
          --accent: #3b82f6;
          --accent-soft: rgba(59, 130, 246, 0.10);
          --accent-soft-hover: rgba(59, 130, 246, 0.18);
          --accent-border: rgba(59, 130, 246, 0.28);
        }
        :root.theme-light {
          --bg-app: #f4f6fa;
          --bg-sidebar: #ffffff;
          --bg-surface: #ffffff;
          --bg-subtle: #f8fafc;
          --bg-sunken: #f1f5f9;
          --bg-hover: #eef2f7;
          --border-subtle: rgba(15, 23, 42, 0.10);
          --border-strong: rgba(15, 23, 42, 0.20);
          --text-primary: #0b1220;
          --text-secondary: #1e293b;
          --text-muted: #475569;
          --bg-input: #ffffff;
          --accent: #2563eb;
          --accent-soft: rgba(37, 99, 235, 0.10);
          --accent-soft-hover: rgba(37, 99, 235, 0.18);
          --accent-border: rgba(37, 99, 235, 0.35);
        }
        /* iOS PWA safe area — status bar yüksekliği */
        @supports (padding: max(0px)) {
          .safe-top    { padding-top: max(0.5rem, env(safe-area-inset-top)); }
          .safe-bottom { padding-bottom: max(0.5rem, env(safe-area-inset-bottom)); }
          .safe-left   { padding-left: max(1rem, env(safe-area-inset-left)); }
          .safe-right  { padding-right: max(1rem, env(safe-area-inset-right)); }
        }

        .font-display { font-family: 'Plus Jakarta Sans', ui-sans-serif, system-ui, sans-serif; }
        /* Jakarta'nın kelime boşluğu dar — sıkı harf aralığıyla kelimeler yapışmasın */
        .font-display.font-display { letter-spacing: -0.012em; word-spacing: 0.1em; }
        .font-body    { font-family: 'Inter', ui-sans-serif, system-ui, sans-serif; }
        .font-mono    { font-family: 'JetBrains Mono', ui-monospace, Menlo, monospace; }

        .custom-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
        .custom-scroll::-webkit-scrollbar-track { background: transparent; }
        .custom-scroll::-webkit-scrollbar-thumb {
          background: var(--border-strong); border-radius: 3px;
        }
        .custom-scroll::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

        /* Giriş kutuları her sayfada aynı: beyaz zemin, ince kenarlık, odakta vurgu halkası.
           (.theme-x main ... seçicisi tek tek sayfalardaki sınıfları ezer.) */
        main input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=range]):not([type=color]),
        main select, main textarea {
          background-color: var(--bg-input);
          border: 1px solid var(--border-strong);
          border-radius: 8px;
          transition: border-color .15s, box-shadow .15s;
        }
        main input:not([type=checkbox]):not([type=radio]):focus, main select:focus, main textarea:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px var(--accent-soft-hover);
          outline: none;
        }
        main input::placeholder, main textarea::placeholder { color: var(--text-muted); opacity: .75; }
        .theme-light .app-bg { background: linear-gradient(180deg, #f7f9fc 0%, #eef2f8 100%); }

        .theme-light input, .theme-light select { color-scheme: light; }
        .theme-dark input, .theme-dark select { color-scheme: dark; }
      `}</style>

      <Sidebar
        sections={visibleSections}
        activeSection={activeSection}
        onSectionChange={navigateToSection}
        activePage={isAdmin ? "panel" : "dashboard"}
        onNavigate={onNavigate}
        onLogout={onLogout}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        mobileOpen={sidebarMobileOpen}
        onCloseMobile={() => setSidebarMobileOpen(false)}
        currentUser={currentUser}
        canOpenPanel={currentUser?.role !== "operator"}
        onOpenAccount={() => navigateToSection("account")}
      />

      <div className="flex-1 flex flex-col min-w-0 app-bg">
        {/* Top Connection Bar — mobilde 2 satır, masaüstünde tek satır */}
        <header className="sticky top-0 z-20 bg-[var(--bg-sidebar)]/95 backdrop-blur-md border-b border-[var(--border-subtle)] safe-top">
          {/* ── 1. Satır: Hamburger + Status Badge ── */}
          <div className="flex items-center gap-3 px-4 sm:px-6 min-h-[52px] sm:min-h-[60px]">
            <button
              onClick={() => setSidebarMobileOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-hover)] transition shrink-0"
              aria-label="Menu"
            >
              <HiOutlineBars3 className="text-xl" />
            </button>

            {isConnected && (connectedName || shownMac) && (
              <span className="hidden md:inline-flex items-center gap-2 min-w-0 text-[12px]">
                {connectedName && <span className="font-semibold text-[var(--text-primary)] truncate">{connectedName}</span>}
                <LocationEditButton device={connectedDevice} authFetch={authFetch} onSaved={onConnectedLocationSaved} />
                {shownMac && <span className="text-[var(--text-muted)] font-mono tracking-tight shrink-0">{shownMac}</span>}
              </span>
            )}

            {/* Aynı MAC'e bağlı diğer kullanıcılar badge'i */}
            {isConnected && otherUsersOnSameMac.length > 0 && (
              <div
                className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border tracking-wide
                           bg-amber-500/10 border-amber-500/30 text-amber-500 cursor-help shrink-0"
                title={"Aynı cihaza bağlı: " + otherUsersOnSameMac.map((u) => u.fullName || u.username).join(", ")}
              >
                <span className="w-[6px] h-[6px] rounded-full bg-amber-400 animate-pulse" />
                {otherUsersOnSameMac.length} kullanıcı daha bağlı
              </div>
            )}

            {/* Mesaj — masaüstünde satırın içinde, her zaman alan kaplar (layout shift önle) */}
            <div className="flex-1 min-w-0" aria-live="polite">
              {message && (
                <div className="hidden sm:block max-w-full w-fit px-3 py-1.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[13px] text-[var(--text-secondary)] font-mono truncate">
                  {message}
                </div>
              )}
            </div>

            {/* Durum rozeti — sağda, zarif/transparan */}
            <div className={`inline-flex items-center gap-1.5 px-1 text-[11.5px] font-bold tracking-wide shrink-0 ${badge.tc}`}>
              <span className={`w-[6px] h-[6px] rounded-full ${badge.d}`} />
              {badge.t}
            </div>

            {/* Masaüstünde form sağda — mobilde GİZLİ, aşağıda 2. satıra düşer */}
            <form onSubmit={handleSubmit} className="hidden sm:flex gap-2 items-center shrink-0">
              {isOperator ? (
                <>
                  <select value={selectedDeviceId} onChange={(e) => setSelectedDeviceId(e.target.value)} required
                    className="bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                               px-3 py-1.5 rounded-lg text-[13px] outline-none
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
                  <button type="button" onClick={() => { setDeviceSelectClaimOpen(true); navigateToSection("device-select"); }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-2.5 py-1.5 text-[12px] font-semibold text-[var(--accent)] transition hover:bg-[var(--accent-soft-hover)]"
                    title="Cihaz ekle">
                    <HiOutlinePlus className="text-[14px]" /> Ekle
                  </button>
                </>
              ) : (
                <input value={mac} onChange={(e) => setMac(e.target.value)}
                  placeholder="AA:BB:CC:DD:EE:FF" required
                  className="bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                             px-3 py-1.5 rounded-lg text-[13px] font-mono outline-none placeholder:text-[var(--text-muted)]
                             focus:border-[var(--accent)] transition w-44" />
              )}
              <ConnectSwitch />
              <ConnectOptionsMenu />
            </form>

            {/* Kullanıcı menüsü — Hesap / Tema / Çıkış */}
            {currentUser && (
              <div className="hidden lg:block relative pl-4 ml-1 border-l border-[var(--border-subtle)] shrink-0">
                <button onClick={() => setUserMenuOpen((o) => !o)}
                  className="flex items-center gap-2.5 cursor-pointer group">
                  <span className="w-9 h-9 rounded-full bg-[var(--accent)] text-white flex items-center justify-center text-[13px] font-bold">
                    {(currentUser.fullName || currentUser.username || "?").charAt(0).toUpperCase()}
                  </span>
                  <span className="flex flex-col items-start leading-tight">
                    <span className="text-[13px] font-semibold text-[var(--text-primary)] max-w-[160px] truncate">
                      {currentUser.fullName || currentUser.username}
                    </span>
                    <span className="text-[11px] text-[var(--text-muted)]">
                      {currentUser.role === "superadmin" ? "Superadmin" : currentUser.role === "admin" ? "Admin" : "Operatör"}
                    </span>
                  </span>
                  <HiOutlineChevronDown className={`text-[13px] text-[var(--text-muted)] transition-transform ${userMenuOpen ? "rotate-180" : ""}`} />
                </button>
                {userMenuOpen && (
                  <>
                    <button aria-label="Menüyü kapat" onClick={() => setUserMenuOpen(false)} className="fixed inset-0 z-30 cursor-default" />
                    <div className="absolute right-0 top-full mt-2 z-40 w-52 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-xl py-1.5">
                      <button onClick={() => { setUserMenuOpen(false); navigateToSection("account"); }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] cursor-pointer">
                        <HiOutlineUserCircle className="text-[16px]" /> Hesap Yönetimi
                      </button>
                      <button onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] cursor-pointer">
                        {theme === "dark" ? <HiOutlineSun className="text-[16px]" /> : <HiOutlineMoon className="text-[16px]" />}
                        {theme === "dark" ? "Açık Tema" : "Koyu Tema"}
                      </button>
                      <div className="my-1.5 border-t border-[var(--border-subtle)]" />
                      <button onClick={() => { setUserMenuOpen(false); onLogout?.(); }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] font-medium text-rose-500 hover:bg-rose-500/10 cursor-pointer">
                        <HiOutlineArrowRightOnRectangle className="text-[16px]" /> Çıkış Yap
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── 2. Satır: Mobilde MAC input + butonlar ── */}
          <form onSubmit={handleSubmit} className="sm:hidden flex gap-2 items-center px-4 pb-3">
            {isOperator ? (
              <>
                <select value={selectedDeviceId} onChange={(e) => setSelectedDeviceId(e.target.value)} required
                  className="flex-1 min-w-0 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                             px-3 py-2 rounded-lg text-[14px] outline-none
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
                <button type="button" onClick={() => { setDeviceSelectClaimOpen(true); navigateToSection("device-select"); }}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-soft)] px-2.5 py-2 text-[12px] font-semibold text-[var(--accent)] transition hover:bg-[var(--accent-soft-hover)]"
                  title="Cihaz ekle">
                  <HiOutlinePlus className="text-[14px]" /> Ekle
                </button>
              </>
            ) : (
              <input value={mac} onChange={(e) => setMac(e.target.value)}
                placeholder="AA:BB:CC:DD:EE:FF" required
                className="flex-1 min-w-0 bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[var(--text-primary)]
                           px-3 py-2 rounded-lg text-[14px] font-mono outline-none placeholder:text-[var(--text-muted)]
                           focus:border-[var(--accent)] transition" />
            )}
            <ConnectSwitch />
            <ConnectOptionsMenu />
          </form>

          {/* MAC mobilde küçük altta — sadece bağlıyken göster */}
          {isConnected && (connectedName || shownMac) && (
            <div className="md:hidden px-4 pb-2 text-[11px] text-[var(--text-muted)] flex flex-wrap items-center gap-x-1">
              {connectedName && <span className="font-semibold text-[var(--text-primary)]">{connectedName}</span>}
              <LocationEditButton device={connectedDevice} authFetch={authFetch} onSaved={onConnectedLocationSaved} />
              {connectedName && shownMac && " · "}
              {shownMac && <span className="font-mono tracking-tight">{shownMac}</span>}
              {otherUsersOnSameMac.length > 0 && (
                <span className="ml-2 text-amber-500 font-bold">
                  · {otherUsersOnSameMac.length} kullanıcı daha
                </span>
              )}
            </div>
          )}

          {/* Mesaj — mobilde altta ayrı satır */}
          {message && (
            <div className="sm:hidden px-4 pb-2" aria-live="polite">
              <div className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-subtle)] border border-[var(--border-subtle)] text-[13px] text-[var(--text-secondary)] font-mono">
                {message}
              </div>
            </div>
          )}
        </header>

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 lg:py-8">
          <div className="max-w-[1200px] mx-auto">
            {currentUser && !currentUser.email && !emailBannerDismissed && (
              <div className="mb-3 pl-3 pr-2 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-2">
                <HiOutlineExclamationTriangle className="text-[14px] text-amber-500 shrink-0" />
                <span className="text-[12px] text-amber-500 font-medium truncate">
                  Kayıtlı e-posta yok — şifre kurtarma için ekleyin.
                </span>
                <button onClick={() => navigateToSection("account")}
                  className="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-md border transition ml-auto
                             bg-amber-500 hover:bg-amber-400 text-white border-amber-400 cursor-pointer">
                  Ekle
                </button>
                <button onClick={() => setEmailBannerDismissed(true)} title="Kapat"
                  className="shrink-0 p-1 rounded-md text-amber-500/70 hover:text-amber-500 hover:bg-amber-500/10 transition cursor-pointer">
                  <HiOutlineXMark className="text-[14px]" />
                </button>
              </div>
            )}
            {activeMeta && activeSection !== "overview" && (
              <div className="mb-5">
                <h1 className="text-[26px] font-bold font-display tracking-tight text-[var(--text-primary)]">{activeMeta.title || activeMeta.label}</h1>
                {activeMeta.desc && <p className="text-[14px] text-[var(--text-muted)] mt-0.5 max-w-[820px]">{activeMeta.desc}</p>}
              </div>
            )}
            {BARE_SECTIONS.includes(activeSection) ? renderSection() : (
            <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-xl p-5 sm:p-6 shadow-[0_1px_2px_rgba(15,23,42,0.05)]">
              {renderSection()}
            </div>
            )}

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
            <p className="text-[14px] text-[var(--text-secondary)] mb-2 leading-relaxed">
              Bu şarj cihazına bağlantınızı
              {" "}
              <span className="font-bold text-[var(--text-primary)]">{deactivatedByModal}</span>
              {" "}
              devraldı.
            </p>
            <p className="text-[12px] text-[var(--text-muted)] mb-5 leading-relaxed">
              Tekrar bağlanmak için üstteki bağlantı anahtarını açabilirsiniz.
            </p>
            <div className="flex justify-end">
              <button
                onClick={ackDeactivatedBy}
                className="px-5 py-2 rounded-lg text-[14px] font-semibold transition cursor-pointer
                           bg-rose-500 hover:bg-rose-400 text-white border border-rose-400 shadow-sm shadow-rose-500/30"
              >
                Tamam
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── "Cihaz Tanılama" — GSM/Hata/UART, üst bardaki (…) menüsünden her sekmeden açılabilir ── */}
      {diagOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setDiagOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-md bg-[var(--bg-surface)] border border-[var(--border-subtle)]
                       rounded-t-2xl sm:rounded-2xl p-5 max-h-[80vh] overflow-y-auto shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-[var(--accent-soft)] border border-[var(--accent-border)] flex items-center justify-center text-[var(--accent)] text-[16px] shrink-0">
                  <HiOutlineWrenchScrewdriver />
                </div>
                <div>
                  <h3 className="text-[14px] font-bold text-[var(--text-primary)] font-display tracking-tight leading-tight">Cihaz Tanılama</h3>
                  <p className="text-[11px] text-[var(--text-muted)]">GSM sinyali, hata ve UART durumu</p>
                </div>
              </div>
              <button onClick={() => setDiagOpen(false)}
                className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition cursor-pointer shrink-0">
                <HiOutlineXMark className="text-[16px]" />
              </button>
            </div>
            {isConnected ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {TELEMETRY.filter((p) => ![22, 23, 24, 25].includes(p.id)).map((p) => renderTelemetryCard(p, true, true))}
              </div>
            ) : (
              <p className="text-[13px] text-[var(--text-muted)] text-center py-6">Önce bir cihaza bağlanın.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
