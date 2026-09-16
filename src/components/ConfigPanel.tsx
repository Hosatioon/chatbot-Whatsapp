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
  feedback_message: string | null;
  admin_phone: string | null;
  delivery_price: number | null;
  business_location_url: string | null;
  business_location_detected: boolean;
  price_per_km: number | null;
  max_delivery_km: number | null;
  min_order_amount: number | null;
  min_delivery_price: number | null;
  bot_paused: boolean;
  paused_message: string | null;
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
  feedback_message: "",
  admin_phone: "",
  delivery_price: null,
  business_location_url: "",
  business_location_detected: false,
  price_per_km: null,
  max_delivery_km: null,
  min_order_amount: null,
  min_delivery_price: null,
  bot_paused: false,
  paused_message: "",
};

interface Props {
  selectedTenantId?: number;
}

export default function ConfigPanel({ selectedTenantId = 0 }: Props) {
  const [config, setConfig] = useState<TenantConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [botPhone, setBotPhone] = useState<string | null>(null);
  const [adminActivated, setAdminActivated] = useState<boolean | null>(null);

  const tenantQs = selectedTenantId > 0 ? `?tenantId=${selectedTenantId}` : "";

  useEffect(() => {
    void loadConfig();
    void loadBotPhone();
    void loadAdminActivationStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenantId]);

  async function loadBotPhone() {
    try {
      const res = await fetch(`/api/connection/status${tenantQs}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { status?: string; phone?: string };
      if (data.status === "connected" && data.phone) setBotPhone(data.phone);
      else setBotPhone(null);
    } catch {
      setBotPhone(null);
    }
  }

  // Consulta si el número admin_phone ya "activó" las notificaciones (ya
  // escribió al menos una vez al bot) — así el panel puede mostrar un
  // check en vez de dejar al dueño adivinando si ya funciona o no.
  async function loadAdminActivationStatus() {
    try {
      const res = await fetch(`/api/tenant/admin-notify-status${tenantQs}`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        configured?: boolean;
        activated?: boolean;
      };
      setAdminActivated(data.configured ? (data.activated ?? false) : null);
    } catch {
      setAdminActivated(null);
    }
  }

  async function loadConfig() {
    setLoading(true);
    try {
      const res = await fetch(`/api/tenant/config${tenantQs}`, {
        cache: "no-store",
      });
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
        feedback_message: data.feedback_message ?? "",
        admin_phone: data.admin_phone ?? "",
        delivery_price: data.delivery_price ?? null,
        business_location_url: data.business_location_url ?? "",
        business_location_detected: data.business_location_detected ?? false,
        price_per_km: data.price_per_km ?? null,
        max_delivery_km: data.max_delivery_km ?? null,
        min_order_amount: data.min_order_amount ?? null,
        min_delivery_price: data.min_delivery_price ?? null,
        bot_paused: data.bot_paused ?? false,
        paused_message: data.paused_message ?? "",
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
      const res = await fetch(`/api/tenant/config${tenantQs}`, {
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
      // El admin_phone pudo haber cambiado — la activación es por número,
      // así que hay que volver a chequear con el nuevo valor.
      void loadAdminActivationStatus();
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
      <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
        {[0, 1, 2].map((section) => (
          <div key={section} className="space-y-3">
            <div className="skeleton h-4 w-32 rounded" />
            <div className="skeleton h-10 w-full rounded-lg" />
            <div className="skeleton h-10 w-full rounded-lg" />
          </div>
        ))}
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
        Personaliza cómo el bot atiende a tus clientes.
      </p>

      {error && (
        <div className="animate-slide-down mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {saved && (
        <div className="animate-slide-down mb-4 flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
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
        {/* Nota: la sección "Estado del bot" (pausar/reanudar) se sacó de
            este panel a propósito — no queremos que el negocio pueda
            apagar el bot por su cuenta. bot_paused/paused_message siguen
            existiendo en el tipo/estado/API para no perder el round-trip,
            y se pueden manejar directo por DB o super-admin si hace falta. */}

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
                placeholder="Ej: Ana, Camila, Andrés..."
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
                    Se envía automáticamente fuera de horario
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    Mensaje de retroalimentación
                  </label>
                  <textarea
                    value={config.feedback_message ?? ""}
                    onChange={(e) =>
                      setConfig({
                        ...config,
                        feedback_message: e.target.value,
                      })
                    }
                    placeholder="¡Tu pedido ya fue entregado! 🎉 Cuéntanos, ¿qué te pareció? Tu opinión nos ayuda a mejorar 😊"
                    rows={3}
                    className={inputClass}
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    Se envía automáticamente al cliente cuando el pedido se
                    marca como entregado. Si lo dejás vacío, se usa un mensaje
                    genérico.
                  </p>
                </div>
              </>
            )}
          </div>
        </section>

        {/* Sección 5: Domicilio por GPS */}
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
            Domicilio por GPS
          </h3>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Ubicación del local (link de Google Maps)
              </label>
              <input
                type="text"
                value={config.business_location_url ?? ""}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    business_location_url: e.target.value,
                  })
                }
                placeholder="Ej: https://maps.google.com/?q=4.8,-75.7"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-400">
                Pega el link de Google Maps de tu local. El bot extrae las
                coordenadas automáticamente para calcular la distancia a cada
                cliente.
              </p>
              {config.business_location_url && (
                <p
                  className={`mt-1 text-xs font-medium ${
                    config.business_location_detected
                      ? "text-green-600"
                      : "text-amber-600"
                  }`}
                >
                  {config.business_location_detected
                    ? "✓ Ubicación detectada correctamente"
                    : "⚠️ No pudimos leer ese link. Probá con uno de Google Maps que tenga coordenadas (ej: https://maps.google.com/?q=4.8,-75.7) o compartiendo la ubicación desde la app de Maps"}
                </p>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Precio por kilómetro
              </label>
              <input
                type="number"
                min="0"
                value={config.price_per_km ?? ""}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    price_per_km:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                placeholder="Ej: 1000"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-400">
                Precio que se cobra por cada kilómetro de distancia entre tu
                local y la dirección del cliente. El bot calcula la ruta y
                multiplica por este valor.
              </p>
            </div>
            {/* max_delivery_km intencionalmente NO editable acá — es una
                variable de negocio sensible (radio de cobertura real) que
                maneja el super-admin directamente en la base, no el dueño
                del tenant. El campo se sigue cargando/guardando en el
                estado de este componente sin tocarlo, para no resetearlo
                a 15km por defecto cada vez que el tenant guarda otra cosa. */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Domicilio mínimo
              </label>
              <input
                type="number"
                min="0"
                value={config.min_delivery_price ?? ""}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    min_delivery_price:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                placeholder="Ej: 3000"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-400">
                Si el domicilio calculado por distancia sale menor a este
                valor, se cobra este valor en su lugar. Útil si un cliente
                queda muy cerca y el cálculo da un precio muy bajo para
                cubrir el costo real del domiciliario. Si lo dejás vacío, no
                hay mínimo (se cobra lo que dé el cálculo).
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Monto mínimo de pedido
              </label>
              <input
                type="number"
                min="0"
                value={config.min_order_amount ?? ""}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    min_order_amount:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                placeholder="Ej: 20000"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-400">
                Monto mínimo en productos (sin contar el domicilio) para poder
                confirmar el pedido. Si lo dejás vacío, no hay mínimo.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Precio fijo de domicilio (fallback)
              </label>
              <input
                type="number"
                min="0"
                value={config.delivery_price ?? ""}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    delivery_price:
                      e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                placeholder="Ej: 3000"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-400">
                Se usa cuando no se puede calcular la distancia por GPS (ej: el
                cliente manda una dirección que no se puede geocodificar).
              </p>
            </div>
          </div>
        </section>

        {/* Sección 6: Notificaciones */}
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
            Notificaciones de pedidos
          </h3>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Número administrativo (recibe pedidos)
              </label>
              <input
                type="text"
                value={config.admin_phone ?? ""}
                onChange={(e) =>
                  setConfig({ ...config, admin_phone: e.target.value })
                }
                placeholder="Ej: 573001234567"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-400">
                Número que recibe una notificación por WhatsApp cada vez que
                entra un pedido nuevo. Puede ser el mismo número del bot u otro.
              </p>
              {config.admin_phone && adminActivated === true && (
                <div className="mt-2 rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-xs text-green-800">
                  ✅ <strong>Activado.</strong> Este número ya puede recibir
                  notificaciones de pedidos nuevos.
                </div>
              )}
              {config.admin_phone && adminActivated === false && (
                <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                  <strong>⚠️ Falta activar.</strong> Para que las
                  notificaciones lleguen, este número tiene que escribirle
                  primero al bot (así evitamos que WhatsApp lo vea como un
                  mensaje no solicitado). Tocá el botón — abre WhatsApp con el
                  mensaje ya listo, solo hay que darle enviar desde{" "}
                  <strong>{config.admin_phone}</strong>.
                  {botPhone ? (
                    <div>
                      <a
                        href={`https://wa.me/${botPhone}?text=${encodeURIComponent(
                          "Hola, quiero activar las notificaciones de pedidos 🔔",
                        )}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-green-600 px-3 py-1.5 font-medium text-white hover:bg-green-700"
                      >
                        💬 Activar por WhatsApp
                      </a>
                    </div>
                  ) : (
                    <p className="mt-1.5 text-amber-700">
                      (El bot todavía no está conectado — conectalo primero
                      para poder generar el enlace de activación.)
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Sección 7: Pagos */}
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

        {/* Sección 8: Avanzado */}
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
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-60"
          >
            {saving && (
              <svg
                className="h-4 w-4 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                />
              </svg>
            )}
            {saving ? "Guardando..." : "Guardar configuración"}
          </button>
          {saved && (
            <p className="animate-fade-in mt-2 text-sm font-medium text-green-600">
              ✓ Configuración guardada exitosamente
            </p>
          )}
          {error && (
            <p className="mt-2 text-sm font-medium text-red-600">✗ {error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
