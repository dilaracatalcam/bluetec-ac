const nodemailer = require('nodemailer');

/* ── E-posta gönderimi ──
   SMTP bilgileri .env üzerinden gelir (SMTP_HOST/PORT/USER/PASS/FROM).
   Sağlayıcı fark etmez (Brevo, Gmail, kurumsal SMTP...) — sadece .env
   değerleri değişir, kod aynı kalır. Yapılandırma eksikse gönderim
   denenmez, çağıran taraf hatayı loglayıp kullanıcıya jenerik bir
   yanıt döner (enumeration'a açık kapı bırakmamak için). */

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

let transporter = null;

function getTransporter() {
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;
    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port: SMTP_PORT,
            secure: SMTP_PORT === 465,
            auth: { user: SMTP_USER, pass: SMTP_PASS },
        });
    }
    return transporter;
}

async function sendPasswordResetEmail(to, resetLink, fullName) {
    const t = getTransporter();
    if (!t) {
        throw new Error('SMTP yapılandırılmamış (.env: SMTP_HOST/SMTP_USER/SMTP_PASS)');
    }

    const greeting = fullName ? `Merhaba ${fullName},` : 'Merhaba,';

    await t.sendMail({
        from: SMTP_FROM,
        to,
        subject: 'Bluetech Panel — Şifre Sıfırlama',
        text:
            `${greeting}\n\n` +
            `Şifrenizi sıfırlamak için aşağıdaki linke tıklayın (30 dakika geçerlidir):\n${resetLink}\n\n` +
            `Bu isteği siz yapmadıysanız bu e-postayı görmezden gelebilirsiniz, hesabınızda değişiklik yapılmaz.`,
        html:
            `<p>${greeting}</p>` +
            `<p>Şifrenizi sıfırlamak için aşağıdaki linke tıklayın (<strong>30 dakika</strong> geçerlidir):</p>` +
            `<p><a href="${resetLink}">${resetLink}</a></p>` +
            `<p style="color:#64748b;font-size:12px">Bu isteği siz yapmadıysanız bu e-postayı görmezden gelebilirsiniz, hesabınızda değişiklik yapılmaz.</p>`,
    });
}

module.exports = { sendPasswordResetEmail };
