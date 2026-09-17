import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getOrderByViewToken, type OrderStatus } from "@/lib/db";

// Link "mágico" que se manda por WhatsApp al número de notificaciones junto
// con cada pedido nuevo. La seguridad viene del token en sí (impredecible,
// no un ID secuencial adivinable) — no hace falta sesión para verlo, así
// como no hace falta login para un link de "restablecer contraseña". Si
// quien lo abre YA tiene sesión iniciada en el panel, lo mandamos directo
// al módulo de Pedidos con este pedido abierto; si no, le mostramos acá
// mismo un resumen de solo lectura de ESE pedido y nada más del negocio.
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "Pendiente",
  CONFIRMED: "Confirmado",
  PREPARING: "Preparando",
  ON_THE_WAY: "En camino",
  DELIVERED: "Entregado",
  CANCELLED: "Cancelado",
};

export default async function PublicOrderPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const order = getOrderByViewToken(token);

  if (!order) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <div className="text-center text-gray-500">
          <p className="text-lg font-medium">Este link ya no es válido.</p>
          <p className="mt-1 text-sm">
            Puede que el pedido haya sido eliminado, o el link esté mal copiado.
          </p>
        </div>
      </div>
    );
  }

  const session = await auth();
  if (session?.user) {
    redirect(`/?view=orders&orderId=${order.id}`);
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-900">
            Pedido #{order.id}
          </h1>
          <span className="rounded-full border border-gray-200 bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
            {STATUS_LABELS[order.status]}
          </span>
        </div>

        <div className="space-y-1 border-t border-gray-100 pt-4 text-sm">
          {order.items.map((item) => (
            <div key={item.id} className="flex justify-between text-gray-700">
              <span>
                {item.quantity}x {item.product_name}
              </span>
              <span>${item.total_price.toLocaleString("es-CO")}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 flex justify-between border-t border-gray-100 pt-4 text-base font-semibold text-gray-900">
          <span>Total</span>
          <span>${order.total_amount.toLocaleString("es-CO")}</span>
        </div>

        <div className="mt-4 space-y-1 border-t border-gray-100 pt-4 text-sm text-gray-600">
          <p>
            <span className="font-medium text-gray-800">Cliente:</span>{" "}
            {order.customer_name || order.customer_phone}
          </p>
          {order.notes && (
            <p>
              <span className="font-medium text-gray-800">Entrega:</span>{" "}
              {order.notes}
            </p>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-gray-400">
          Iniciá sesión en el panel de OrdiFast para ver todos los pedidos.
        </p>
      </div>
    </div>
  );
}
