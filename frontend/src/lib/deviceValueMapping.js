/* ── Helpers — Home.jsx'ten taşındı ── */
export function mapValue(id, raw) {
  if (raw === undefined || raw === null) return "——";
  const v = String(raw);
  if (id === 7) return ({ "0": "CommSupported", "1": "GSM", "2": "WiFi", "3": "ETH" })[v] || v;
  if (id === 13) return v === "0" ? "Yazı" : v === "1" ? "Logo" : v;
  if (id === 35) return v === "0" ? "Gradient" : v === "1" ? "Renk" : v;
  if (id === 27) return v === "0" ? "Hata Yok" : `Hata: ${v}`;
  if (id === 25) {
    // Cihazın gönderdiği ham durum kodları — firmware'deki switch(currentState)
    // case'leriyle BİREBİR aynı (P1_IDLE...P6_ERR). Sıra önemli: "CHARGE_ENDED"
    // "CHARGING" ile karışmasın diye önce o kontrol ediliyor (biri diğerinin
    // alt string'i değil ama okunurluk için en spesifikten genele gidiyoruz).
    if (/^P5_CHARGE_ENDED/i.test(v)) return "Şarj Bitti, Soket Takılı";
    if (/^P4_CHARGING/i.test(v)) return "Şarj Oluyor";
    if (/^P3_SCAN_RFID/i.test(v)) return "Soket Takılı, Şarj Yok";
    if (/^P2_PLUG_IN/i.test(v)) return "Soket Takılı Değil";
    if (/^P6_ERR/i.test(v)) return "Hata";
    if (/^P1_IDLE/i.test(v)) return "Boşta";
    // Eski/kısa sayısal biçim — bazı cihazlar hâlâ 0/1/2 gönderebiliyor.
    return ({ "0": "Beklemede", "1": "Şarj Oluyor", "2": "Tamamlandı" })[v] || v;
  }
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
export function csColor(raw) {
  const v = String(raw);
  if (/^P5_CHARGE_ENDED/i.test(v)) return "blue";
  if (/^P4_CHARGING/i.test(v)) return "green";
  if (/^P3_SCAN_RFID/i.test(v)) return "yellow"; // soket takılı, şarj yok — "bekliyor"
  if (/^P6_ERR/i.test(v)) return "red";
  if (/^P1_IDLE/i.test(v) || /^P2_PLUG_IN/i.test(v)) return undefined; // boşta / soket takılı değil — nötr
  return v === "0" ? "yellow" : v === "1" ? "green" : v === "2" ? "blue" : undefined;
}
