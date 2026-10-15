import { describe, it, expect } from 'vitest';
import { initOcppWatch } from './ocpp-watch.js';
import { initOcppLiveStore } from './ocpp-live-store.js';

// Köprü simülasyonu: target.json (slotlar) ve responses.json bellekte
function makeBridge(devices) {
    const target = { requests: [] };
    const responses = {};
    const frames = []; // [sessionId, frame]
    const state = { online: true, activations: 0 };
    const deps = {
        TARGET_PATH: 't', SLOT_CLEAR_MSG_INTERVAL: 10,
        readTarget: async () => JSON.parse(JSON.stringify(target)),
        writeJsonRaw: async (_p, data) => {
            for (const r of data.requests) {
                const prev = target.requests.find((x) => x.session_id === r.session_id);
                if (r.send_message && r.send_message !== prev?.send_message) frames.push([r.session_id, r.send_message]);
            }
            target.requests = data.requests;
        },
        withLock: async (_k, fn) => fn(),
        findOrCreateSlot: () => {},
        deactivateThenActivateForSlot: async (sessionId, mac) => {
            target.requests = target.requests.filter((r) => r.session_id !== sessionId);
            target.requests.push({ session_id: sessionId, target: mac, control: 'activate', send_message: '' });
            state.activations++;
            responses[sessionId] = { status_response: { topic: mac, data: state.online ? 'ESP aktif' : '' }, message_response: { cmd: 2, msg: 25, time: 't0', data: 'P1_IDLE' } };
        },
        removeSlot: async (sessionId) => { target.requests = target.requests.filter((r) => r.session_id !== sessionId); },
        touchSlot: () => {},
        readResponses: async () => ({ responses }),
        getDevices: () => devices,
    };
    return { deps, target, responses, frames, state };
}

