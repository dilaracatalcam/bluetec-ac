/*
 * Türkiye il / ilçe listesi ve konum metninden il-ilçe tahmini.
 *
 * Cihazlarda şehir/ilçe alanı sonradan eklendi; eski kayıtlarda yalnızca serbest
 * metin "location" var ("Antalya Sur Yapı A Parsel Sitesi - 1", "Cuento Sitesi,
 * Ümraniye - AC 1", "Şile" gibi). inferCityDistrict bu metinde geçen il/ilçe
 * adlarını bulur:
 *  - il + o ile ait ilçe geçiyorsa ikisi de
 *  - yalnızca ilçe geçiyor ve bu ad tek bir ile aitse il de ondan
 *  - birden çok ilde bulunan ilçe adı (il yazmıyorsa) belirsiz sayılır, doldurulmaz
 * Veri: data/turkiye-il-ilce.json (turkey-neighbourhoods@4.0.3, MIT).
 */

const { iller } = require("./data/turkiye-il-ilce.json");

// "Merkez" gibi her ilde olan ya da metinde başka anlamda sık geçen adlar eşleşme sayılmaz
const IGNORED_DISTRICTS = new Set(["merkez"]);

function norm(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const cities = Object.keys(iller);
const cityByNorm = new Map(cities.map((c) => [norm(c), c]));
const districtIndex = new Map(); // norm(ilçe) -> [{ city, district }]
for (const [city, districts] of Object.entries(iller)) {
  for (const district of districts) {
    const key = norm(district);
    if (IGNORED_DISTRICTS.has(key)) continue;
    if (!districtIndex.has(key)) districtIndex.set(key, []);
    districtIndex.get(key).push({ city, district });
  }
}

// Metindeki tüm kelime dizilerini (1-3 kelime) aday olarak çıkarır
function phrases(text) {
  const words = norm(text).split(" ").filter(Boolean);
  const out = new Set();
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= 3 && i + n <= words.length; n++) out.add(words.slice(i, i + n).join(" "));
  }
  return out;
}

function inferCityDistrict(location) {
  const found = phrases(location);
  const cityHits = [...found].map((p) => cityByNorm.get(p)).filter(Boolean);
  const districtHits = [...found].flatMap((p) => districtIndex.get(p) || []);

  const city = cityHits.length === 1 ? cityHits[0] : null;
  if (city) {
    const own = districtHits.filter((d) => d.city === city);
    return { city, district: own.length === 1 ? own[0].district : null };
  }
  if (cityHits.length > 1) return { city: null, district: null };

  // İl yazmıyor: tek bir ile ait tek bir ilçe adı geçiyorsa ikisini de al
  const unique = new Map(districtHits.map((d) => [`${d.city}|${d.district}`, d]));
  if (unique.size === 1) {
    const [only] = unique.values();
    return { city: only.city, district: only.district };
  }
  return { city: null, district: null };
}

// Kullanıcının yazdığı il adını resmi yazımına çevirir ("istanbul" -> "İstanbul")
function canonicalCity(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return cityByNorm.get(norm(text)) || text;
}

function canonicalDistrict(city, value) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const list = iller[canonicalCity(city)] || [];
  return list.find((d) => norm(d) === norm(text)) || text;
}

module.exports = { iller, inferCityDistrict, canonicalCity, canonicalDistrict, norm };
