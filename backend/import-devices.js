const path = require("path");
const { execSync } = require("child_process");
const { replaceAllDevices } = require("./db");

const filePath = process.argv[2] || path.join(__dirname, "ac_cihazlar.ods");
console.log("Okunuyor: " + filePath);

const py = `
import sys, json, io, re, math
import pandas as pd
from odf.opendocument import load
from odf.table import Table, TableRow, TableCell
from odf.style import Style

file_path = "${filePath.replace(/\\/g, '\\\\')}"

doc = load(file_path)

def elem_to_str(elem):
    f = io.StringIO()
    elem.toXml(0, f)
    return f.getvalue()

blue_styles = set()
for style in doc.automaticstyles.getElementsByType(Style):
    name = style.getAttribute('name')
    s = elem_to_str(style)
    bg = re.search(r'fo:background-color="#([0-9a-fA-F]{6})"', s)
    if bg and bg.group(1).upper() in ('4D93D9', '5B9BD5'):
        blue_styles.add(name)

sheet = doc.spreadsheet.getElementsByType(Table)[0]
rows = sheet.getElementsByType(TableRow)
blue_indices = set()
for i, row in enumerate(rows[1:], start=0):
    for cell in row.getElementsByType(TableCell):
        if (cell.getAttribute('stylename') or '') in blue_styles:
            blue_indices.add(i)
            break

df = pd.read_excel(file_path, engine='odf')
df['_blue'] = df.index.isin(blue_indices)
active = df[~df['_blue']].copy()

def safe(v):
    if v is None: return None
    try:
        if math.isnan(float(v)): return None
    except: pass
    s = str(v).strip()
    return s if s and s != 'nan' else None

def norm_location(v):
    loc = safe(v)
    if not loc: return None
    if loc == loc.lower():
        return ' '.join(w.capitalize() for w in loc.split())
    return loc

out = []
for _, r in active.iterrows():
    loc = norm_location(r.get('KONUM'))
    out.append({
        'device_code': safe(r.get('ID')),
        'serial_no':   safe(r.get('SERİ NO')),
        'mac':         safe(r.get('MAC ADRESİ')),
        'company':     safe(r.get('FİRMA')),
        'location':    loc,
        'connection':  safe(r.get('GSM/WiFi')),
        'logo':        safe(r.get('Logo')),
        'sw_version':  safe(r.get('YAZILIM VERSİYONU')),
        'msp_fw':      safe(r.get('MSP430 FW VERSİYONU')),
        'hw_version':  safe(r.get('DONANIM VERSİYONU')),
        'note':        safe(r.get('AÇIKLAMA')),
        'updated_at':  safe(r.get('TARİH')),
        'is_revision': 1 if loc and 'revizyon' in loc.lower() else 0,
    })

print(json.dumps({'rows': out, 'total': len(df), 'skipped': int(df['_blue'].sum())}))
`;

let parsed;
try {
  const result = execSync(`python3 -c '${py.replace(/'/g, "'\\''")}'`, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  parsed = JSON.parse(result.trim());
} catch (e) {
  console.error("Python parse hatasi:", e.message);
  process.exit(1);
}

const { rows, total, skipped } = parsed;
console.log(total + " satir okundu -> " + skipped + " mavi (iptal) atlandi -> " + rows.length + " aktif cihaz");

const noMac  = rows.filter((r) => !r.mac);
const noCode = rows.filter((r) => !r.device_code);
const macMap = {};
rows.forEach((r) => { if (r.mac) macMap[r.mac] = (macMap[r.mac] || 0) + 1; });
const dups = Object.entries(macMap).filter(([, c]) => c > 1);

if (noMac.length)  console.warn("UYARI: MAC adresi bos: " + noMac.length + " satir");
if (noCode.length) console.warn("UYARI: ID bos: " + noCode.length + " satir (" + noCode.map((r) => r.serial_no).join(", ") + ")");
if (dups.length)   console.warn("UYARI: Duplicate MAC: " + dups.map(([m, c]) => m + " (" + c + "x)").join(", "));

const count = replaceAllDevices(rows);
console.log(count + " cihaz ice aktarildi -> bluetech.db");
