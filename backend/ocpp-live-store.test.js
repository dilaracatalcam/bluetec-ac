import { describe, it, expect } from 'vitest';
import { initOcppLiveStore } from './ocpp-live-store.js';

describe('ocpp-live-store', () => {
    it('CALL ve cevabını cihaz bazında eşler, konsol akışına iki satır ekler', () => {
        const s = initOcppLiveStore();
        s.add('aa:bb:cc:dd:ee:ff', '[2, "u1", "Heartbeat", {}]', 1000);
        s.add('AA:BB:CC:DD:EE:FF', '[3, "u1", {"currentTime":"2026-10-14T11:00:00Z"}]', 1100);
        const events = s.events('AA:BB:CC:DD:EE:FF');
        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('Heartbeat');
        expect(events[0].result.dir).toBe('in');
        const f = s.feed(0);
        expect(f.lines.map((l) => l.type)).toEqual(['Heartbeat', 'Heartbeat']);
        expect(s.feed(f.lastId).lines).toHaveLength(0);
    });

    it('parçalı/JSON olmayan satırda eylem adını metinden alır', () => {
        const s = initOcppLiveStore();
        s.add('M1', 'OCPP TX MeterValues conn=1 E=1234Wh', 5);
        expect(s.events('M1')[0]).toMatchObject({ type: 'Meter Value', call: { dir: 'out' } });
    });

    it('kapsam filtresi uygulanır', () => {
        const s = initOcppLiveStore();
        s.add('M1', '[2, "a", "Heartbeat", {}]');
        s.add('M2', '[2, "b", "Heartbeat", {}]');
        expect(s.feed(0, (mac) => mac === 'M2').lines.map((l) => l.mac)).toEqual(['M2']);
    });
});
