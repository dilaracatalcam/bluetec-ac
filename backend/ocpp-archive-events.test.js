import { describe, it, expect } from 'vitest';
import { parseOcppLog, mergeEvents, pickOcppFiles } from './ocpp-archive-events.js';

describe('ocpp-archive-events', () => {
    it('CALL ve CALLRESULT satırlarını uniqueId ile eşler, zamanı satır başından alır', () => {
        const text = [
            '2026-10-13 20:59:37.900 [2, "abc", "Heartbeat", {}]',
            '2026-10-13 20:59:37.963 [3, "abc", {"currentTime" : "2026-10-13T20:59:37.963882+00:00"}]',
        ].join('\n');
        const [ev, ...rest] = parseOcppLog(text);
        expect(rest).toHaveLength(0);
        expect(ev.type).toBe('Heartbeat');
        expect(ev.call.dir).toBe('out');
        expect(ev.result.dir).toBe('in');
        expect(ev.result.raw).toContain('currentTime');
    });

    it('dilimsiz saatleri Türkiye saati (UTC+3) kabul eder', () => {
        const [a] = parseOcppLog('2026-10-15 09:41:14 [2, "z1", "Heartbeat", {}]');
        expect(new Date(a.time).toISOString()).toBe('2026-10-15T06:41:14.000Z');
        const [b] = parseOcppLog('15/10/2026 09:41:14 [2, "z2", "Heartbeat", {}]');
        expect(new Date(b.time).toISOString()).toBe('2026-10-15T06:41:14.000Z');
        const [c] = parseOcppLog('2026-10-15T09:41:14Z [2, "z3", "Heartbeat", {}]');
        expect(new Date(c.time).toISOString()).toBe('2026-10-15T09:41:14.000Z');
    });

    it('ANSI renkli ve zaman damgasız satırlarda payload zamanını kullanır', () => {
        const text = '\x1b[32m[2, "m1", "MeterValues", {"connectorId":1,"meterValue":[{"timestamp":"2026-10-13T08:00:00Z","sampledValue":[]}]}]\x1b[0m';
        const [ev] = parseOcppLog(text);
        expect(ev.type).toBe('Meter Value');
        expect(ev.time).toBe(Date.parse('2026-10-13T08:00:00Z'));
    });

    it('HTML arşivini çözer, bağlantı kopmasını olay sayar', () => {
        const html = '<pre>13/10/2026 10:00:00 [2, &quot;r1&quot;, &quot;Reset&quot;, {&quot;type&quot;:&quot;Soft&quot;}]<br>13/10/2026 10:00:05 WebSocket disconnected</pre>';
        const events = parseOcppLog(html, 'html');
        expect(events.map((e) => e.type)).toEqual(['Reset', 'Disconnected']);
        expect(events[0].call.dir).toBe('in');
    });

    it('current + history birleşiminde aynı mesajı tekrarlamaz', () => {
        const a = parseOcppLog('2026-10-13T10:00:00Z [2, "x", "Authorize", {"idTag":"A"}]');
        const b = parseOcppLog('2026-10-13T10:00:00Z [2, "x", "Authorize", {"idTag":"A"}]\n2026-10-13T10:00:01Z [3, "x", {"idTagInfo":{"status":"Accepted"}}]');
        const merged = mergeEvents([a, b]);
        expect(merged).toHaveLength(1);
        expect(merged[0].result).not.toBeNull();
    });

    it('steve logunu html ve ikili arşive tercih eder', () => {
        const files = [
            { name: 'ocpp-current.html', family: 'ocpp', format: 'html', size: 10 },
            { name: 'ocpp-current.ocl', family: 'ocpp', format: 'ocl', size: 10 },
            { name: 'ocpp-current-steve.log', family: 'ocpp', format: 'text', size: 10 },
            { name: 'ocpp-history-steve.log', family: 'ocpp', format: 'text', size: 0 },
        ];
        expect(pickOcppFiles(files).map((f) => f.name)).toEqual(['ocpp-current-steve.log']);
    });
});
