"use client";

import { useEffect, useState } from "react";

interface TenantConfig {
  business_name: string | null;
  business_type: string | null;
  payment_info: string | null;
  custom_greeting: string | null;
  custom_prompt: string | null;
}

export default function ConfigPanel() {
  const [config, setConfig] = useState<TenantConfig>({
    business_name: "",
    business_type: "",
    payment_info: "",
    custom_greeting: "",
    custom_prompt: "",
  });
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
      const data = (await res.json()) as TenantConfig;
      setConfig({
        business_name: data.business_name ?? "",
        business_type: data.business_type ?? "",
        payment_info: data.payment_info ?? "",
        custom_greeting: data.custom_greeting ?? "",
        custom_prompt: data.custom_prompt ?? "",
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
        setError("Error al guardar");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Error de conexión");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        Cargando configuración...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h2 className="mb-1 text-xl font-semibold text-gray-900">
        Configuración del negocio
      </h2>
      <p className="mb-6 text-sm text-gray-500">
        Personaliza cómo el bot atiende a tus clientes. Estos datos se usan
        para generar las respuestas del asistente de IA.
      </p>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {saved && (
        <div className="mb-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700">
          Configuración guardada correctamente.
        </div>
      )}

      <div className="space-y-5">
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
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">
            El bot dirá "Eres el asistente de [este nombre]"
          </p>
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
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">
            El bot ajustará su tono según el tipo de negocio
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
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">
            Mensaje que el bot envía cuando alguien escribe por primera vez
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Información de pago
          </label>
          <textarea
            value={config.payment_info ?? ""}
            onChange={(e) =>
              setConfig({ ...config, payment_info: e.target.value })
            }
            placeholder={
              "Ej: Transferencia: 3225669765 (Nequi y Daviplata). Pedir comprobante. Efectivo: confirmar monto exacto."
            }
            rows={3}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">
            Número de cuenta, métodos aceptados, instrucciones de pago
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            Instrucciones personalizadas (avanzado)
          </label>
          <textarea
            value={config.custom_prompt ?? ""}
            onChange={(e) =>
              setConfig({ ...config, custom_prompt: e.target.value })
            }
            placeholder={
              "Ej: Solo atendemos delivery de 9am a 6pm. No aceptamos pedidos para otro día."
            }
            rows={4}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
          <p className="mt-1 text-xs text-gray-400">
            Reglas adicionales que el bot debe seguir (opcional)
          </p>
        </div>

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