describe('ocpp-watch', () => {
    it('her cihaza bir kez 3 28 3 gönderir, satırları toplar, çıkışta 3 28 0 gönderip temizler', async () => {
        const devices = [
            { mac: 'AA:00:00:00:00:01', company: 'X', location: 'A' },
            { mac: 'AA:00:00:00:00:02', company: 'X', location: 'B' },
        ];
        const bridge = makeBridge(devices);
        const live = initOcppLiveStore();
        const statuses = [];
        const watch = initOcppWatch({ ...bridge.deps, timing: { LEAVE_GRACE_MS: 0 }, ocppLive: live, onStatus: (d, a, raw) => statuses.push([d.mac, a, raw]) });

        watch.ensure('X', 'kullanici1');
        // bağlanma + durum okuma + 3 28 3
        for (let i = 0; i < 60 && watch.state('X').watching !== 2; i++) await new Promise((r) => setTimeout(r, 100));
        expect(watch.state('X').watching).toBe(2);
        expect(bridge.frames.filter(([, f]) => f === 'frame 3 28 3')).toHaveLength(2);
        expect(statuses.map((s) => s[2])).toEqual(['P1_IDLE', 'P1_IDLE']);

        // cihazdan OCPP satırı gelir
        const sid = bridge.target.requests[0].session_id;
        bridge.responses[sid].message_response = { cmd: 3, msg: 28, time: 't1', data: '[2, "u1", "Heartbeat", {}]' };
        await new Promise((r) => setTimeout(r, 500));
        expect(live.feed(0).lines.map((l) => l.type)).toEqual(['Heartbeat']);

        // 3 28 3 tekrar gönderilmez
        watch.ensure('X', 'kullanici1');
        await new Promise((r) => setTimeout(r, 300));
        expect(bridge.frames.filter(([, f]) => f === 'frame 3 28 3')).toHaveLength(2);

        await watch.leave('X', 'kullanici1');
        expect(bridge.frames.filter(([, f]) => f === 'frame 3 28 0')).toHaveLength(2);
        expect(bridge.target.requests).toHaveLength(0);
        expect(live.events(devices[0].mac)).toHaveLength(0);
        expect(watch.state('X')).toBeNull();
        watch._stopTimer();
    }, 20000);

    it('kullanıcı devralınca önce 3 28 0 gönderir, sonra slotu bırakır', async () => {
        const bridge = makeBridge([{ mac: 'AA:00:00:00:00:09', company: 'Y' }]);
        const watch = initOcppWatch({ ...bridge.deps, timing: { LEAVE_GRACE_MS: 0 }, ocppLive: initOcppLiveStore() });
        watch.ensure('Y', 'k');
        for (let i = 0; i < 60 && watch.state('Y').watching !== 1; i++) await new Promise((r) => setTimeout(r, 100));
        const sid = bridge.target.requests[0].session_id;
        expect(watch.isWatchSession(sid)).toBe(true);
        await watch.release(sid);
        expect(bridge.frames.at(-1)).toEqual([sid, 'frame 3 28 0']);
        expect(bridge.target.requests).toHaveLength(0);
        expect(watch.state('Y').occupied).toBe(1);
        await watch.leave('Y', 'k');
        watch._stopTimer();
    }, 20000);

    it('mesaj akarken dokunmaz; sessiz kalınca activate ile yoklar, cevap yoksa çevrimdışı sayar', async () => {
        const bridge = makeBridge([{ mac: 'AA:00:00:00:00:0A', company: 'Z' }]);
        const watch = initOcppWatch({ ...bridge.deps, timing: { LEAVE_GRACE_MS: 0, SILENCE_MS: 1500, ACTIVATE_WAIT_SEC: 3 }, ocppLive: initOcppLiveStore() });
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        watch.ensure('Z', 'k');
        for (let i = 0; i < 60 && watch.state('Z').watching !== 1; i++) await wait(100);
        const sid = bridge.target.requests[0].session_id;
        expect(bridge.state.activations).toBe(1);

        // mesaj akıyor: 2,5 sn boyunca her 500 ms'de bir satır → yoklama yok
        for (let i = 0; i < 5; i++) {
            bridge.responses[sid].message_response = { cmd: 3, msg: 28, time: `h${i}`, data: '[2, "u", "Heartbeat", {}]' };
            watch.ensure('Z', 'k');
            await wait(500);
        }
        expect(bridge.state.activations).toBe(1);

        // sessiz: ilk yoklamada ESP aktif → devam, 3 28 3 tekrar gönderilmez
        for (let i = 0; i < 40 && bridge.state.activations < 2; i++) { watch.ensure('Z', 'k'); await wait(100); }
        await wait(1200);
        expect(bridge.state.activations).toBe(2);
        expect(watch.state('Z').watching).toBe(1);
        expect(bridge.frames.filter(([, f]) => f === 'frame 3 28 3')).toHaveLength(1);

        // yine sessiz: ESP aktif ama üst üste ikinci kez → 3 28 3 bir kez daha
        for (let i = 0; i < 40 && bridge.state.activations < 3; i++) { watch.ensure('Z', 'k'); await wait(100); }
        await wait(1200);
        expect(bridge.frames.filter(([, f]) => f === 'frame 3 28 3')).toHaveLength(2);

        // cihaz kapandı: yoklamaya cevap yok → çevrimdışı, slot bırakılır
        bridge.state.online = false;
        for (let i = 0; i < 40 && bridge.state.activations < 4; i++) { watch.ensure('Z', 'k'); await wait(100); }
        for (let i = 0; i < 30 && !watch.state('Z').offline; i++) { watch.ensure('Z', 'k'); await wait(200); }
        expect(watch.state('Z').offline).toBe(1);
        expect(bridge.target.requests).toHaveLength(0);
        await watch.leave('Z', 'k');
        watch._stopTimer();
    }, 40000);

    it('sayfadan çıkıp kısa sürede dönülürse cihazlara yeniden bağlanmaz', async () => {
        const bridge = makeBridge([{ mac: 'AA:00:00:00:00:0B', company: 'W' }]);
        const watch = initOcppWatch({ ...bridge.deps, timing: { LEAVE_GRACE_MS: 1000 }, ocppLive: initOcppLiveStore() });
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        watch.ensure('W', 'k');
        for (let i = 0; i < 60 && watch.state('W').watching !== 1; i++) await wait(100);
        await watch.leave('W', 'k');
        await wait(400);
        watch.ensure('W', 'k'); // geri döndü
        await wait(1200);
        expect(watch.state('W').watching).toBe(1);
        expect(bridge.state.activations).toBe(1);
        expect(bridge.frames.filter(([, f]) => f === 'frame 3 28 0')).toHaveLength(0);

        await watch.leave('W', 'k'); // dönmedi → pay dolunca kapanır
        for (let i = 0; i < 40 && watch.state('W'); i++) await wait(100);
        expect(watch.state('W')).toBeNull();
        expect(bridge.frames.filter(([, f]) => f === 'frame 3 28 0')).toHaveLength(1);
        watch._stopTimer();
    }, 20000);
});
