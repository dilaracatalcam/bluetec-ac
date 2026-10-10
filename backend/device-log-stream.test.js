import { describe, it, expect } from 'vitest';
import { initDeviceLogStream } from './device-log-stream.js';

function make() {
    const s = initDeviceLogStream({ RESPONSES_PATH: '/nonexistent/responses.json', readResponses: async () => ({ responses: {} }) });
    s.stop();
    return s;
}
const resp = (cmd, msg, data, time = 't') => ({ u: { message_response: { cmd, msg, data, time } } });

describe('device-log-stream', () => {
    it('ilk taramadaki eski mesajı satır saymaz, sonraki değişiklikleri biriktirir', () => {
        const s = make();
        s.read('u', 0);
        s._ingest(resp(2, 38, '1'));
        expect(s.read('u', 0).lines).toHaveLength(0);
        s._ingest(resp(3, 28, 'seq=1 cat=msp | A', 't1'));
        s._ingest(resp(3, 28, 'seq=1 cat=msp | A', 't1')); // aynı mesaj — tekrar eklenmez
        s._ingest(resp(3, 29, 'seq=2 cat=net | B', 't2'));
        const out = s.read('u', 0);
        expect(out.lines.map((l) => l.data)).toEqual(['seq=1 cat=msp | A', 'seq=2 cat=net | B']);
        expect(s.read('u', out.lines[0].id).lines).toHaveLength(1);
    });

    it('set/read cevaplarını (cmd 1/2) log saymaz', () => {
        const s = make();
        s.read('u', 0);
        s._ingest(resp(3, 28, 'x'));
        s._ingest(resp(2, 25, 'P2_PLUG_IN'));
        s._ingest(resp(1, 66, 'SET OK'));
        expect(s.read('u', 0).lines).toHaveLength(0);
    });

    it('çok satırlı veriyi böler, clear tamponu boşaltır ama id saymaya devam eder', () => {
        const s = make();
        s.read('u', 0);
        s._ingest(resp(0, 0, ''));
        s._ingest(resp(3, 28, 'a\nb'));
        const out = s.read('u', 0);
        expect(out.lines).toHaveLength(2);
        s.clear('u');
        expect(s.read('u', 0)).toMatchObject({ lines: [], lastId: out.lastId });
    });

    it('açık log modlarını satır tamponundan bağımsız hatırlar', () => {
        const s = make();
        expect(s.activeGroups('u')).toEqual([]);
        s.setMode('u', 28, 4);
        s.setMode('u', 29, 2);
        s.setMode('u', 29, 0);
        s.drop('u'); // cihaz değişince tampon silinir ama açık mod bilgisi kalır
        expect(s.activeGroups('u')).toEqual([28]);
        expect(s.read('u', 0).modes).toEqual({ 28: 4, 29: 0 });
        s.clearModes('u');
        expect(s.activeGroups('u')).toEqual([]);
    });
});
