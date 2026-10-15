import { describe, it, expect } from 'vitest';
import { encodeActivationCode, decodeActivationCode } from './activation-code.js';

// server.js'teki önceki çözücünün birebir kopyası — yeni modül aynı sonucu vermeli
function legacyDecode(rawToken) {
    const token = String(rawToken || '').trim().toUpperCase().replace(/\s+/g, '');
    if (token.length !== 30) return null;
    const brand = 'BLUETECH';
    let digits = '';
    for (let index = 0; index < 15; index += 1) {
        if (token[index * 2] !== brand[index % brand.length]) return null;
        const digit = token[index * 2 + 1];
        if (!/[0-9]/.test(digit)) return null;
        digits += digit;
    }
    const reversedBits = BigInt(digits.split('').reverse().join(''));
    let value = 0n;
    for (let bit = 0; bit < 48; bit += 1) value = (value << 1n) | ((reversedBits >> BigInt(bit)) & 1n);
    let macValue = 0n;
    for (let byte = 0; byte < 6; byte += 1) macValue = (macValue << 8n) | ((value >> BigInt(byte * 8)) & 0xFFn);
    return macValue.toString(16).toUpperCase().padStart(12, '0');
}

const randomMac = () => Array.from({ length: 6 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join(':').toUpperCase();

describe('activation-code', () => {
    it('bilinen örnekler', () => {
        expect(encodeActivationCode('30:ED:A0:31:BE:64')).toBe('B8L3U6E1T4E6C1H1B2L0U8E9T3E1C0');
        expect(encodeActivationCode('AA:BB:CC:DD:EE:FF')).toBe('B3L4U3E7T5E0C4H4B5L8U0E4T4E9C0');
        expect(encodeActivationCode('30eda031be64')).toBe('B8L3U6E1T4E6C1H1B2L0U8E9T3E1C0');
        expect(encodeActivationCode('00:00:00:00:00:00')).toBe('B0L0U0E0T0E0C0H0B0L0U0E0T0E0C0');
        // 2^48-1 = 281474976710655 → ters rakamlar 556017647974182
        expect(encodeActivationCode('FF:FF:FF:FF:FF:FF')).toBe('B5L5U6E0T1E7C6H7B9L4U7E4T1E8C2');
        expect(encodeActivationCode('')).toBeNull();
        expect(encodeActivationCode('30:ED:A0')).toBeNull();
    });

    it('her MAC için kod → MAC gidiş-dönüşü ve eski çözücüyle aynı sonuç', () => {
        for (let i = 0; i < 2000; i++) {
            const mac = randomMac();
            const code = encodeActivationCode(mac);
            expect(code).toMatch(/^([A-Z][0-9]){15}$/);
            expect(decodeActivationCode(code)).toBe(mac.replace(/:/g, ''));
            expect(legacyDecode(code)).toBe(mac.replace(/:/g, ''));
        }
    });

    it('geçersiz kodlarda eski çözücüyle aynı davranır', () => {
        for (const t of ['', 'BLUETECH', 'X8L3U6E1T4E6C1H1B2L0U8E9T3E1C0', 'B8L3U6E1T4E6C1H1B2L0U8E9T3E1CX', ' b8l3u6e1t4e6c1h1b2l0u8e9t3e1c0 ']) {
            expect(decodeActivationCode(t)).toBe(legacyDecode(t));
        }
    });
});
