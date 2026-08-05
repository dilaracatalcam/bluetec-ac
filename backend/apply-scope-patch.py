#!/usr/bin/env python3
"""
server.js'e cihaz yetkilendirme yamalarini uygular.

Guvenlik: her blok icin ESKI metnin dosyada TAM OLARAK BIR KEZ gectigi
dogrulanir. Bir blok bile eslesmezse HICBIR SEY yazilmaz, dosya oldugu
gibi kalir.

Kullanim:
    python3 apply-scope-patch.py /root/bluetech-panel/backend/server.js
"""

import sys
import os
import shutil
from datetime import datetime

import re

PATCHES = []      # (name, old, new)          — birebir metin
RE_PATCHES = []   # (name, pattern, repl_fn)  — bosluga duyarsiz regex


def patch(name, old, new):
    PATCHES.append((name, old, new))


def patch_re(name, pattern, repl):
    RE_PATCHES.append((name, re.compile(pattern), repl))


# ── 1. Import ──
patch(
    "1. import",
    "const otaLogTailer = require('./ota-log-tailer');",
    "const otaLogTailer = require('./ota-log-tailer');\n"
    "const { buildScope, allowsDevice, allowsMac, visibleDevices } = require('./device-scope');",
)

# ── 2. scopeFor yardimcisi ──
patch(
    "2. scopeFor yardimcisi",
    "// Token deposu\nconst activeSessions = {};",
    """// Istek sahibinin cihaz erisim kapsami
function scopeFor(req) {
    const users = readUsers();
    return buildScope(users.find((u) => u.username === req.username), req.userRole);
}

// Token deposu
const activeSessions = {};""",
)

# ── 3. update-target — GUVENLIK ACIGI ──
# Bu bolum sunucuda elle degistirilmis (deviceId destegi eklenmis) ve aralarda
# bosluk farklari var. Bu yuzden birebir metin yerine BOSLUGA DUYARSIZ regex
# kullaniliyor ve degisiklik iki kucuk parcaya bolunuyor.

patch_re(
    "3a. update-target operator yetki kontrolu",
    r"const users = readUsers\(\);\s*\n\s*const user = users\.find\(\(u\) => u\.username === req\.username\);\s*\n(\s*)if \(!user\?\.company \|\| device\.company !== user\.company\) \{",
    lambda m: "if (!allowsDevice(scopeFor(req), device)) {",
)

patch_re(
    "3b. update-target evrensel yetki kontrolu",
    r"\n([ \t]*)try \{\s*\n\s*await deactivateThenActivateForSlot\(sessionId, targetMac\);",
    lambda m: (
        "\n" + m.group(1) + "// Yetki kontrolu — HER yol icin (ham MAC girisi, deviceCode, deviceId)\n"
        + m.group(1) + "const connScope = scopeFor(req);\n"
        + m.group(1) + "if (!connScope.unrestricted && !allowsMac(connScope, targetMac)) {\n"
        + m.group(1) + "    console.warn(`[AUTH] ${req.username} yetkisiz cihaza baglanmayi denedi: ${targetMac}`);\n"
        + m.group(1) + "    return res.status(403).json({ error: 'Bu cihaza bağlanma yetkiniz yok' });\n"
        + m.group(1) + "}\n\n"
        + m.group(1) + "try {\n"
        + m.group(1) + "    await deactivateThenActivateForSlot(sessionId, targetMac);"
    ),
)

# ── 4. /api/devices/companies ──
patch(
    "4. /api/devices/companies",
    """    if (req.userRole === "operator") {
      const users = readUsers();
      const user = users.find((u) => u.username === req.username);
      return res.json({ companies: [user?.company].filter(Boolean) });
    }
    res.json({ companies: getCompanies() });""",
    """    const scope = scopeFor(req);
    if (scope.unrestricted) return res.json({ companies: getCompanies() });

    // Tek tek atanan cihazlar baska sirketlerden olabilir — onlarin
    // sirketleri de listede gorunmeli.
    const companies = [...new Set(visibleDevices(scope).map((d) => d.company).filter(Boolean))];
    res.json({ companies });""",
)

