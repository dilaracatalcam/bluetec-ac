import { describe, it, expect } from 'vitest';
import { initArchiveAutoPull, isEligibleVersion, parseProgress } from './archive-auto-pull.js';

// Köprü simülasyonu: target.json ve responses.json bellekte; cihaz davranışı `device` ile verilir
function makeBridge({ devices, device }) {
    const target = { requests: [] };
    const responses = {};
    const frames = [];
    const pulls = new Map();
    const deps = {
        TARGET_PATH: 't', SLOT_CLEAR_MSG_INTERVAL: 10, log: {},
        timing: { PROGRESS_POLL_MS: 20, POLL_MS: 20, ACTIVATE_WAIT_SEC: 3, IDLE_TIMEOUT_MS: 200, TOTAL_TIMEOUT_MS: 2000 },
        readTarget: async () => JSON.parse(JSON.stringify(target)),
        writeJsonRaw: async (_p, data) => {
            for (const r of data.requests) {
                const prev = target.requests.find((x) => x.session_id === r.session_id);
                if (r.send_message && r.send_message !== prev?.send_message) {
                    frames.push([r.session_id, r.send_message]);
                    device.onFrame?.(r.session_id, r.send_message, responses);
                }
            }
            target.requests = data.requests;
        },
        withLock: async (_k, fn) => fn(),
        deactivateThenActivateForSlot: async (sessionId, mac) => {
            target.requests = target.requests.filter((r) => r.session_id !== sessionId);
            target.requests.push({ session_id: sessionId, target: mac, control: 'activate', send_message: '' });
            responses[sessionId] = { status_response: { topic: `${mac}/status`, data: device.online ? 'ESP aktif' : '' }, message_response: null };
        },
        removeSlot: async (sessionId) => { target.requests = target.requests.filter((r) => r.session_id !== sessionId); },
        touchSlot: () => {},
        readResponses: async () => ({ responses }),
        getDevices: () => devices,
        getArchivePull: (mac) => pulls.get(mac) || null,
        recordArchivePull: ({ mac, result, source }) => {
            const prev = pulls.get(mac) || {};
            const at = new Date().toISOString();
            pulls.set(mac, { ...prev, last_attempt_at: at, last_result: result, ...(result === 'ok' ? { last_success_at: at, last_source: source } : {}) });
        },
        getDeviceLiveState: () => null,
        markVersionCheck: (mac) => { pulls.set(mac, { ...(pulls.get(mac) || {}), last_version_check_at: new Date().toISOString() }); },
        updateDeviceVersion: (mac, { sw_version }) => { const d = devices.find((x) => x.mac === mac); if (d) d.sw_version = sw_version; },
    };
    return { deps, target, responses, frames, pulls };
}

const msg = (cmd, m, data) => ({ cmd, msg: m, time: String(Math.random()), data });

