"use client";

import { useEffect, useState } from "react";

interface TenantLink {
  label: string;
  url: string;
}

interface BusinessHours {
  enabled: boolean;
  days: number[];
  open: string;
  close: string;
}

interface TenantConfig {
  business_name: string | null;
  business_type: string | null;
  payment_info: string | null;
  custom_greeting: string | null;
  custom_prompt: string | null;
  catalog_url: string | null;
  catalog_message: string | null;
  assistant_name: string | null;
  business_address: string | null;
  business_hours: BusinessHours;
  out_of_hours_message: string | null;
  extra_links: TenantLink[];
}

const DAYS = [
  { n: 1, label: "Lun" },
  { n: 2, label: "Mar" },
  { n: 3, label: "Mié" },
  { n: 4, label: "Jue" },
  { n: 5, label: "Vie" },
  { n: 6, label: "Sáb" },
  { n: 7, label: "Dom" },
];

const DEFAULT_CONFIG: TenantConfig = {
  business_name: "",
  business_type: "",
  payment_info: "",
  custom_greeting: "",
  custom_prompt: "",
  catalog_url: "",
  catalog_message: "",
  assistant_name: "",
  business_address: "",
  business_hours: {
    enabled: false,
    days: [1, 2, 3, 4, 5, 6],
    open: "09:00",
    close: "18:00",
  },
  out_of_hours_message: "",
  extra_links: [],
};

