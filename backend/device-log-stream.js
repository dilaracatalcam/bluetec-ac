/* ═══════════════════════════════════════════════════════════════
   Cihaz Canlı Log Akışı (frame 3 28 N / frame 3 29 N)

   Log satırları da diğer cevaplar gibi responses.json'daki
   message_response.data alanına düşüyor — ama o alan her yeni mesajda
   ÜZERİNE yazıldığı için tek başına "akış" değil, sadece son satır.
   Bu modül responses.json'u sık aralıklarla izler, izlenen oturumun
   message_response'u her değiştiğinde satırı RAM'deki halka tampona
   ekler; frontend "after=<id>" ile sadece yeni satırları çeker.

   Not: İki dosya yazımı arasında birden fazla satır gelirse aradakiler
   responses.json'a hiç yansımadığı için burada da görülemez.
   ═══════════════════════════════════════════════════════════════ */

const fs = require("fs");

const WATCH_INTERVAL_MS = 100;
const MAX_LINES_PER_SESSION = 5000;
// Son istekten sonra bu kadar süre daha satır biriktirmeye devam et —
// kullanıcı başka bölüme geçip dönünce aradaki loglar kaybolmasın.
const IDLE_TTL_MS = 10 * 60 * 1000;

// 28/29 canlı RAM akışı; 30 cihazdaki kalıcı OCL1 arşivinin sunucuya
// aktarımını başlatır. 30, canlı satır gibi kapatılmaz; cihazın ACK'li
// aktarım protokolü kendi tamamlanma durumunu yönetir.
const LOG_GROUPS = [28, 29, 30];
const LIVE_LOG_GROUPS = [28, 29];
const MAX_LEVEL = 5;

function firstMessage(resp) {
    const m = resp?.message_response;
    if (Array.isArray(m)) return m[0] || null;
    return m && typeof m === "object" ? m : null;
}

function signatureOf(m) {
    return m ? `${m.cmd}|${m.msg}|${m.time}|${m.data}` : "";
}

// frame 1 (set) / frame 2 (read) cevapları parametre cevabıdır, log değil.
function isLogMessage(m) {
    const cmd = Number(m.cmd);
    return cmd !== 1 && cmd !== 2;
}

function initDeviceLogStream({ RESPONSES_PATH, readResponses, onLine }) {
    const epoch = Date.now(); // process yeniden başlarsa id'ler sıfırlanır — client bunu epoch'tan anlar
    const sessions = new Map(); // sessionId -> { lines, nextId, lastSig, lastSeen }
    // Cihazda açık bırakılan log modları — satır tamponundan AYRI tutulur ve boşta
    // kalınca silinmez: kullanıcı Loglar sayfasından çıkıp dakikalar sonra bağlantıyı
    // kesse bile cihaza "logu kapat" gönderebilmek için hangi modun açık olduğu bilinmeli.
    const modesBySession = new Map(); // sessionId -> { 28: seviye, 29: seviye }
    const modesOf = (sessionId) => modesBySession.get(sessionId) || { 28: 0, 29: 0 };
    let lastFileSig = "";
    let scanning = false;

    function getSession(sessionId) {
        let s = sessions.get(sessionId);
        if (!s) {
            // lastSig null: ilk taramada o an dosyada duran (eski) mesaj satır sayılmaz
            s = { lines: [], nextId: 1, lastSig: null, lastSeen: Date.now() };
            sessions.set(sessionId, s);
        }
        s.lastSeen = Date.now();
        return s;
    }

    function pushLine(sessionId, s, m) {
        const parts = String(m.data ?? "").split(/\r?\n/).filter((p) => p.length > 0);
        for (const data of parts) {
            s.lines.push({ id: s.nextId++, at: Date.now(), time: m.time || "", cmd: Number(m.cmd), msg: Number(m.msg), data });
            try { onLine?.(sessionId, Number(m.msg), data); } catch {}
        }
        if (s.lines.length > MAX_LINES_PER_SESSION) s.lines.splice(0, s.lines.length - MAX_LINES_PER_SESSION);
    }

    function ingest(responses) {
        for (const [sessionId, s] of sessions) {
            const m = firstMessage(responses[sessionId]);
            const sig = signatureOf(m);
            if (s.lastSig === null) { s.lastSig = sig; continue; }
            if (sig === s.lastSig) continue;
            s.lastSig = sig;
            if (m && isLogMessage(m)) pushLine(sessionId, s, m);
        }
    }

    async function scan() {
        if (scanning) return;
        const now = Date.now();
        for (const [sessionId, s] of sessions) {
            if (now - s.lastSeen > IDLE_TTL_MS) sessions.delete(sessionId);
        }
        if (sessions.size === 0) { lastFileSig = ""; return; }

        scanning = true;
        try {
            const st = await fs.promises.stat(RESPONSES_PATH);
            const fileSig = `${st.mtimeMs}|${st.size}`;
            if (fileSig === lastFileSig) return;
            lastFileSig = fileSig;
            const data = await readResponses();
            ingest(data.responses);
        } catch {
            // dosya o an yeniden yazılıyor olabilir — bir sonraki turda tekrar denenir
        } finally {
            scanning = false;
        }
    }

    const timer = setInterval(scan, WATCH_INTERVAL_MS);
    timer.unref?.();

    return {
        LOG_GROUPS,
        MAX_LEVEL,
        // Komut gönderilmeden HEMEN ÖNCE çağrılır ki ilk satırlar kaçmasın.
        // Tarama burada beklenir: o an dosyada duran eski mesaj "taban" olarak
        // kaydedilir, komutun cevabı ondan farklı olunca satır sayılır.
        async watch(sessionId) {
            const s = getSession(sessionId);
            if (s.lastSig === null) { lastFileSig = ""; await scan(); }
        },
        setMode(sessionId, group, level) {
            modesBySession.set(sessionId, { ...modesOf(sessionId), [group]: level });
        },
        // Cihazda hâlâ açık olan log grupları (28/29)
        modes(sessionId) { return modesOf(sessionId); },
        activeGroups(sessionId) {
            const m = modesOf(sessionId);
            return LIVE_LOG_GROUPS.filter((g) => m[g] !== 0);
        },
        clearModes(sessionId) {
            modesBySession.delete(sessionId);
        },
        read(sessionId, afterId) {
            const s = getSession(sessionId);
            const after = Number(afterId) || 0;
            const lines = s.lines.filter((l) => l.id > after);
            return { epoch, lines, lastId: s.nextId - 1, modes: modesOf(sessionId) };
        },
        clear(sessionId) {
            const s = getSession(sessionId);
            s.lines = [];
        },
        drop(sessionId) {
            sessions.delete(sessionId);
        },
        _ingest: ingest, // test için
        stop() { clearInterval(timer); },
    };
}

module.exports = { initDeviceLogStream, isLogMessage };
