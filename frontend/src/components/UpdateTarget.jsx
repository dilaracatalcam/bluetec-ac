import { useState } from 'react';

export default function UpdateTarget() {
  const [mac, setMac] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');
    setLoading(true);

    try {
      // Backend’e istek atıyoruz (proxy varsa sadece '/api' yeter)
      const res = await fetch('/api/update-target', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newTarget: mac })
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(` Hata: ${data.error || 'Sunucu hatası'}`);
      } else {
        setMessage(` Başarılı! Yeni hedef: ${data.newTarget}`);
        setMac('');
      }
    } catch (err) {
      console.error(err);
      setMessage('Sunucuya ulaşılamadı.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
      <form
        onSubmit={handleSubmit}
        className="bg-white shadow-xl rounded-2xl p-6 w-96 border border-gray-200"
      >
        <h2 className="text-xl font-semibold mb-4 text-center">
          MAC Adresi Güncelle
        </h2>

        <input
          type="text"
          value={mac}
          onChange={(e) => setMac(e.target.value)}
          placeholder="AA:BB:CC:DD:EE:FF"
          className="w-full border p-2 rounded mb-3 text-center"
          required
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded"
        >
          {loading ? 'Gönderiliyor...' : 'Bağlan'}
        </button>

        {message && (
          <p
            className={`mt-4 text-center text-sm ${
              message.startsWith('') ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {message}
          </p>
        )}
      </form>
    </div>
  );
}