export default function ConfigPanel() {
  const [config, setConfig] = useState<TenantConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadConfig();
  }, []);

  async function loadConfig() {
    try {
      const res = await fetch("/api/tenant/config", { cache: "no-store" });
      if (!res.ok) {
        setError("Error al cargar configuración");
        return;
      }
      const data = (await res.json()) as Partial<TenantConfig>;
      setConfig({
        business_name: data.business_name ?? "",
        business_type: data.business_type ?? "",
        payment_info: data.payment_info ?? "",
        custom_greeting: data.custom_greeting ?? "",
        custom_prompt: data.custom_prompt ?? "",
        catalog_url: data.catalog_url ?? "",
        catalog_message: data.catalog_message ?? "",
        assistant_name: data.assistant_name ?? "",
        business_address: data.business_address ?? "",
        business_hours: data.business_hours ?? DEFAULT_CONFIG.business_hours,
        out_of_hours_message: data.out_of_hours_message ?? "",
        extra_links: Array.isArray(data.extra_links) ? data.extra_links : [],
      });
    } catch {
      setError("Error de conexión");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/tenant/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Error al guardar");
        return;
      }
      // Recargar para confirmar que se guardó
      await loadConfig();
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch {
      setError("Error de conexión");
    } finally {
      setSaving(false);
    }
  }

  function toggleDay(day: number) {
    const days = config.business_hours.days.includes(day)
      ? config.business_hours.days.filter((d) => d !== day)
      : [...config.business_hours.days, day].sort();
    setConfig({
      ...config,
      business_hours: { ...config.business_hours, days },
    });
  }

  function addLink() {
    if (config.extra_links.length >= 5) return;
    setConfig({
      ...config,
      extra_links: [...config.extra_links, { label: "", url: "" }],
    });
  }

  function updateLink(index: number, field: "label" | "url", value: string) {
    const links = [...config.extra_links];
    links[index] = { ...links[index], [field]: value };
    setConfig({ ...config, extra_links: links });
  }

  function removeLink(index: number) {
    setConfig({
      ...config,
      extra_links: config.extra_links.filter((_, i) => i !== index),
    });
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        Cargando configuración...
      </div>
    );
  }

  const inputClass =
    "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none";

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h2 className="mb-1 text-xl font-semibold text-gray-900">
        Configuración del negocio
      </h2>
      <p className="mb-6 text-sm text-gray-500">
        Personaliza cómo el bot atiende a tus clientes. Los mensajes fijos
        (saludo, links, fuera de horario) se envían sin usar IA, ahorrando
        tokens.
      </p>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {saved && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
          <svg
            className="h-5 w-5 flex-shrink-0 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
          <span>
            <strong>Guardado correctamente.</strong> Los cambios ya están
            activos en el bot.
          </span>
        </div>
      )}

      <div className="space-y-6">
        {/* Sección 1: Negocio */}
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
            Negocio
          </h3>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Nombre del negocio
              </label>
              <input
                type="text"
                value={config.business_name ?? ""}
                onChange={(e) =>
                  setConfig({ ...config, business_name: e.target.value })
                }
                placeholder="Ej: Cookliz, Mi Tienda, etc."
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Tipo de negocio
              </label>
              <input
                type="text"
                value={config.business_type ?? ""}
                onChange={(e) =>
                  setConfig({ ...config, business_type: e.target.value })
                }
                placeholder="Ej: repostería, ropa, ferretería, restaurante..."
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Dirección física
              </label>
              <input
                type="text"
                value={config.business_address ?? ""}
                onChange={(e) =>
                  setConfig({ ...config, business_address: e.target.value })
                }
                placeholder="Ej: Calle 123 #45-67, Barrio Centro"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-400">
                La IA usa esta info para responder preguntas sobre ubicación
              </p>
            </div>
          </div>
        </section>

        {/* Sección 2: Asistente */}
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
            Asistente
          </h3>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Nombre del asistente
              </label>
              <input
                type="text"
                value={config.assistant_name ?? ""}
                onChange={(e) =>
                  setConfig({ ...config, assistant_name: e.target.value })
                }
                placeholder="Ej: Liz, Sofía, Carlos..."
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-400">
                El bot se presentará con este nombre
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Saludo personalizado
              </label>
              <input
                type="text"
                value={config.custom_greeting ?? ""}
                onChange={(e) =>
                  setConfig({ ...config, custom_greeting: e.target.value })
                }
                placeholder="Ej: Holaa, cuéntame qué se te antoja 😄"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-400">
                Se envía como primer mensaje sin usar IA (ahorra tokens)
              </p>
            </div>
          </div>
        </section>

        {/* Sección 3: Catálogo y links */}
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
            Catálogo y links
          </h3>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                URL del catálogo
              </label>
              <input
                type="url"
                value={config.catalog_url ?? ""}
                onChange={(e) =>
                  setConfig({ ...config, catalog_url: e.target.value })
                }
                placeholder="https://wa.me/... o https://tu-catalogo.com"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-400">
                Se envía automáticamente en el primer mensaje del cliente
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Mensaje al enviar catálogo
              </label>
              <input
                type="text"
                value={config.catalog_message ?? ""}
                onChange={(e) =>
                  setConfig({ ...config, catalog_message: e.target.value })
                }
                placeholder="Aquí te dejo nuestro catálogo completo 😋"
                className={inputClass}
              />
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700">
                  Links adicionales (máx 5)
                </label>
                {config.extra_links.length < 5 && (
                  <button
                    onClick={addLink}
                    className="text-xs font-medium text-slate-600 hover:text-slate-900"
                  >
                    + Agregar link
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {config.extra_links.map((link, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      type="text"
                      value={link.label}
                      onChange={(e) => updateLink(i, "label", e.target.value)}
                      placeholder="Ej: Instagram"
                      className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                    />
                    <input
                      type="url"
                      value={link.url}
                      onChange={(e) => updateLink(i, "url", e.target.value)}
                      placeholder="https://..."
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                    />
                    <button
                      onClick={() => removeLink(i)}
                      className="rounded-lg px-2 text-sm text-red-500 hover:bg-red-50"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                {config.extra_links.length === 0 && (
                  <p className="text-xs text-gray-400">
                    Agrega links de Instagram, ubicación, Facebook, etc. Se
                    envían junto con el catálogo.
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Sección 4: Horarios */}
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
            Horarios de atención
          </h3>
          <div className="space-y-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={config.business_hours.enabled}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    business_hours: {
                      ...config.business_hours,
                      enabled: e.target.checked,
                    },
                  })
                }
                className="rounded border-gray-300"
              />
              <span className="text-sm font-medium text-gray-700">
                Activar horarios de atención
              </span>
            </label>
            {config.business_hours.enabled && (
              <>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Días de atención
                  </label>
                  <div className="flex gap-2">
                    {DAYS.map((d) => (
                      <button
                        key={d.n}
                        onClick={() => toggleDay(d.n)}
                        className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${config.business_hours.days.includes(d.n) ? "bg-slate-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Apertura
                    </label>
                    <input
                      type="time"
                      value={config.business_hours.open}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          business_hours: {
                            ...config.business_hours,
                            open: e.target.value,
                          },
                        })
                      }
                      className={inputClass}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="mb-1 block text-sm font-medium text-gray-700">
                      Cierre
                    </label>
                    <input
                      type="time"
                      value={config.business_hours.close}
                      onChange={(e) =>
                        setConfig({
                          ...config,
                          business_hours: {
                            ...config.business_hours,
                            close: e.target.value,
                          },
                        })
                      }
                      className={inputClass}
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Mensaje fuera de horario
                  </label>
                  <textarea
                    value={config.out_of_hours_message ?? ""}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        out_of_hours_message: e.target.value,
                      })
                    }
                    placeholder="¡Gracias por escribir! En este momento estamos cerrados. Te respondemos en nuestro horario de atención."
                    rows={2}
                    className={inputClass}
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    Se envía automáticamente fuera de horario sin usar IA
                    (ahorra tokens)
                  </p>
                </div>
              </>
            )}
          </div>
        </section>

        {/* Sección 5: Pagos */}
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
            Pagos
          </h3>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Información de pago
            </label>
            <textarea
              value={config.payment_info ?? ""}
              onChange={(e) =>
                setConfig({ ...config, payment_info: e.target.value })
              }
              placeholder="Ej: Transferencia: 3225669765 (Nequi y Daviplata). Pedir comprobante. Efectivo: confirmar monto exacto."
              rows={3}
              className={inputClass}
            />
          </div>
        </section>

        {/* Sección 6: Avanzado */}
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
            Avanzado
          </h3>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Instrucciones personalizadas
            </label>
            <textarea
              value={config.custom_prompt ?? ""}
              onChange={(e) =>
                setConfig({ ...config, custom_prompt: e.target.value })
              }
              placeholder="Ej: Solo atendemos delivery de 9am a 6pm. No aceptamos pedidos para otro día."
              rows={4}
              className={inputClass}
            />
            <p className="mt-1 text-xs text-gray-400">
              Reglas adicionales que el bot debe seguir (opcional)
            </p>
          </div>
        </section>

        <div className="pt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
          >
            {saving ? "Guardando..." : "Guardar configuración"}
          </button>
        </div>
      </div>
    </div>
  );
}
