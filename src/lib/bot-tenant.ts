/**
 * Tenant ID asociado al proceso del bot.
 * Se lee de env y default = 1.
 * Archivo separado para evitar arrastrar next-auth al runtime del bot.
 */
export function getBotTenantId(): number {
  const raw = process.env.BOT_TENANT_ID;
  if (!raw) return 1;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : 1;
}
