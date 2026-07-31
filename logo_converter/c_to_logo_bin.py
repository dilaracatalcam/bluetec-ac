import re

inputFile = "ui_img_5inclogo2_png.c"
outputFile = "logo.bin"

with open(inputFile, "r", encoding="utf-8", errors="ignore") as f:
    text = f.read()

match = re.search(r"ui_img_5inclogo2_png_data\[\]\s*=\s*\{(.*?)\};", text, re.S)

if not match:
    raise Exception("Logo array bulunamadi")

hexValues = re.findall(r"0x[0-9A-Fa-f]{1,2}", match.group(1))
data = bytes(int(x, 16) for x in hexValues)

with open(outputFile, "wb") as f:
    f.write(data)

print("logo.bin olustu")
print("Boyut:", len(data), "byte")
