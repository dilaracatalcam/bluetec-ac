import { describe, it, expect } from 'vitest';
import { espActive } from './esp-status.js';

const resp = (data, time, topic = 'DC:DA:0C:59:AA:58/status') => ({ status_response: { topic, data, time } });

describe('esp-status', () => {
    it('activate sonrası gelmeyen eski "ESP aktif" geçersizdir', () => {
        const since = Date.parse('2026-10-15T10:12:00Z');
        // TDB2 örneği: durum 12:51:24 (UTC+3) = 09:51:24Z, yoklama 10:12 → eski
        expect(espActive(resp('ESP aktif', '2026-10-15 12:51:24'), 'DC:DA:0C:59:AA:58', since)).toBe(false);
        expect(espActive(resp('ESP aktif', '2026-10-15 13:12:03'), 'DC:DA:0C:59:AA:58', since)).toBe(true);
        // saat farkı payı (30 sn)
        expect(espActive(resp('ESP aktif', '2026-10-15 13:11:45'), 'DC:DA:0C:59:AA:58', since)).toBe(true);
        // since yoksa yalnızca metin ve MAC'e bakılır
        expect(espActive(resp('ESP aktif', '2026-10-15 12:51:24'), 'DC:DA:0C:59:AA:58')).toBe(true);
    });

    it('başka MAC\'in ya da aktif olmayan durumun cevabı geçersizdir', () => {
        expect(espActive(resp('ESP aktif', '2026-10-15 13:12:03', 'AA:00:00:00:00:01/status'), 'DC:DA:0C:59:AA:58')).toBe(false);
        expect(espActive(resp('ESP pasif', '2026-10-15 13:12:03'), 'DC:DA:0C:59:AA:58')).toBe(false);
    });
});
