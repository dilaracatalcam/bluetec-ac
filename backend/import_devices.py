import sys, json, re, zipfile
try:
    from odf.opendocument import load
    from odf.table import Table, TableRow, TableCell, CoveredTableCell
    from odf.teletype import extractText
    ODFPY_AVAILABLE = True
except ModuleNotFoundError:
    # Sunucuda odfpy kurulu değilse de .ods dosyası ZIP/XML formatında olduğu
    # için aşağıdaki küçük yerleşik okuyucu kullanılabilir.
    ODFPY_AVAILABLE = False

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
    "OCPP ID": "device_code",
    "SERI NO": "serial_no",
    "MAC ADRESI": "mac",
    "KONUM": "location",
    "SEHIR": "city",
    "IL": "city",
    "ILCE": "district",
    "ENLEM": "latitude",
    "LATITUDE": "latitude",
    "LAT": "latitude",
    "BOYLAM": "longitude",
    "LONGITUDE": "longitude",
    "LON": "longitude",
    "LNG": "longitude",
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

def parse_ods_without_odfpy(ods_path):
    """odfpy olmayan ortamlarda ilk çalışma sayfasını okur."""
    import xml.etree.ElementTree as ET
    def parse_coord(value):
        value = (value or "").strip()
        if not value:
            return None
        try:
            return float(value.replace(',', '.'))
        except ValueError:
            return None
    ns = {
        "table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
        "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
    }
    table_ns = "{%s}" % ns["table"]
    text_ns = "{%s}" % ns["text"]
    repeat_attr = table_ns + "number-columns-repeated"
    style_attr = table_ns + "style-name"

    with zipfile.ZipFile(ods_path) as archive:
        root = ET.fromstring(archive.read("content.xml"))

    tables = root.findall(".//table:table", ns)
    if not tables:
        return []

    def cell_text(cell):
        return " ".join((node.text or "") for node in cell.findall(".//text:p", ns)).strip()

    rows = []
    for row in tables[0].findall("table:table-row", ns):
        cells = []
        for child in list(row):
            local = child.tag.rsplit("}", 1)[-1]
            repeat = int(child.attrib.get(repeat_attr, "1") or "1")
            if local == "table-cell":
                value = cell_text(child)
                style = child.attrib.get(style_attr)
                cells.extend([(value, style)] * repeat)
            elif local == "covered-table-cell":
                cells.extend([("", None)] * repeat)
        while cells and not cells[-1][0]:
            cells.pop()
        if cells:
            rows.append(cells)

    if not rows:
        return []

    header_map = {norm(value): index for index, (value, _style) in enumerate(rows[0])}
    devices = []
    skipped_cancelled = 0
    for cells in rows[1:]:
        if any(style in blue_styles for _value, style in cells[:12]):
            skipped_cancelled += 1
            continue
        device = {}
        for header_norm, key in COL_MAP.items():
            index = header_map.get(header_norm)
            value = cells[index][0].strip() if index is not None and index < len(cells) else ""
            if value:
                device[key] = value
            elif key not in device:
                device[key] = None
        device["latitude"] = parse_coord(str(device.get("latitude") or ""))
        device["longitude"] = parse_coord(str(device.get("longitude") or ""))
        if device.get("mac"):
            devices.append(device)

    print(f"[import_devices] {len(devices)} cihaz, {skipped_cancelled} iptal (mavi) satır atlandı", file=sys.stderr)
    return devices

if not ODFPY_AVAILABLE:
    print(json.dumps(parse_ods_without_odfpy(path), ensure_ascii=False))
    sys.exit(0)

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

def coord(v):
    value = (v or "").strip()
    if not value: return None
    try:
        return float(value.replace(',', '.'))
    except ValueError:
        return None

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

    d["latitude"] = coord(str(d.get("latitude") or ""))
    d["longitude"] = coord(str(d.get("longitude") or ""))

    if not d.get("mac"):
        continue

    devices.append(d)

# stderr'e bilgi amaçlı yaz (stdout sadece JSON içermeli, server.js onu parse ediyor)
print(f"[import_devices] {len(devices)} cihaz, {skipped_cancelled} iptal (mavi) satır atlandı", file=sys.stderr)
print(json.dumps(devices, ensure_ascii=False))
