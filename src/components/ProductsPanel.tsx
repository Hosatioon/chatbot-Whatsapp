"use client";

import { useEffect, useState } from "react";

interface ProductVariant {
  name: string;
  price: number;
  stock?: number;
}

interface Product {
  id: number;
  name: string;
  price: number;
  stock: number;
  active: number;
  description: string | null;
  variants: ProductVariant[] | null;
  created_at: number;
}

interface Props {
  selectedTenantId: number;
}

interface SheetInfo {
  sheetName: string;
  productsFound: number;
  headerRow: number;
  columns: { header: string; type: string; variantLabel?: string }[];
}

interface ImportResult {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; name: string; error: string }[];
  sheets: SheetInfo[];
  detectedArchitecture: string;
}

export default function ProductsPanel({ selectedTenantId }: Props) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingRow, setEditingRow] = useState<number | "new" | null>(null);
  const [form, setForm] = useState({
    name: "",
    price: 0,
    stock: 0,
    description: "",
  });
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    open: boolean;
    id: number | null;
    name: string;
  }>({ open: false, id: null, name: "" });

  const handleImport = async (file: File) => {
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mode", "merge");
      formData.append("tenantId", String(selectedTenantId));
      const res = await fetch("/api/products/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error || "Error al importar");
        return;
      }
      setImportResult(data);
      await fetchProducts();
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : "Error desconocido al importar",
      );
    } finally {
      setImporting(false);
    }
  };

  const fetchProducts = async () => {
    try {
      const qs = selectedTenantId > 0 ? `?tenantId=${selectedTenantId}` : "";
      const res = await fetch(`/api/products${qs}`);
      if (res.ok) {
        const data = await res.json();
        setProducts(data);
      }
    } catch (err) {
      console.error("Error cargando productos:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, [selectedTenantId]);

  const handleAdd = () => {
    setEditingRow("new");
    setForm({ name: "", price: 0, stock: 0, description: "" });
  };

  const handleEdit = (p: Product) => {
    setEditingRow(p.id);
    setForm({
      name: p.name,
      price: p.price,
      stock: p.stock,
      description: p.description ?? "",
    });
  };

  const handleCancel = () => {
    setEditingRow(null);
    setForm({ name: "", price: 0, stock: 0, description: "" });
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    try {
      const payload = {
        ...form,
        description: form.description.trim() || undefined,
        tenantId: selectedTenantId > 0 ? selectedTenantId : undefined,
      };
      if (editingRow === "new") {
        await fetch("/api/products", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else if (typeof editingRow === "number") {
        await fetch("/api/products", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editingRow, ...payload }),
        });
      }
      await fetchProducts();
      setEditingRow(null);
    } catch (err) {
      console.error("Error guardando producto:", err);
    }
  };

  const openDeleteModal = (id: number, name: string) => {
    setDeleteConfirm({ open: true, id, name });
  };

  const closeDeleteModal = () => {
    setDeleteConfirm({ open: false, id: null, name: "" });
  };

  const handleDelete = async () => {
    const id = deleteConfirm.id;
    if (!id) return;
    try {
      const tenantId = selectedTenantId > 0 ? selectedTenantId : undefined;
      const res = await fetch("/api/products", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, tenantId }),
      });
      if (!res.ok) {
        console.error("Error eliminando producto:", await res.text());
      }
      await fetchProducts();
    } catch (err) {
      console.error("Error eliminando producto:", err);
    } finally {
      closeDeleteModal();
    }
  };

  const handleToggle = async (id: number, current: number) => {
    try {
      const tenantId = selectedTenantId > 0 ? selectedTenantId : undefined;
      await fetch("/api/products", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, active: current === 0, tenantId }),
      });
      await fetchProducts();
    } catch (err) {
      console.error("Error toggling producto:", err);
    }
  };

  const formatPrice = (price: number) =>
    new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: "COP",
      minimumFractionDigits: 0,
    }).format(price);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-gray-500">
        Cargando productos...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Productos</h2>
        <div className="flex items-center gap-2">
          <label
            className={`cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 ${
              importing ? "pointer-events-none opacity-60" : ""
            }`}
          >
            {importing ? "Importando..." : "📥 Importar Excel/CSV"}
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              disabled={importing}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImport(file);
                e.target.value = ""; // permite re-subir el mismo archivo
              }}
            />
          </label>
          <button
            onClick={handleAdd}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            + Nuevo producto
          </button>
        </div>
      </div>

      {/* Banner de resultado de importación */}
      {importError && (
        <div className="flex items-start justify-between rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <div>
            <strong>Error:</strong> {importError}
          </div>
          <button
            onClick={() => setImportError(null)}
            className="ml-3 text-red-600 hover:text-red-800"
          >
            ✕
          </button>
        </div>
      )}
      {importResult && (
        <div className="flex items-start justify-between rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <div>
            <strong>Importación exitosa:</strong> {importResult.created}{" "}
            creados, {importResult.updated} actualizados de {importResult.total}{" "}
            filas.
            <div className="mt-1 text-xs text-emerald-700">
              Arquitectura detectada:{" "}
              <code className="mx-1 rounded bg-white px-1">
                {importResult.detectedArchitecture}
              </code>
              <div className="mt-1">
              {importResult.sheets.map((sheet, idx) => (
                <div key={idx} className="mt-1">
                  <span className="font-semibold">Hoja: {sheet.sheetName}</span> ({sheet.productsFound} productos)
                  <div className="ml-2">
                    Columnas: {sheet.columns.map((col, cidx) => (
                      <span key={cidx} className="mr-2">
                        <code className="rounded bg-white px-1">{col.header}</code>
                        <span className="text-gray-500 ml-1">({col.type})</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              </div>
            </div>
            {importResult.errors.length > 0 && (
              <div className="mt-2 text-xs text-red-700">
                {importResult.errors.length} filas con error:{" "}
                {importResult.errors
                  .slice(0, 3)
                  .map((e) => `Fila ${e.row} (${e.name})`)
                  .join(", ")}
                {importResult.errors.length > 3 && "..."}
              </div>
            )}
          </div>
          <button
            onClick={() => setImportResult(null)}
            className="ml-3 text-emerald-700 hover:text-emerald-900"
          >
            ✕
          </button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-700">
                Nombre
              </th>
              <th className="px-4 py-2 text-left font-medium text-gray-700">
                Descripción
              </th>
              <th className="px-4 py-2 text-right font-medium text-gray-700">
                Precio
              </th>
              <th className="px-4 py-2 text-right font-medium text-gray-700">
                Stock
              </th>
              <th className="px-4 py-2 text-center font-medium text-gray-700">
                Estado
              </th>
              <th className="px-4 py-2 text-center font-medium text-gray-700">
                Acciones
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {editingRow === "new" && (
              <tr className="bg-emerald-50">
                <td className="px-4 py-2">
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Nombre del producto"
                    className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    autoFocus
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="text"
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                    placeholder="Descripción"
                    className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="number"
                    value={form.price}
                    onChange={(e) =>
                      setForm({ ...form, price: Number(e.target.value) })
                    }
                    className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-right"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="number"
                    value={form.stock}
                    onChange={(e) =>
                      setForm({ ...form, stock: Number(e.target.value) })
                    }
                    className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-right"
                  />
                </td>
                <td className="px-4 py-2 text-center">
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                    Activo
                  </span>
                </td>
                <td className="px-4 py-2 text-center">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={handleSave}
                      className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700"
                    >
                      Guardar
                    </button>
                    <button
                      onClick={handleCancel}
                      className="rounded bg-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-400"
                    >
                      Cancelar
                    </button>
                  </div>
                </td>
              </tr>
            )}

            {products.map((p) =>
              editingRow === p.id ? (
                <tr key={p.id} className="bg-blue-50">
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) =>
                        setForm({ ...form, name: e.target.value })
                      }
                      className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                      autoFocus
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="text"
                      value={form.description}
                      onChange={(e) =>
                        setForm({ ...form, description: e.target.value })
                      }
                      placeholder="Descripción"
                      className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      value={form.price}
                      onChange={(e) =>
                        setForm({ ...form, price: Number(e.target.value) })
                      }
                      className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-right"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      value={form.stock}
                      onChange={(e) =>
                        setForm({ ...form, stock: Number(e.target.value) })
                      }
                      className="w-full rounded border border-gray-300 px-2 py-1 text-sm text-right"
                    />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        p.active
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {p.active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={handleSave}
                        className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
                      >
                        Guardar
                      </button>
                      <button
                        onClick={handleCancel}
                        className="rounded bg-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-400"
                      >
                        Cancelar
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr
                  key={p.id}
                  className={`hover:bg-gray-50 ${!p.active ? "opacity-50" : ""}`}
                >
                  <td className="px-4 py-2 font-medium text-slate-900">
                    {p.name}
                  </td>
                  <td
                    className="px-4 py-2 text-gray-600 max-w-xs truncate"
                    title={p.description ?? undefined}
                  >
                    {p.description || "—"}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-700">
                    {formatPrice(p.price)}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-700">
                    {p.stock}
                  </td>
                  <td className="px-4 py-2 text-center">
                    <button
                      onClick={() => handleToggle(p.id, p.active)}
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        p.active
                          ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                      title={
                        p.stock === 0 && !p.active
                          ? "Inactivo por stock 0"
                          : undefined
                      }
                    >
                      {p.active
                        ? "Activo"
                        : p.stock === 0
                          ? "Sin stock"
                          : "Inactivo"}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => handleEdit(p)}
                        className="rounded bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => openDeleteModal(p.id, p.name)}
                        className="rounded bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ),
            )}

            {products.length === 0 && editingRow !== "new" && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-sm text-gray-500"
                >
                  No hay productos. Agregá uno con el botón de arriba.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
        <strong>Nota:</strong> Los productos activos se envían automáticamente
        al bot de WhatsApp para que pueda informar precios y disponibilidad a
        los clientes.
      </div>

      {/* Modal de confirmación de eliminación */}
      {deleteConfirm.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3 className="mb-2 text-lg font-semibold text-gray-900">
              ¿Eliminar producto?
            </h3>
            <p className="mb-6 text-sm text-gray-600">
              Estás por eliminar <strong>{deleteConfirm.name}</strong>. Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={closeDeleteModal}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Sí, eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