# ── 5. /api/devices/filters ──
patch(
    "5. /api/devices/filters",
    """    let company = req.query.company || null;
    if (req.userRole === "operator") {
      const users = readUsers();
      const user = users.find((u) => u.username === req.username);
      company = user?.company || null;
    }
    res.json({ locations: getLocations(company) });""",
    """    const scope = scopeFor(req);
    if (scope.unrestricted) {
      return res.json({ locations: getLocations(req.query.company || null) });
    }
    let list = visibleDevices(scope);
    if (req.query.company) list = list.filter((d) => d.company === req.query.company);
    res.json({ locations: [...new Set(list.map((d) => d.location).filter(Boolean))] });""",
)

# ── 6. /api/devices ──
patch(
    "6. /api/devices",
    """    let company = req.query.company || null;
    let userCompany = null;
    if (req.userRole === "operator") {
      const users = readUsers();
      const user = users.find((u) => u.username === req.username);
      userCompany = user?.company || null;
      company = userCompany;
    }
    const devices = getDevices({
      company,
      location: req.query.location || null,
      role: req.userRole,
      userCompany,
    });
    const sanitized = devices.map((d) => ({
      ...d,
      mac: req.userRole === "operator" ? undefined : d.mac,
    }));
    res.json({ devices: sanitized });""",
    """    const scope = scopeFor(req);
    let devices;

    if (scope.unrestricted) {
      devices = getDevices({
        company: req.query.company || null,
        location: req.query.location || null,
        role: req.userRole,
      });
    } else {
      devices = visibleDevices(scope);
      if (req.query.company) devices = devices.filter((d) => d.company === req.query.company);
      if (req.query.location) devices = devices.filter((d) => d.location === req.query.location);
    }

    // Operatorler MAC gormez — cihaz secimi id uzerinden yapilir.
    const sanitized = devices.map((d) => ({
      ...d,
      mac: req.userRole === "operator" ? undefined : d.mac,
    }));
    res.json({ devices: sanitized });""",
)

# ── 7. /api/devices/:code ──
patch(
    "7. /api/devices/:code",
    """    if (req.userRole === "operator") {
      const users = readUsers();
      const user = users.find((u) => u.username === req.username);
      if (device.company !== user?.company) {
        return res.status(403).json({ error: "Yetkisiz" });
      }
    }""",
    """    if (!allowsDevice(scopeFor(req), device)) {
      return res.status(403).json({ error: "Yetkisiz" });
    }""",
)

# ── 8. /api/send-command — ikinci savunma hatti ──
patch(
    "8. /api/send-command",
    """        const data = await readTarget();
        const slot = data.requests.find((r) => r.session_id === sessionId);
        if (!slot) {
            return res.status(400).json({ message: 'Önce bir cihaza bağlanmalısınız.' });
        }
        slot.send_message = frame;""",
    """        const data = await readTarget();
        const slot = data.requests.find((r) => r.session_id === sessionId);
        if (!slot) {
            return res.status(400).json({ message: 'Önce bir cihaza bağlanmalısınız.' });
        }
        const cmdScope = scopeFor(req);
        if (!cmdScope.unrestricted && !allowsMac(cmdScope, slot.target)) {
            console.warn(`[AUTH] ${req.username} yetkisiz cihaza komut denedi: ${slot.target}`);
            return res.status(403).json({ message: 'Bu cihaza komut gönderme yetkiniz yok' });
        }
        slot.send_message = frame;""",
)

# ── 9. /api/users GET ──
patch(
    "9. /api/users GET",
    """    res.json(users.map((u) => ({
        username: u.username,
        fullName: u.fullName,
        role: u.role,
        company: u.company || null,
        createdAt: u.createdAt,
    })));""",
    """    res.json(users.map((u) => ({
        username: u.username,
        fullName: u.fullName,
        role: u.role,
        company: u.company || null,
        allowedMacs: Array.isArray(u.allowedMacs) ? u.allowedMacs : [],
        createdAt: u.createdAt,
    })));""",
)

# ── 10a. /api/users POST — parametre ──
patch(
    "10a. /api/users POST parametre",
    "    const { username, fullName, password, role, company } = req.body || {};",
    "    const { username, fullName, password, role, company, allowedMacs } = req.body || {};",
)

