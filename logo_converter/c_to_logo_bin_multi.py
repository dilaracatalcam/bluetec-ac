import re
import os

logos = {
    "celikler": "celikler_logo.bin",
    "ctg": "ctg_logo.bin",
    "sepas": "sepas_logo.bin",
    "acrapol": "acrapol_logo.bin",
    "estasyon": "estasyon_logo.bin",
    "otopriz": "otopriz_logo.bin",
}

for baseName, outputFile in logos.items():
    inputFile = baseName + ".c"

    if not os.path.exists(inputFile):
        print(f"[SKIP] {inputFile} yok")
        continue

    with open(inputFile, "r", encoding="utf-8", errors="ignore") as f:
        text = f.read()

    match = re.search(
        r"const\s+.*?uint8_t\s+.*?_data\[\]\s*=\s*\{(.*?)\};",
        text,
        re.S
    )

    if not match:
        print(f"[FAIL] {inputFile} array bulunamadi")
        continue

    hexValues = re.findall(r"0x[0-9A-Fa-f]{1,2}", match.group(1))
    data = bytes(int(x, 16) for x in hexValues)

    with open(outputFile, "wb") as f:
        f.write(data)

    print(f"[OK] {inputFile} -> {outputFile} | {len(data)} byte")
