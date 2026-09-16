# E2E test sahte cihaz süreci — sadece process listesinde görünmek için var.
# Backend `pgrep -f "denek.py"` ile gerçek cihaz köprüsünün (denek.py) ayakta
# olup olmadığını kontrol ediyor; e2e testlerinde gerçek donanım/köprü
# olmadığından, isPythonRunning() kontrolünü geçmek için bu süreç ayakta
# tutulur. Cihaz durumu/yanıtları ise Playwright testi tarafından doğrudan
# target.json/responses.json dosyalarına yazılarak simüle edilir.
import time

while True:
    time.sleep(3600)