describe('archive-auto-pull', () => {
    it('sürüm karşılaştırması', () => {
        expect(isEligibleVersion('v@4.1.7')).toBe(false);
        expect(isEligibleVersion('v@4.1.8')).toBe(true);
        expect(isEligibleVersion('V@4.2.4(reset )')).toBe(true);
        expect(isEligibleVersion('v@4.1.6')).toBe(false);
        expect(isEligibleVersion('v@3.9.9')).toBe(false);
        expect(isEligibleVersion('423')).toBe(false);
        expect(isEligibleVersion(null)).toBe(false);
    });

    it('ilerleme satırını çözer', () => {
        expect(parseProgress('sid=1 % 100.0 | indirme ve çözümleme tamamlandı | segment=1 kayıt=288')).toMatchObject({ done: true, percent: 100 });
        expect(parseProgress('sid=1 % 42,5 | indiriliyor | CRC-hata=0')).toMatchObject({ done: false, failed: false, percent: 42.5 });
        expect(parseProgress('Heartbeat')).toBeNull();
        expect(parseProgress('OCPP log başlangıcı zaman aşımına uğradı.')).toMatchObject({ failed: true });
        expect(parseProgress('sid=1 % 100.0 | tamamlandı | CRC-hata=0')).toMatchObject({ done: true, failed: false });
    });

    it('şarj yoksa 3 30 1 gönderir, tamamlanınca kaydeder ve bağlantıyı bırakır', async () => {
        const dev = { mac: 'AA:00:00:00:00:01', sw_version: 'v@4.2.4' };
        const device = {
            online: true,
            onFrame(sid, frame, responses) {
                if (frame === 'frame 2 25 0') responses[sid].message_response = msg(2, 25, 'P1_IDLE');
                if (frame === 'frame 3 30 1') {
                    setTimeout(() => { responses[sid].message_response = msg(3, 30, 'sid=9 % 40.0 | indiriliyor | segment=1'); }, 40);
                    setTimeout(() => { responses[sid].message_response = msg(3, 30, 'sid=9 % 100.0 | indirme ve çözümleme tamamlandı | segment=1'); }, 100);
                }
            },
        };
        const b = makeBridge({ devices: [dev, { mac: 'AA:00:00:00:00:02', sw_version: 'v@4.1.6' }], device });
        const pull = initArchiveAutoPull(b.deps);
        await pull.tick();
        expect(b.frames.filter(([s]) => s.endsWith('01')).map(([, f]) => f)).toEqual(['frame 2 25 0', 'frame 3 30 1']);
        expect(b.pulls.get(dev.mac)).toMatchObject({ last_result: 'ok', last_source: 'auto' });
        // sürümü düşük cihaz çekilmez, yalnızca sürümü okunur
        expect(b.frames.filter(([s]) => s.endsWith('02')).map(([, f]) => f)).toEqual(['frame 2 33 0']);
        expect(b.pulls.get('AA:00:00:00:00:02').last_result).toBeUndefined();
        expect(b.target.requests).toHaveLength(0);
        expect(pull.status(dev.mac)).toMatchObject({ autoEligible: true, synced: true });

        // 6 saat dolmadan tekrar çekilmez; sürüm de 24 saat dolmadan tekrar okunmaz
        await pull.tick();
        expect(b.frames.filter(([, f]) => f === 'frame 3 30 1')).toHaveLength(1);
        expect(b.frames.filter(([, f]) => f === 'frame 2 33 0')).toHaveLength(1);
        pull.stop();
    });

    it('sonradan 4.1.7 üzerine güncellenen cihazın sürümünü yazar ve aynı taramada çeker', async () => {
        const dev = { mac: 'AA:00:00:00:00:06', sw_version: 'v@4.1.6' };
        const device = {
            online: true,
            onFrame(sid, frame, responses) {
                if (frame === 'frame 2 33 0') responses[sid].message_response = msg(2, 33, 'v@4.1.8');
                if (frame === 'frame 2 25 0') responses[sid].message_response = msg(2, 25, 'P1_IDLE');
                if (frame === 'frame 3 30 1') setTimeout(() => { responses[sid].message_response = msg(3, 30, 'sid=2 % 100.0 | indirme ve çözümleme tamamlandı'); }, 40);
            },
        };
        const b = makeBridge({ devices: [dev], device });
        const pull = initArchiveAutoPull(b.deps);
        await pull.tick();
        expect(dev.sw_version).toBe('v@4.1.8');
        expect(b.frames.map(([, f]) => f)).toEqual(['frame 2 33 0', 'frame 2 25 0', 'frame 3 30 1']);
        expect(b.pulls.get(dev.mac)).toMatchObject({ last_result: 'ok', last_source: 'auto' });
        pull.stop();
    });

    it('şarj veriyorsa çekmez; başka oturumdaki cihaza dokunmaz', async () => {
        const dev = { mac: 'AA:00:00:00:00:03', sw_version: 'v@4.1.8' };
        const busy = { mac: 'AA:00:00:00:00:04', sw_version: 'v@4.2.0' };
        const device = {
            online: true,
            onFrame(sid, frame, responses) { if (frame === 'frame 2 25 0') responses[sid].message_response = msg(2, 25, 'P4_CHARGING'); },
        };
        const b = makeBridge({ devices: [dev, busy], device });
        b.target.requests.push({ session_id: 'ali', target: busy.mac, control: 'activate', send_message: '' });
        const pull = initArchiveAutoPull(b.deps);
        await pull.tick();
        expect(b.frames.some(([, f]) => f === 'frame 3 30 1')).toBe(false);
        expect(b.pulls.get(dev.mac).last_result).toBe('charging');
        expect(b.pulls.get(busy.mac).last_result).toBe('busy');
        expect(b.target.requests.map((r) => r.session_id)).toEqual(['ali']);
        pull.stop();
    });

    it('kullanıcının elle yaptığı çekimi kaydeder', async () => {
        const b = makeBridge({ devices: [], device: {} });
        b.target.requests.push({ session_id: 'ali', target: 'AA:00:00:00:00:05', control: 'activate', send_message: '' });
        const pull = initArchiveAutoPull(b.deps);
        const resp = (data) => ({ responses: { ali: { status_response: { topic: 'AA:00:00:00:00:05/status' }, message_response: msg(3, 30, data) } } });
        pull.observe(resp('sid=1 % 10.0 | indiriliyor'));
        pull.observe(resp('sid=1 % 100.0 | indirme ve çözümleme tamamlandı | kayıt=5'));
        await new Promise((r) => setTimeout(r, 20));
        expect(b.pulls.get('AA:00:00:00:00:05')).toMatchObject({ last_result: 'ok', last_source: 'manual' });
        pull.stop();
    });
});
