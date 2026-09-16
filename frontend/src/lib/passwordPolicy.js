// Backend'deki passwordPolicyError (backend/server.js) ile aynı kurallar —
// burada sadece kullanıcıya sunucuya gitmeden anında geri bildirim vermek için.
// Asıl zorunlu kontrol backend'de yapılıyor, bu sadece UX kolaylığı.
export function passwordPolicyError(pw) {
  if (!pw || pw.length < 6) return "Şifre en az 6 karakter olmalı";
  if (!/[a-z]/.test(pw)) return "Şifre en az bir küçük harf içermeli";
  if (!/[A-Z]/.test(pw)) return "Şifre en az bir büyük harf içermeli";
  if (!/[^a-zA-Z0-9]/.test(pw)) return "Şifre en az bir özel karakter içermeli";
  return null;
}

export const PASSWORD_HINT = "En az 6 karakter, 1 büyük, 1 küçük harf ve 1 özel karakter";
