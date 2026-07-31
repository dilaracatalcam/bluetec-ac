import Navigation from "../components/Navigation.jsx";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Kullanıcı Modu:
 * - SET/READ butonlarını göstermiyoruz
 * - READ: otomatik (sayfa açılınca ve periyodik)
 * - SET: sadece 9-14 için "Kaydet" ile
 * - responses.json'dan cmd=2 ile değerleri çekip ekrana basıyoruz
 * - ESP status mantığı Home.jsx ile aynı
 */

const BRAND_IDS = [9, 10, 11, 12, 13, 14];
const TELEMETRY_IDS = [22, 23, 24, 25, 27, 34];

const LABELS = {
  9: "Company Tel",
  10: "Company URL",
  11: "App Store URL",
  12: "Play Store URL",
  13: "Logo / Writing",
  14: "Company Name",

  22: "Charging Time",
  23: "Power (PRMS)",
  24: "Total Energy",
  25: "Charge State",
  27: "Error",
  34: "GSM Signal",
};

// Basit mapper (ham 0/1'i kullanıcıya göstermemek için)
// Not: 25 charge state mapping'i sizde netleşince burada güncelleriz.
function mapValue(id, raw) {
  if (raw === undefined || raw === null) return "—";
  const v = String(raw);

  if (id === 13) {
    if (v === "0") return "Writing";
    if (v === "1") return "Logo";
    return v;
  }

  if (id === 27) {
    if (v === "0") return "No Error";
    return `Error: ${v}`;
  }

  return v;
}

