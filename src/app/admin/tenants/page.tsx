"use client";

import { useEffect, useState } from "react";

interface Tenant {
  id: number;
  name: string;
  slug: string;
  created_at: number;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quitar tildes
    .replace(/[^a-z0-9]+/g, "-") // espacios/símbolos → guion
    .replace(/^-+|-+$/g, "") // trim guiones
    .replace(/-+/g, "-"); // guiones duplicados
}

export default function TenantsAdminPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [createAdmin, setCreateAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    const res = await fetch("/api/tenants");
    if (res.status === 403) {
      setError("Solo ADMIN puede ver esta página");
      return;
    }
    if (!res.ok) {
      setError("Error cargando tenants");
      return;
    }
    setTenants(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const autoSlug = slugify(name) || slugify(slug);
    const body: Record<string, unknown> = { name, slug: autoSlug };
    if (createAdmin) {
      body.adminName = adminName;
      body.adminEmail = adminEmail;
      body.adminPassword = adminPassword;
    }
    const res = await fetch("/api/tenants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setLoading(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? "Error creando tenant");
      return;
    }
    setName("");
    setSlug("");
    setAdminName("");
    setAdminEmail("");
    setAdminPassword("");
    setCreateAdmin(false);
    load();
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-8">
      <div className="max-w-3xl mx-auto">
        <a
          href="/"
          className="text-emerald-400 text-sm hover:underline mb-4 inline-block"
        >
          ← Volver al dashboard
        </a>
        <h1 className="text-2xl font-bold mb-6">Tenants</h1>

        <form
          onSubmit={handleCreate}
          className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-8 grid sm:grid-cols-3 gap-3 items-end"
        >
          <div>
            <label className="block text-xs text-zinc-400 mb-1">
              Nombre del negocio
            </label>
            <input
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSlug(slugify(e.target.value));
              }}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm"
              placeholder="Cookliz"
            />
            {slug && (
              <p className="text-xs text-zinc-500 mt-1">
                Slug generado:{" "}
                <span className="font-mono text-zinc-400">{slug}</span>
              </p>
            )}
          </div>
          <button
            type="submit"
            disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 px-4 py-2 rounded font-medium text-sm sm:col-span-3"
          >
            {loading ? "Creando..." : "Crear tenant"}
          </button>

          <div className="flex items-center gap-2 sm:col-span-3">
            <input
              type="checkbox"
              id="createAdmin"
              checked={createAdmin}
              onChange={(e) => setCreateAdmin(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-600 bg-zinc-800 text-emerald-600"
            />
            <label htmlFor="createAdmin" className="text-sm text-zinc-300">
              Crear usuario administrador para este tenant
            </label>
          </div>

          {createAdmin && (
            <>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  Nombre del admin
                </label>
                <input
                  required={createAdmin}
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm"
                  placeholder="Juan Pérez"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  Email del admin
                </label>
                <input
                  type="email"
                  required={createAdmin}
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm"
                  placeholder="admin@negocio.com"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">
                  Contraseña (min 6)
                </label>
                <input
                  type="password"
                  required={createAdmin}
                  minLength={6}
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm"
                  placeholder="••••••"
                />
              </div>
            </>
          )}
        </form>

        {error && (
          <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-4">
            {error}
          </div>
        )}

        <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-800 text-zinc-400">
              <tr>
                <th className="text-left px-4 py-2">ID</th>
                <th className="text-left px-4 py-2">Nombre</th>
                <th className="text-left px-4 py-2">Slug</th>
                <th className="text-left px-4 py-2">Creado</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-t border-zinc-800">
                  <td className="px-4 py-2 font-mono">{t.id}</td>
                  <td className="px-4 py-2">{t.name}</td>
                  <td className="px-4 py-2 font-mono text-zinc-400">
                    {t.slug}
                  </td>
                  <td className="px-4 py-2 text-zinc-500">
                    {new Date(t.created_at * 1000).toLocaleString()}
                  </td>
                </tr>
              ))}
              {tenants.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-6 text-center text-zinc-500"
                  >
                    Sin tenants
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-zinc-500 mt-6">
          Tip: marcá Crear usuario administrador para que el tenant pueda
          iniciar sesión inmediatamente. También podés agregar usuarios después
          con el script{" "}
          <code className="bg-zinc-800 px-1.5 py-0.5 rounded">create-user</code>
          .
        </p>
      </div>
    </div>
  );
}
