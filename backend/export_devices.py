import sys, json
from odf.opendocument import OpenDocumentSpreadsheet
from odf.table import Table, TableRow, TableCell, TableColumn, DatabaseRanges, DatabaseRange
from odf.text import P
from odf.style import Style, TableColumnProperties, TableCellProperties, TextProperties
import io

devices = json.loads(sys.stdin.read())
doc = OpenDocumentSpreadsheet()

# (başlık, cihaz alanı) — sıra broker dosyası düzenine göre ayarlandı.
# Genişlikler sabit değil, aşağıda her sütundaki en uzun metne göre hesaplanıyor
# (bkz. col_width) — böylece Excel'de cümleler yarıda kesilmeden görünür.
COLUMNS = [
    ("ESP SW VER", "sw_version"),
    ("ESP HW VER", "hw_version"),
    ("MSP430 FW VER", "msp_fw"),
    ("MSP430 SW VER", "msp_sw"),
    ("FIRMA", "company"),
    ("Logo", "logo"),
    # Broker/Excel şablonundaki "ID" alanı paneldeki OCPP ID'ye karşılık gelir.
    ("ID", "device_code"),
    ("SERI NO", "serial_no"),
    ("MAC ADRESI", "mac"),
    ("KONUM", "location"),
    ("SEHIR", "city"),
    ("ILCE", "district"),
    ("ENLEM", "latitude"),
    ("BOYLAM", "longitude"),
    ("CONN TYPE", "connection"),
    ("ACIKLAMA", "note"),
    ("TARIH", "updated_at"),
]

def col_width(header, key):
    max_len = len(header)
    for d in devices:
        val = d.get(key)
        val = str(val) if val is not None else ""
        if len(val) > max_len:
            max_len = len(val)
    # karakter başı ~0.19cm (varsayılan yazı tipi genişliğine yakın) + kenar boşluğu
    width_cm = max_len * 0.19 + 0.5
    return f"{max(1.8, width_cm):.2f}cm"

header_cell_style = Style(name="HeaderCell", family="table-cell")
header_cell_style.addElement(TableCellProperties(backgroundcolor="#D9E1F2"))
doc.automaticstyles.addElement(header_cell_style)

header_text_style = Style(name="HeaderText", family="paragraph")
header_text_style.addElement(TextProperties(fontweight="bold"))
doc.automaticstyles.addElement(header_text_style)

def make_cell(val, cell_stylename=None, text_stylename=None):
    text = str(val) if val is not None else ""
    kwargs = {"valuetype": "string", "stringvalue": text}
    if cell_stylename:
        kwargs["stylename"] = cell_stylename
    tc = TableCell(**kwargs)
    tc.addElement(P(text=text, stylename=text_stylename) if text_stylename else P(text=text))
    return tc

table = Table(name="Cihazlar")

for i, (header, key) in enumerate(COLUMNS):
    col_style = Style(name=f"Col{i}", family="table-column")
    col_style.addElement(TableColumnProperties(columnwidth=col_width(header, key)))
    doc.automaticstyles.addElement(col_style)
    table.addElement(TableColumn(stylename=col_style))

hr = TableRow()
for header, _key in COLUMNS:
    hr.addElement(make_cell(header, cell_stylename="HeaderCell", text_stylename="HeaderText"))
table.addElement(hr)

for d in devices:
    tr = TableRow()
    for _header, key in COLUMNS:
        tr.addElement(make_cell(d.get(key) or ""))
    table.addElement(tr)

doc.spreadsheet.addElement(table)

# Başlık satırına Excel'deki gibi filtre okları ekle
last_col_letter = chr(ord("A") + len(COLUMNS) - 1)
last_row = len(devices) + 1
db_ranges = DatabaseRanges()
db_ranges.addElement(DatabaseRange(
    name="__Anonymous_Sheet_DB__0",
    targetrangeaddress=f"'Cihazlar'.A1:{last_col_letter}{last_row}",
    displayfilterbuttons="true",
))
doc.spreadsheet.addElement(db_ranges)

buf = io.BytesIO()
doc.save(buf)
buf.seek(0)
sys.stdout.buffer.write(buf.read())