export default function UserDashboard() {
  const [espStatus, setEspStatus] = useState("unknown");
  const [isConnected, setIsConnected] = useState(false);

  const [mac, setMac] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  // READ ile gelen güncel değerler (msg -> data)
  const [readValues, setReadValues] = useState({});
  // SET OK takibi (msg -> true)
  const [setOkMap, setSetOkMap] = useState({});

  // Kullanıcı edit modları
  const [editingId, setEditingId] = useState(null);
  const [draftValue, setDraftValue] = useState("");

  // İlk toplu READ bir kere yapılsın diye
  const didInitialReadRef = useRef(false);

  /* ---------------- ESP STATUS POLLING (Home.jsx ile aynı) ---------------- */
  useEffect(() => {
    if (!isConnected) {
      setEspStatus("unknown");
      return;
    }

    const fetchStatus = async () => {
        try {
            const res = await fetch("/api/get-status");
            const data = await res.json();
            setEspStatus(data.espState);
            
            // ← YENİ: Timeout ile koparıldıysa kullanıcıyı bilgilendir
            if (data.timedOut) {
            setIsConnected(false);
            setMessage("10 dakika işlem yapılmadığı için bağlantı kesildi. Tekrar bağlanın.");
            }
        } catch {
            setEspStatus("nonactive");
        }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, [isConnected]);

  /* ---------------- KEEPALIVE (Home.jsx ile aynı) ---------------- */
  useEffect(() => {
    if (!isConnected) return;

    const sendKeepalive = async () => {
      try {
        await fetch("/api/keepalive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
      } catch (e) {}
    };

    sendKeepalive();
    const interval = setInterval(sendKeepalive, 20000);
    return () => clearInterval(interval);
  }, [isConnected]);

  /* ---------------- responses.json POLLING ----------------
     - cmd=2: READ değerlerini map'e yaz
     - cmd=1 & data=SET OK: setOkMap işaretle
  ---------------------------------------------------------- */
  useEffect(() => {
    if (!isConnected) {
      setReadValues({});
      setSetOkMap({});
      didInitialReadRef.current = false;
      return;
    }

    const fetchResponses = async () => {
      try {
        const res = await fetch("/api/responses");
        const json = await res.json();

        // SET OK map
        const okMap = {};
        (json.message_response || []).forEach((r) => {
          if (r?.data === "SET OK") okMap[r.msg] = true;
        });
        setSetOkMap(okMap);

        // READ values map (cmd=2)
        const rv = {};
        (json.message_response || []).forEach((r) => {
          if (r?.cmd === 2) {
            rv[r.msg] = r.data;
          }
        });

        // mevcut state ile merge
        setReadValues((prev) => ({ ...prev, ...rv }));
      } catch (e) {
        // sessiz geç
      }
    };

    fetchResponses();
    const interval = setInterval(fetchResponses, 1500);
    return () => clearInterval(interval);
  }, [isConnected]);

  /* ---------------- SEND COMMAND (Home.jsx mantığı ile aynı) ---------------- */
  const sendCommand = async (type, variable, value = "") => {
    if (!isConnected || espStatus !== "active") {
      setMessage("ESP aktif değil");
      return false;
    }

    try {
      const res = await fetch("/api/send-command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, variable, value }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(data.message || "Komut gönderilemedi");
        return false;
      } else {
        // kullanıcı modunda frame'i göstermiyoruz, sadece kısa mesaj
        setMessage("Komut gönderildi");
        return true;
      }
    } catch {
      setMessage("Sunucuya ulaşılamadı");
      return false;
    }
  };

  /* ---------------- MAC SUBMIT (Home.jsx ile aynı) ---------------- */
  const handleMacSubmit = async (e) => {
    e.preventDefault();
    setMessage("");
    setLoading(true);

    try {
      const res = await fetch("/api/update-target", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newTarget: mac }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessage(data.error || "Sunucu hatası");
        setIsConnected(false);
      } else {
        setMessage("Bağlantı isteği gönderildi");
        setIsConnected(true);
      }
    } catch {
      setMessage("Sunucuya ulaşılamadı");
      setIsConnected(false);
    } finally {
      setLoading(false);
    }
  };

  /* ---------------- Initial READ: ESP active olunca 1 kere ---------------- */
  useEffect(() => {
    if (!isConnected) return;
    if (espStatus !== "active") return;
    if (didInitialReadRef.current) return;

    didInitialReadRef.current = true;

    // Branding + Telemetry hepsini bir kez oku
    const idsToRead = [...BRAND_IDS, ...TELEMETRY_IDS];

    (async () => {
      for (const id of idsToRead) {
        // READ: frame 2 <id>
        await sendCommand("read", id);
      }
      setMessage(""); // ilk okumadan sonra mesajı temizleyelim
    })();
  }, [isConnected, espStatus]);

  /* ---------------- Telemetry periodic READ (2.5s) ---------------- */
  useEffect(() => {
    if (!isConnected) return;
    if (espStatus !== "active") return;

    const tick = async () => {
      for (const id of TELEMETRY_IDS) {
        await sendCommand("read", id);
      }
    };

    const interval = setInterval(tick, 2500);
    return () => clearInterval(interval);
  }, [isConnected, espStatus]);

  /* ---------------- SET sonrası auto-READ (SET OK gelince) ----------------
     Basit yaklaşım:
     - Kullanıcı Kaydet dediğinde: set gönderir
     - Sonra biz ayrıca read gönderiyoruz (SET OK beklemeden)
     Bu mantığı bozmuyor, sadece UX iyileştiriyor.
  ---------------------------------------------------------- */
  const handleSave = async (id) => {
    const ok = await sendCommand("set", id, draftValue);
    if (!ok) return;

    // hemen doğrulama READ
    await sendCommand("read", id);

    setEditingId(null);
    setDraftValue("");
  };

  const statusBadge = useMemo(() => {
    if (!isConnected) {
      return { text: "ESP seçilmedi", cls: "bg-slate-800 border-slate-700 text-slate-200" };
    }
    if (espStatus === "unknown") {
      return { text: "Connecting…", cls: "bg-yellow-600/20 text-yellow-200 border-yellow-600/40" };
    }
    if (espStatus === "active") {
      return { text: "ONLINE", cls: "bg-green-600/20 text-green-200 border-green-600/40" };
    }
    return { text: "OFFLINE", cls: "bg-red-600/20 text-red-200 border-red-600/40" };
  }, [isConnected, espStatus]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      <Navigation />

      <main className="flex flex-col items-center flex-1 py-10 px-4">
        <div className="w-full max-w-5xl">
          {/* STATUS BAR */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
            <span className={`px-3 py-1 rounded-full text-sm border ${statusBadge.cls}`}>
              {statusBadge.text}
            </span>

            {isConnected && mac && (
              <span className="text-sm text-slate-300">
                Target MAC: <span className="font-semibold text-slate-100">{mac}</span>
              </span>
            )}
          </div>

          {/* CONNECT CARD */}
          <form
            onSubmit={handleMacSubmit}
            className="mb-8 bg-slate-900 border border-slate-700 rounded-xl p-5 max-w-xl"
          >
            <div className="mb-3 text-sm text-slate-300 flex items-center gap-2">
              <span>🔗</span>
              <span>Cihaz MAC Adresi</span>
            </div>

            <div className="flex gap-3">
              <input
                value={mac}
                onChange={(e) => setMac(e.target.value)}
                placeholder="AA:BB:CC:DD:EE:FF"
                required
                className="flex-1 bg-slate-800 border border-slate-600 text-slate-100 p-2 rounded outline-none focus:border-blue-500"
              />

              <button
                disabled={loading}
                className={`px-5 rounded font-medium transition ${
                  loading ? "bg-slate-600 text-slate-300" : "bg-green-600 hover:bg-green-700 text-white"
                }`}
              >
                {loading ? "Gönderiliyor..." : "Bağlan"}
              </button>
            </div>
          </form>

          {message && <p className="mb-6 text-slate-200">{message}</p>}

          {/* TELEMETRY CARDS */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { id: 23, title: "Power", unit: "kW" },
              { id: 24, title: "Energy", unit: "kWh" },
              { id: 22, title: "Time", unit: "" },
              { id: 34, title: "Signal", unit: "" },
              { id: 25, title: "Charge State", unit: "" },
              { id: 27, title: "Error", unit: "" },
            ].map((card) => (
              <div key={card.id} className="bg-slate-900 border border-slate-700 rounded-xl p-5">
                <div className="text-sm text-slate-400">{card.title}</div>
                <div className="text-2xl font-bold mt-2">
                  {mapValue(card.id, readValues[card.id])}
                  {card.unit ? <span className="text-base font-semibold text-slate-400"> {card.unit}</span> : null}
                </div>
                <div className="text-xs text-slate-500 mt-2">ID: {card.id}</div>
              </div>
            ))}
          </div>

          {/* BRANDING SETTINGS (Editable, no SET/READ buttons) */}
          <div className="mt-10 bg-slate-900 border border-slate-700 rounded-xl p-5">
            <div className="text-slate-300 font-semibold mb-4">Branding Settings</div>

            <div className="grid grid-cols-12 gap-3 text-xs text-slate-400 mb-2">
              <div className="col-span-3">Parameter</div>
              <div className="col-span-6">Value</div>
              <div className="col-span-3 text-right">Action</div>
            </div>

            {BRAND_IDS.map((id, index) => {
              const isEditing = editingId === id;
              const currentValue = readValues[id];

              return (
                <div
                  key={id}
                  className={`grid grid-cols-12 gap-3 items-center py-3 px-2 border-slate-600 ${
                    index !== BRAND_IDS.length - 1 ? "border-b" : ""
                  } hover:bg-slate-800/60 transition-colors`}
                >
                  <div className="col-span-3 text-slate-200 text-sm">
                    {LABELS[id]} <span className="text-slate-500">({id})</span>
                  </div>

                  <div className="col-span-6">
                    {!isEditing ? (
                      <div className="text-slate-100 text-sm">
                        {mapValue(id, currentValue)}
                      </div>
                    ) : (
                      <input
                        className="w-full bg-slate-800 border border-slate-600 text-slate-100 p-2 rounded outline-none focus:border-blue-500 text-sm"
                        value={draftValue}
                        onChange={(e) => setDraftValue(e.target.value)}
                        placeholder="Yeni değer"
                        disabled={!isConnected || espStatus !== "active"}
                      />
                    )}
                  </div>

                  <div className="col-span-3 flex justify-end gap-2">
                    {!isEditing ? (
                      <>
                        <button
                          onClick={async () => {
                            // önce güncel değeri çekelim (arka planda read)
                            await sendCommand("read", id);

                            setEditingId(id);
                            setDraftValue(currentValue ?? "");
                          }}
                          disabled={!isConnected || espStatus !== "active"}
                          className={`px-3 py-1 rounded text-xs font-medium transition ${
                            !isConnected || espStatus !== "active"
                              ? "bg-slate-700 text-slate-400"
                              : "bg-slate-700 hover:bg-slate-600 text-white"
                          }`}
                        >
                          Edit
                        </button>

                        {setOkMap[id] && (
                          <span className="text-green-400 text-xs font-semibold self-center">✔</span>
                        )}
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => {
                            setEditingId(null);
                            setDraftValue("");
                          }}
                          className="px-3 py-1 rounded text-xs font-medium bg-slate-700 hover:bg-slate-600"
                        >
                          Cancel
                        </button>

                        <button
                          onClick={() => handleSave(id)}
                          disabled={!isConnected || espStatus !== "active"}
                          className={`px-3 py-1 rounded text-xs font-medium transition ${
                            !isConnected || espStatus !== "active"
                              ? "bg-slate-700 text-slate-400"
                              : "bg-blue-600 hover:bg-blue-700 text-white"
                          }`}
                        >
                          Save
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Admin link */}
          <div className="mt-8 text-sm text-slate-400">
            Admin panel: <a className="underline text-slate-200" href="/admin">/admin</a>
          </div>
        </div>
      </main>
    </div>
  );
}
