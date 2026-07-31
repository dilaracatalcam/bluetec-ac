import sys, json
from odf.opendocument import OpenDocumentSpreadsheet
from odf.table import Table, TableRow, TableCell
from odf.text import P
import io

devices = json.loads(sys.stdin.read())
doc = OpenDocumentSpreadsheet()
table = Table(name="Cihazlar")
headers = ["YAZILIM VERSIYONU","MSP430 FW VERSIYONU","MSP430 SW VER","DONANIM VERSIYONU","FIRMA","Logo","ID","SERI NO","MAC ADRESI","KONUM","GSM/WiFi","ACIKLAMA","TARIH"]

def make_cell(val):
    tc = TableCell()
    tc.addElement(P(text=str(val) if val is not None else ""))
    return tc

hr = TableRow()
for h in headers: hr.addElement(make_cell(h))
table.addElement(hr)

for d in devices:
    tr = TableRow()
    for v in [d.get("sw_version"),d.get("msp_fw"),d.get("msp_sw"),d.get("hw_version"),d.get("company"),d.get("logo"),d.get("device_code"),d.get("serial_no"),d.get("mac"),d.get("location"),d.get("connection"),d.get("note"),d.get("updated_at")]:
        tr.addElement(make_cell(v or ""))
    table.addElement(tr)

doc.spreadsheet.addElement(table)
buf = io.BytesIO()
doc.save(buf)
buf.seek(0)
sys.stdout.buffer.write(buf.read())