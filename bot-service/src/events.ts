/**
 * Módulo de eventos para pedidos.
 * Usa la base de datos SQLite local del bot-service.
 */

import db, {
  type Order,
  type OrderItem,
  type CreateOrderInput,
} from "./db";

export type OrderEvent =
  | "ORDER_CREATED"
  | "ORDER_CONFIRMED"
  | "ORDER_CANCELLED"
  | "ORDER_PREPARING"
  | "ORDER_ON_THE_WAY"
  | "ORDER_DELIVERED";

export function emitOrderEvent(
  event: OrderEvent,
  order: Order & { items: OrderItem[] },
  previousStatus?: string,
): void {
  console.log(
    `[ORDER_EVENT] ${event}: Order ${order.id} for tenant ${order.tenant_id}`,
  );
}

export async function createOrder(
  input: CreateOrderInput,
): Promise<Order & { items: OrderItem[] }> {
  const transaction = db.transaction(() => {
    const orderResult = db
      .prepare(
        `INSERT INTO orders (tenant_id, customer_phone, customer_name, status, total_amount, notes, created_at, updated_at)
         VALUES (?, ?, ?, 'PENDING', 0, ?, unixepoch(), unixepoch())`,
      )
      .run(
        input.tenant_id,
        input.customer_phone,
        input.customer_name || null,
        input.notes || null,
      );

    const orderId = Number(orderResult.lastInsertRowid);
    let totalAmount = 0;
    const items: OrderItem[] = [];

    for (const item of input.items) {
      const totalPrice = item.quantity * item.unit_price;
      totalAmount += totalPrice;

      const itemResult = db
        .prepare(
          `INSERT INTO order_items (order_id, product_name, quantity, unit_price, total_price)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          orderId,
          item.product_name,
          item.quantity,
          item.unit_price,
          totalPrice,
        );

      items.push({
        id: Number(itemResult.lastInsertRowid),
        order_id: orderId,
        product_name: item.product_name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total_price: totalPrice,
      });
    }

    db.prepare(
      "UPDATE orders SET total_amount = ?, updated_at = unixepoch() WHERE id = ?",
    ).run(totalAmount, orderId);

    const order = db
      .prepare("SELECT * FROM orders WHERE id = ? AND tenant_id = ?")
      .get(orderId, input.tenant_id) as Order;
    if (!order) throw new Error("No se pudo crear el pedido");

    return { ...order, items };
  });

  const order = transaction();
  emitOrderEvent("ORDER_CREATED", order);
  return order;
}
