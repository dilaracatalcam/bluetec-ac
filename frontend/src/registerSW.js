import { registerSW } from 'virtual:pwa-register'

// Yeni service worker devreye girdiğinde (deploy sonrası) sayfayı otomatik
// yeniler. Bunsuz tek F5 eski önbellekteki sürümü gösterebiliyordu çünkü
// SW güncellemesi, o F5'in cevabı döndükten SONRA arka planda tamamlanıyor.
if ('serviceWorker' in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    // Sekme açık kaldığı sürece yeni sürüm var mı diye periyodik kontrol et,
    // böylece kullanıcı F5'e bastığında güncelleme çoktan hazır olur.
    setInterval(() => {
      registration.update();
    }, 60 * 1000);
  },
});
