/* ═══════════════════════════════════════════════════════════════
   Kullanici bazli cihaz yetkilendirme

   Bir kullanicinin erisebilecegi cihaz kumesi:
       company'sindeki cihazlar   UNION   allowedMacs listesindeki cihazlar

   users.json'daki ilgili alanlar:
     company     : "Çelikler"                  (sirket bazli erisim)
     allowedMacs : ["AA:BB:CC:DD:EE:FF", ...]  (tek tek cihaz erisimi)

   Ikisi birlikte kullanilabilir: "Celikler'in hepsi + su iki ekstra cihaz".

   ONEMLI: Bu kontrol SADECE arayuzde degil, HER endpoint'te uygulanmali.
   Arayuzde MAC kutusunu gizlemek yeterli degil — kullanici API'ye
   dogrudan istek atabilir.
   ═══════════════════════════════════════════════════════════════ */

const { getDevices } = require("./db");

/* Kullanicinin kapsamini cikar.
   - superadmin           : her zaman serbest
   - admin, kisit yok     : serbest (geriye donuk uyumluluk — mevcut
                            admin hesaplarinda company null)
   - operator, kisit yok  : HICBIR cihaz (guvenli varsayilan)
   - kisit tanimli        : company + allowedMacs birlesimi
*/
function buildScope(user, role) {
  if (role === "superadmin") return { unrestricted: true };

  const company = user?.company || null;
  const macs = Array.isArray(user?.allowedMacs)
    ? user.allowedMacs.map((m) => String(m).trim().toUpperCase()).filter(Boolean)
    : [];

  if (!company && macs.length === 0) {
    if (role === "operator") {
      // Kapsami tanimlanmamis operator hicbir sey goremez.
      return { unrestricted: false, company: null, macSet: new Set(), undefinedScope: true };
    }
    return { unrestricted: true };
  }

  return { unrestricted: false, company, macSet: new Set(macs) };
}

function allowsDevice(scope, device) {
  if (scope.unrestricted) return true;
  if (!device) return false;
  if (scope.company && device.company === scope.company) return true;
  if (device.mac && scope.macSet.has(String(device.mac).toUpperCase())) return true;
  return false;
}

/* MAC ile dogrudan erisim kontrolu — Dashboard'daki MAC kutusu ve
   Toplu Guncelleme'deki elle MAC girisi bu yoldan geciyor. */
function allowsMac(scope, mac) {
  if (scope.unrestricted) return true;
  if (!mac) return false;

  const up = String(mac).toUpperCase();
  if (scope.macSet.has(up)) return true;
  if (!scope.company) return false;

  const dev = getDevices({}).find((d) => String(d.mac || "").toUpperCase() === up);
  return !!dev && dev.company === scope.company;
}

function visibleDevices(scope) {
  const all = getDevices({});
  if (scope.unrestricted) return all;
  return all.filter((d) => allowsDevice(scope, d));
}

module.exports = { buildScope, allowsDevice, allowsMac, visibleDevices };