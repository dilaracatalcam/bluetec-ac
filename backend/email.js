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

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function sendRegistrationPendingEmail(to, fullName, username) {
    const t = getTransporter();
    if (!t) {
        throw new Error('SMTP yapılandırılmamış (.env: SMTP_HOST/SMTP_USER/SMTP_PASS)');
    }

    const greeting = fullName ? `Merhaba ${fullName},` : 'Merhaba,';
    const safeGreeting = escapeHtml(greeting);
    const safeUsername = escapeHtml(username);

    await t.sendMail({
        from: SMTP_FROM,
        to,
        subject: 'Bluetech Panel — Kayıt alındı',
        text:
            `${greeting}\n\n` +
            `Bluetech Panel kaydınız alındı.\n` +
            `Kullanıcı adınız: ${username}\n\n` +
            `Hesabınız yönetici onayından sonra aktifleşecektir.`,
        html:
            `<p>${safeGreeting}</p>` +
            `<p>Bluetech Panel kaydınız alındı.</p>` +
            `<p>Kullanıcı adınız: <strong>${safeUsername}</strong></p>` +
            `<p>Hesabınız yönetici onayından sonra aktifleşecektir.</p>`,
    });
}

async function sendRegistrationVerificationEmail(to, fullName, username, verificationCode) {
    const t = getTransporter();
    if (!t) {
        throw new Error('SMTP yapılandırılmamış (.env: SMTP_HOST/SMTP_USER/SMTP_PASS)');
    }

    const greeting = fullName ? `Merhaba ${fullName},` : 'Merhaba,';
    const safeGreeting = escapeHtml(greeting);
    const safeUsername = escapeHtml(username);
    const safeCode = escapeHtml(verificationCode);

    await t.sendMail({
        from: SMTP_FROM,
        to,
        subject: 'Bluetech Panel — E-posta doğrulama kodunuz',
        text:
            `${greeting}\n\n` +
            `Bluetech Panel hesabınızı doğrulamak için kodunuz: ${verificationCode}\n\n` +
            `Kullanıcı adınız: ${username}\n` +
            `Bu kod 10 dakika geçerlidir.`,
        html:
            `<p>${safeGreeting}</p>` +
            `<p>Bluetech Panel hesabınızı doğrulamak için aşağıdaki kodu girin:</p>` +
            `<p style="font-size:28px;letter-spacing:6px;font-weight:700"><strong>${safeCode}</strong></p>` +
            `<p>Kullanıcı adınız: <strong>${safeUsername}</strong></p>` +
            `<p style="color:#64748b;font-size:12px">Bu kod 10 dakika geçerlidir.</p>`,
    });
}

async function sendRegistrationApprovedEmail(to, fullName, username) {
    const t = getTransporter();
    if (!t) {
        throw new Error('SMTP yapılandırılmamış (.env: SMTP_HOST/SMTP_USER/SMTP_PASS)');
    }

    const greeting = fullName ? `Merhaba ${fullName},` : 'Merhaba,';
    const safeGreeting = escapeHtml(greeting);
    const safeUsername = escapeHtml(username);

    await t.sendMail({
        from: SMTP_FROM,
        to,
        subject: 'Bluetech Panel — Hesabınız onaylandı',
        text:
            `${greeting}\n\n` +
            `Bluetech Panel hesabınız yönetici tarafından onaylandı.\n` +
            `Kullanıcı adınız: ${username}\n\n` +
            `Artık panel giriş ekranından hesabınıza giriş yapabilirsiniz.`,
        html:
            `<p>${safeGreeting}</p>` +
            `<p>Bluetech Panel hesabınız yönetici tarafından onaylandı.</p>` +
            `<p>Kullanıcı adınız: <strong>${safeUsername}</strong></p>` +
            `<p>Artık panel giriş ekranından hesabınıza giriş yapabilirsiniz.</p>`,
    });
}

module.exports = {
    sendPasswordResetEmail,
    sendRegistrationPendingEmail,
    sendRegistrationVerificationEmail,
    sendRegistrationApprovedEmail,
};
