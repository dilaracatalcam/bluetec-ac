import { describe, it, expect } from 'vitest';
import { chargeStateFromOcpp } from './ocpp-charge-state.js';

const call = (action, payload) => `[OCPP] -> [2,"u1","${action}",${JSON.stringify(payload)}]`;
const state = (line) => chargeStateFromOcpp(line)?.state ?? null;

describe('ocpp-charge-state', () => {
    it('StatusNotification durumlarını eşler', () => {
        expect(state(call('StatusNotification', { connectorId: 1, status: 'Available', errorCode: 'NoError' }))).toBe('idle');
        expect(state(call('StatusNotification', { connectorId: 1, status: 'Preparing' }))).toBe('waiting_rfid');
        expect(state(call('StatusNotification', { connectorId: 1, status: 'Charging' }))).toBe('charging');
        expect(state(call('StatusNotification', { connectorId: 1, status: 'SuspendedEV' }))).toBe('waiting_rfid');
        expect(state(call('StatusNotification', { connectorId: 1, status: 'Finishing' }))).toBe('charge_ended');
        expect(chargeStateFromOcpp(call('StatusNotification', { connectorId: 1, status: 'Faulted', errorCode: 'GroundFailure' })))
            .toMatchObject({ state: 'error', raw: 'OCPP: Faulted (GroundFailure)' });
        // konnektör 0: yalnızca arıza alınır
        expect(state(call('StatusNotification', { connectorId: 0, status: 'Available' }))).toBeNull();
        expect(state(call('StatusNotification', { connectorId: 0, status: 'Faulted' }))).toBe('error');
    });

    it('MeterValues: güç çekiliyorsa şarj oluyor, güç yoksa durumu değiştirmez', () => {
        const mv = (sampledValue, extra = {}) => call('MeterValues', { connectorId: 1, ...extra, meterValue: [{ timestamp: 't', sampledValue }] });
        expect(chargeStateFromOcpp(mv([{ value: '7.4', measurand: 'Power.Active.Import', unit: 'kW' }])))
            .toMatchObject({ state: 'charging', raw: 'OCPP: MeterValues 7.4 kW' });
        expect(state(mv([{ value: '16', measurand: 'Current.Import', unit: 'A' }]))).toBe('charging');
        expect(state(mv([{ value: '0', measurand: 'Power.Active.Import', unit: 'W' }], { transactionId: 5 }))).toBeNull();
        // yalnızca enerji sayacı: işlem varsa şarj sürüyor, yoksa bilinmez
        expect(state(mv([{ value: '1200' }], { transactionId: 5 }))).toBe('charging');
        expect(state(mv([{ value: '1200' }]))).toBeNull();
    });

    it('işlem başlangıcı/bitişi; durum taşımayan mesajlar ve cevaplar null', () => {
        expect(state(call('StartTransaction', { connectorId: 1, idTag: 'X', meterStart: 0 }))).toBe('charging');
        expect(state(call('StopTransaction', { transactionId: 5, meterStop: 10, reason: 'EVDisconnected' }))).toBe('charge_ended');
        expect(state(call('Heartbeat', {}))).toBeNull();
        expect(state('[3,"u1",{"status":"Accepted"}]')).toBeNull();
        expect(state('Wifi bağlandı')).toBeNull();
    });

    it('cihazın 3 28 3 log satırlarını okur (canlıdan alınmış örnekler)', () => {
        const line = (dir, action, rest) => `VERBOSE | seq=9770 uptime=80238852ms cat=ocpp | ${dir}    ${action}                ${rest}`;
        expect(chargeStateFromOcpp(line('<- Received', 'MeterValues', 'transactionId=1645 power=8290.0 energy=32050.000')))
            .toMatchObject({ state: 'charging', raw: 'OCPP: MeterValues 8.3 kW' });
        // 100 W: araç akım çekmiyor sayılır, mevcut durum korunur
        expect(state(line('<- Received', 'MeterValues', 'transactionId=1646 power=100.0 energy=11820.000'))).toBeNull();
        expect(state(line('-> Sending', 'MeterValues', 'OK'))).toBeNull();
        expect(state(line('-> Sending', 'Heartbeat', 'currentTime=2026-10-15T10:01:44.768Z'))).toBeNull();
        expect(state(line('<- Received', 'Heartbeat', '{}'))).toBeNull();
        expect(state('VERBOSEA GIRDIM')).toBeNull();
        expect(state(line('-> Sending', 'StatusNotification', 'connectorId=1 status=Charging errorCode=NoError'))).toBe('charging');
        expect(state(line('-> Sending', 'StatusNotification', 'connectorId=1 Finishing'))).toBe('charge_ended');
        expect(state(line('-> Sending', 'StopTransaction', 'transactionId=1645 reason=EVDisconnected'))).toBe('charge_ended');
    });
});
