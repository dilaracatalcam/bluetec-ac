import { describe, it, expect } from 'vitest';
import { initDeviceInventorySync } from './device-inventory-sync.js';

function setup() {
    const devices = [
        { mac: 'AA:BB:CC:00:00:01', sw_version: 'v@4.0.3', connection: 'GSM', logo: 'var' },
        { mac: 'AA:BB:CC:00:00:02', sw_version: 'v@4.0.3' },
    ];
    const target = { requests: [{ session_id: 'ali', target: 'AA:BB:CC:00:00:01', control: 'activate' }] };
    const writes = [];
    const sync = initDeviceInventorySync({
        readTarget: async () => target,
        getDevices: () => devices,
        updateDeviceInventoryByMac: (mac, fields) => { writes.push([mac, fields]); return 1; },
        log: {},
    });
    const resp = (msg, data, time, topic = 'AA:BB:CC:00:00:01/status') => ({
        responses: { ali: { status_response: { topic, data: 'ESP aktif' }, message_response: { cmd: 2, msg, time, data } } },
    });
    return { devices, target, writes, sync, resp };
}

describe('device-inventory-sync', () => {
    it('yeni gelen okuma cevabını bağlı cihazın kaydına yazar', async () => {
        const { sync, writes, resp } = setup();
        sync.observe({ responses: { ali: { status_response: { data: 'ESP aktif' }, message_response: null } } });
        sync.observe(resp(33, 'v@4.0.6', 't1'));
        sync.observe(resp(7, '2', 't2'));
        await sync._idle();
        expect(writes).toEqual([['AABBCC000001', { sw_version: 'v@4.0.6' }], ['AABBCC000001', { connection: 'WiFi' }]]);
    });

    it('ilk görülen mesajı, aynı değeri, SET OK cevabını ve başka MAC\'ten gelen cevabı yazmaz', async () => {
        const { sync, writes, resp } = setup();
        sync.observe(resp(33, 'v@9.9.9', 't0'));            // açılışta var olan mesaj
        sync.observe(resp(33, 'v@4.0.3', 't1'));            // veritabanıyla aynı
        sync.observe(resp(33, 'SET OK', 't2'));
        sync.observe(resp(33, 'v@5.0.0', 't3', 'AA:BB:CC:00:00:02/status')); // eski cihazın cevabı
        sync.observe(resp(4, '22', 't4'));                  // eşlenmeyen değişken
        await sync._idle();
        expect(writes).toEqual([]);
    });
});
