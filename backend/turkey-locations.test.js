import { describe, it, expect } from 'vitest';
import { inferCityDistrict, canonicalCity, canonicalDistrict } from './turkey-locations.js';

describe('turkey-locations', () => {
    it('il adı geçen konumdan ili bulur', () => {
        expect(inferCityDistrict('Antalya Sur Yapı A Parsel Sitesi - 1')).toEqual({ city: 'Antalya', district: null });
    });

    it('yalnızca tek ile ait ilçe adı geçiyorsa ili de çıkarır', () => {
        expect(inferCityDistrict('Cuento Sitesi, Ümraniye - AC 1')).toEqual({ city: 'İstanbul', district: 'Ümraniye' });
        expect(inferCityDistrict('şile')).toEqual({ city: 'İstanbul', district: 'Şile' });
    });

    it('il ve ilçe birlikte geçiyorsa ikisini de alır', () => {
        expect(inferCityDistrict('Çelikler Holding No:105, Çankaya Ankara')).toEqual({ city: 'Ankara', district: 'Çankaya' });
    });

    it('il/ilçe geçmeyen konumda boş döner', () => {
        expect(inferCityDistrict('15 Temmuz Kapalı Otoparkı DC 01')).toEqual({ city: null, district: null });
        expect(inferCityDistrict('')).toEqual({ city: null, district: null });
    });

    it('yazımı resmi ada çevirir', () => {
        expect(canonicalCity('istanbul')).toBe('İstanbul');
        expect(canonicalDistrict('ankara', 'cankaya')).toBe('Çankaya');
        expect(canonicalCity('  ')).toBeNull();
    });
});