# ── 10b. /api/users POST — kayit ──
patch(
    "10b. /api/users POST kayit",
    "        users.push({ username, fullName, passwordHash, role, company: company || null, createdAt: new Date().toISOString() });",
    """        const cleanMacs = Array.isArray(allowedMacs)
            ? [...new Set(allowedMacs.map((m) => String(m).trim().toUpperCase()).filter((m) => MAC_REGEX.test(m)))]
            : [];
        users.push({
            username, fullName, passwordHash, role,
            company: company || null,
            allowedMacs: cleanMacs,
            createdAt: new Date().toISOString(),
        });""",
)

# ── 11. YENI: /api/users/:username PUT ──
patch(
    "11. /api/users/:username PUT (yeni)",
    "app.delete('/api/users/:username', requireAuth(), requireSuperadmin, async (req, res) => {",
    """// ── Kullanicinin sirket / cihaz yetkisini duzenle ── //
app.put('/api/users/:username', requireAuth(), requireSuperadmin, (req, res) => {
    const { company, allowedMacs, role } = req.body || {};
    const users = readUsers();
    const user = users.find((u) => u.username === req.params.username);
    if (!user) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    if (user.role === 'superadmin') return res.status(403).json({ error: 'Superadmin yetkisi değiştirilemez' });

    if (role !== undefined) {
        if (role !== 'admin' && role !== 'operator') {
            return res.status(400).json({ error: 'Rol "admin" veya "operator" olmalı' });
        }
        user.role = role;
    }
    if (company !== undefined) user.company = company || null;
    if (allowedMacs !== undefined) {
        user.allowedMacs = Array.isArray(allowedMacs)
            ? [...new Set(allowedMacs.map((m) => String(m).trim().toUpperCase()).filter((m) => MAC_REGEX.test(m)))]
            : [];
    }

    writeUsers(users);
    console.log(`[USERS] ${req.username} yetki güncelledi: ${user.username} (şirket: ${user.company || '—'}, cihaz: ${(user.allowedMacs || []).length})`);
    res.json({ message: 'Yetkiler güncellendi' });
});

app.delete('/api/users/:username', requireAuth(), requireSuperadmin, async (req, res) => {""",
)


def main():
    if len(sys.argv) < 2:
        print("Kullanim: python3 apply-scope-patch.py /yol/server.js")
        return 1

    path = sys.argv[1]
    if not os.path.isfile(path):
        print(f"HATA: dosya yok: {path}")
        return 1

    with open(path, "r", encoding="utf-8") as f:
        src = f.read()

    # Zaten uygulanmis mi?
    if "scopeFor" in src:
        print("Bu dosyada 'scopeFor' zaten var — yama daha once uygulanmis gorunuyor.")
        print("Tekrar uygulamak icin once yedegi geri yukleyin.")
        return 1

    # 1. GECIS: hepsini dogrula, hicbir sey yazma
    print("Dogrulama:")
    failures = []
    checks = [(n, src.count(o)) for n, o, _ in PATCHES]
    checks += [(n, len(p.findall(src))) for n, p, _ in RE_PATCHES]
    for name, count in sorted(checks, key=lambda x: x[0]):
        mark = "OK " if count == 1 else "HATA"
        print(f"  [{mark}] {name}  (eslesme: {count})")
        if count != 1:
            failures.append((name, count))

    if failures:
        print()
        print("Hicbir degisiklik YAPILMADI. Eslesmeyen bloklar:")
        for name, count in failures:
            reason = "bulunamadi" if count == 0 else f"{count} kez geciyor (benzersiz degil)"
            print(f"  - {name}: {reason}")
        print()
        print("Muhtemel sebep: server.js bu blogun beklenen halinden farkli.")
        print("Ilgili bolumu gonderin, yamayi guncelleyeyim.")
        return 1

    # 2. GECIS: uygula
    out = src
    for _name, old, new in PATCHES:
        out = out.replace(old, new, 1)
    for _name, pattern, repl in RE_PATCHES:
        out = pattern.sub(repl, out, count=1)

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = f"{path}.bak-{stamp}"
    shutil.copy2(path, backup)

    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(out)
    os.replace(tmp, path)

    print()
    print(f"Tum bloklar uygulandi. Yedek: {backup}")
    print()
    print("Simdi:")
    print("  node --check " + path)
    print("  systemctl restart bluetech-panel-backend")
    return 0


if __name__ == "__main__":
    sys.exit(main())