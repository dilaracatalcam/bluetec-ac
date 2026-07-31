import sys, json, re, zipfile
from odf.opendocument import load
from odf.table import Table, TableRow, TableCell, CoveredTableCell
from odf.teletype import extractText

path = sys.argv[1]

# ── Başlık normalize etme ──
# Broker dosyaları zaman zaman başlık isimlerini değiştiriyor (örn. "YAZILIM VERSIYONU" -> "ESP SW VER")
# ve Türkçe karakterleri farklı yazabiliyor (İ/ı, Ç/ç, Ş/ş, Ğ/ğ, Ö/ö, Ü/ü) — hepsini normalize ediyoruz.
def norm(s):
    s = (s or "").strip().upper()
    for a, b in [("İ", "I"), ("Ç", "C"), ("Ş", "S"), ("Ğ", "G"), ("Ö", "O"), ("Ü", "U")]:
        s = s.replace(a, b)
    return s

# Her alan için birden fazla olası başlık ismi — broker dosyası hangi ismi kullanırsa kullansın eşleşsin.
COL_MAP_RAW = {
    "YAZILIM VERSIYONU": "sw_version",
    "ESP SW VER": "sw_version",
    "MSP430 FW VERSIYONU": "msp_fw",
    "MSP430 FW VER": "msp_fw",
    "MSP430 SW VER": "msp_sw",
    "DONANIM VERSIYONU": "hw_version",
    "ESP HW VER": "hw_version",
    "FIRMA": "company",
    "Logo": "logo",
    "ID": "device_code",
    "SERI NO": "serial_no",
    "MAC ADRESI": "mac",
    "KONUM": "location",
    "GSM/WiFi": "connection",
    "CONN TYPE": "connection",
    "ACIKLAMA": "note",
    "TARIH": "updated_at",
}
COL_MAP = {norm(k): v for k, v in COL_MAP_RAW.items()}

# ── Mavi (iptal edilmiş) satırları tespit etmek için hücre stillerinden arka plan rengini çıkar ──
# Not: ODS içindeki gömülü resim/logo verisi (base64) çok büyük satırlar üretebildiğinden,
# regex burada sadece <style:style ...>...</style:style> bloklarını hedefliyor, tüm dosyayı değil.
CANCELLED_COLORS = {"4D93D9", "5B9BD5"}

def get_blue_styles(ods_path):
    with zipfile.ZipFile(ods_path) as z:
        content = z.read("content.xml").decode("utf-8", errors="ignore")
    matches = re.findall(
        r'<style:style style:name="([^"]+)"[^>]*style:family="table-cell"[^>]*>\s*'
        r'<style:table-cell-properties[^>]*fo:background-color="(#[0-9A-Fa-f]{6})"',
        content
    )
    return {name for name, color in matches if color.upper().lstrip("#") in CANCELLED_COLORS}

blue_styles = get_blue_styles(path)

doc = load(path)
tables = doc.spreadsheet.getElementsByType(Table)
if not tables:
    print(json.dumps([]))
    sys.exit(0)

table = tables[0]
rows = table.getElementsByType(TableRow)
if not rows:
    print(json.dumps([]))
    sys.exit(0)

def get_row_cells(row):
    # Birleştirilmiş (merge) hücrelerde, birleşmenin "gölgede kalan" kısmı
    # <table:covered-table-cell> olarak ayrı bir eleman tipiyle geliyor —
    # bunu saymazsak sonraki tüm hücreler sola kayıp yanlış sütuna denk gelir.
    cells = []
    for child in row.childNodes:
        qname = getattr(child, "qname", None)
        if not qname:
            continue
        tag = qname[1]

        if tag == "table-cell":
            repeat = int(child.getAttribute("numbercolumnsrepeated") or 1)
            text = extractText(child).strip()
            style = child.getAttribute("stylename")
            for _ in range(repeat):
                cells.append((text, style))
        elif tag == "covered-table-cell":
            repeat = int(child.getAttribute("numbercolumnsrepeated") or 1)
            for _ in range(repeat):
                cells.append(("", None))  # boş yer tutucu — pozisyonu korur
    return cells

header_row = get_row_cells(rows[0])
header_map = {norm(text): idx for idx, (text, _style) in enumerate(header_row)}

devices = []
skipped_cancelled = 0

for row in rows[1:]:
    cells = get_row_cells(row)

    # İlk 12 kolonda mavi (iptal) stili varsa bu satırı tamamen atla
    is_cancelled = any(style in blue_styles for _text, style in cells[:12])
    if is_cancelled:
        skipped_cancelled += 1
        continue

    d = {}
    for header_norm, key in COL_MAP.items():
        idx = header_map.get(header_norm)
        val = cells[idx][0].strip() if idx is not None and idx < len(cells) else ""
        if val:
            d[key] = val          # gerçek bir değer bulundu — yaz
        elif key not in d:
            d[key] = None         # henüz hiç değer bulunamadıysa boş bırak
        # else: bu alana başka bir başlık alternatifinden ZATEN değer yazılmış —
        # bulunamayan bir alternatif başlık yüzünden onun üzerine None yazma

    if not d.get("mac"):
        continue

    devices.append(d)

# stderr'e bilgi amaçlı yaz (stdout sadece JSON içermeli, server.js onu parse ediyor)
print(f"[import_devices] {len(devices)} cihaz, {skipped_cancelled} iptal (mavi) satır atlandı", file=sys.stderr)
print(json.dumps(devices, ensure_ascii=False))