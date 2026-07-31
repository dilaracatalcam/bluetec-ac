#!/usr/bin/env node
/*
 * create-superadmin.js
 *
 * İlk superadmin kullanıcısını users.json'a ekler.
 * Şifre bcrypt ile hashlenir.
 *
 * Kullanım:
 *   node create-superadmin.js
 *
 * Sorulan bilgiler:
 *   - Kullanıcı adı (login için, ör. "merve")
 *   - Ad Soyad (gösterim için, ör. "Merve Öztürk")
 *   - Şifre (terminal göstermez)
 *   - Şifre tekrar
 *
 * Sadece bir kere çalıştırılır. users.json'da zaten bir superadmin
 * varsa hata verir. Diğer kullanıcılar UI'dan eklenir.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const bcrypt = require('bcrypt');

// users.json yolu — server.js ile aynı yere bakar
const USERS_PATH = process.env.USERS_PATH || path.join(__dirname, 'users.json');

const BCRYPT_ROUNDS = 10;

// Gizli şifre okuma — terminal karakterleri göstermez
function questionHidden(query) {
  return new Promise((resolve) => {
    process.stdout.write(query);

    const stdin = process.stdin;
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let password = '';
    const onData = (char) => {
      // Enter
      if (char === '\n' || char === '\r' || char === '\u0004') {
        stdin.setRawMode?.(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(password);
        return;
      }
      // Ctrl+C
      if (char === '\u0003') {
        process.stdout.write('\n^C\n');
        process.exit(1);
      }
      // Backspace
      if (char === '\u0008' || char === '\u007f') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }
      password += char;
      process.stdout.write('*');
    };
    stdin.on('data', onData);
  });
}

function questionVisible(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(query, (ans) => { rl.close(); resolve(ans); }));
}

async function main() {
  console.log('\n════════════════════════════════════════');
  console.log('  Bluetech — İlk Superadmin Yarat');
  console.log('════════════════════════════════════════');
  console.log('  users.json yolu:', USERS_PATH);
  console.log('════════════════════════════════════════\n');

  // Mevcut users.json oku
  let users = [];
  if (fs.existsSync(USERS_PATH)) {
    try {
      const raw = fs.readFileSync(USERS_PATH, 'utf-8');
      users = JSON.parse(raw);
      if (!Array.isArray(users)) users = [];
    } catch (e) {
      console.error('Hata: users.json okunamadı:', e.message);
      process.exit(1);
    }
  }

  // Zaten superadmin var mı?
  const existingSuperadmin = users.find((u) => u.role === 'superadmin');
  if (existingSuperadmin) {
    console.log(`Hata: Zaten bir superadmin var: "${existingSuperadmin.username}"`);
    console.log('Bu script sadece ilk kurulum içindir.');
    console.log('Yeni kullanıcılar admin panelinden eklenmelidir.');
    process.exit(1);
  }

  // Kullanıcı adı
  const username = (await questionVisible('Kullanıcı adı (login için): ')).trim();
  if (!username) {
    console.log('Hata: Kullanıcı adı boş olamaz.');
    process.exit(1);
  }
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username)) {
    console.log('Hata: Kullanıcı adı 3-32 karakter olmalı, sadece harf/rakam/_/- kullanılabilir.');
    process.exit(1);
  }
  if (users.find((u) => u.username === username)) {
    console.log(`Hata: "${username}" zaten mevcut.`);
    process.exit(1);
  }

  // Ad Soyad
  const fullName = (await questionVisible('Ad Soyad (gösterim için): ')).trim();
  if (!fullName) {
    console.log('Hata: Ad Soyad boş olamaz.');
    process.exit(1);
  }

  // Şifre
  const password = await questionHidden('Şifre: ');
  if (password.length < 6) {
    console.log('Hata: Şifre en az 6 karakter olmalı.');
    process.exit(1);
  }
  const passwordAgain = await questionHidden('Şifre (tekrar): ');
  if (password !== passwordAgain) {
    console.log('Hata: Şifreler uyuşmuyor.');
    process.exit(1);
  }

  // Hash
  console.log('\nŞifre hashleniyor…');
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Yeni user objesi
  const newUser = {
    username,
    fullName,
    passwordHash,
    role: 'superadmin',
    createdAt: new Date().toISOString(),
  };

  users.push(newUser);

  // Yaz
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2), 'utf-8');

  console.log('\n════════════════════════════════════════');
  console.log('  Superadmin oluşturuldu ✓');
  console.log('════════════════════════════════════════');
  console.log(`  Kullanıcı adı: ${username}`);
  console.log(`  Ad Soyad: ${fullName}`);
  console.log(`  Rol: superadmin`);
  console.log('════════════════════════════════════════');
  console.log('  Şimdi web panelinde bu hesapla giriş yapabilirsin.');
  console.log('  Sonra "Kullanıcı Yönetimi" sayfasından diğer hesapları ekleyebilirsin.\n');
}

main().catch((e) => {
  console.error('Beklenmeyen hata:', e);
  process.exit(1);
});