# Proyección Financiera — 12 Meses

> Proyección conservadora y realista. No incluye tu tiempo (costo de oportunidad), solo flujo de caja operativo.

## Supuestos Base

| Concepto | Valor |
|---|---|
| **Mix de planes** | 60% Starter ($49k) + 30% Pro ($75k) + 10% Business ($120k) |
| **Ingreso promedio/cliente/mes** | **~$64,000 COP** |
| **Setup fee** | $50,000 COP (único, primer mes) |
| **Churn mensual** | 8% (realista para SaaS nuevo en Colombia) |
| **Crecimiento** | Orgánico (boca a boca, redes), sin publicidad paga |

## Costos Operativos Reales (mensuales)

| Item | Mes 1-6 | Mes 7-12 | Notas |
|---|---|---|---|
| VPS (Hetzner CX22/CX23) | **$5 USD** (~$20k COP) | **$10-15 USD** | Upgrade a 15-25 clientes |
| OpenRouter (LLM) | **~$0.50 USD** | **~$2-4 USD** | Proporcional a chats |
| Dominio | **$0.83 USD** | **$0.83 USD** | $10/año |
| **Total costo operativo** | **~$6 USD** (~$24k COP) | **~$15 USD** (~$60k COP) |

> El LLM es casi gratis a este volumen. El costo real es **infraestructura + tu tiempo**.

## Escenario Base (mas probable)

Crecimiento orgánico neto (ya con cancelaciones):

| Mes | Clientes | Nuevos | Churn | Setup Fee | Recurrente | Ingreso Total | Costo | **Ganancia** |
|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | 0 | 0 | 0 | $0 | $0 | $0 | $24k | **-$24k** |
| 2 | 0 | 0 | 0 | $0 | $0 | $0 | $24k | **-$24k** |
| 3 | 1 | 1 | 0 | $50k | $64k | $114k | $24k | **+$90k** |
| 4 | 2 | 1 | 0 | $50k | $128k | $178k | $24k | **+$154k** |
| 5 | 3 | 1 | 0 | $50k | $192k | $242k | $24k | **+$218k** |
| 6 | 5 | 2 | 0 | $100k | $320k | $420k | $36k | **+$384k** |
| 7 | 7 | 2 | 0 | $100k | $448k | $548k | $48k | **+$500k** |
| 8 | 9 | 2 | 0 | $100k | $576k | $676k | $48k | **+$628k** |
| 9 | 11 | 2 | 0 | $100k | $704k | $804k | $48k | **+$756k** |
| 10 | 13 | 2 | 1 | $100k | $832k | $932k | $48k | **+$884k** |
| 11 | 15 | 2 | 1 | $100k | $960k | $1.06M | $48k | **+$1.01M** |
| 12 | 18 | 3 | 1 | $150k | $1.15M | $1.30M | $60k | **+$1.24M** |

### Acumulado al año

| | Valor |
|---|---|
| Ingreso total | **~$6.3M COP** |
| Costo total | **~$456k COP** |
| **Ganancia neta** | **~$5.8M COP** (~$1,450 USD) |

## Escenarios Comparativos (mes 12)

| | Pesimista | **Base** | Optimista |
|---|---|---|---|
| Clientes | 8 | 18 | 40 |
| Ingreso/mes | $512k | $1.15M | $2.56M |
| Costo/mes | $36k | $60k | $120k |
| **Ganancia/mes** | **$476k** | **$1.09M** | **$2.44M** |
| **Ganancia/año** | **~$2.5M** | **~$5.8M** | **~$15M** |

## Punto de Equilibrio

- **Por cliente**: Con $64k COP de ingreso y $1.5k COP de costo variable, el margen por cliente es **97.5%**.
- **Punto de equilibrio total**: **1 solo cliente pagando** ya cubre toda la infraestructura.
- **Con 3 clientes**: Ya estas ganando ~$168k COP/mes limpio.

## Lo que NO esta incluido (costo real)

| Item | Estimacion | Nota |
|---|---|---|
| **Tu tiempo** | 8-15 hrs/semana | Si lo valuas a $15k/hora = $480k-900k COP/mes |
| **Marketing** | $0 en esta proyeccion | Publicidad paga podria acelerar 2-3x |
| **Soporte** | Tiempo + posible pago a alguien | A 20+ clientes necesitaras ayuda |
| **Impuestos** | ~19% renta (Colombia) | Sobre ganancias si formalizas |
| **Pasarela de pago** | ~3.5% por transaccion | Wompi/Stripe |

## Realidad honesta

A 18 clientes en un ano ($1.15M COP/mes = ~$287 USD/mes), estas ganando bien para un side project colombiano, pero **no es un sueldo completo todavia**. Para vivir de esto necesitarias:

- **40-50 clientes** → ~$2.5-3.2M COP/mes (un sueldo junior/intermedio en Colombia)
- **80-100 clientes** → ~$5-6.4M COP/mes (un buen sueldo senior)

El cuello de botella no es tecnico (la infra aguanta 100+ clientes facil), es **adquisicion de clientes**.

---

# Baileys vs WhatsApp Business API — Analisis de Migracion

> Analisis honesto de si conviene migrar de Baileys a la API oficial de WhatsApp.

## Baileys (actual)

| Ventajas | Desventajas |
|---|---|
| **$0 por mensaje** | No es oficial — riesgo de ban del numero |
| Cualquier numero de WhatsApp funciona | Sin botones interactivos nativos |
| Setup en 5 minutos | Sin catalogo oficial de WhatsApp Business |
| Sin verificacion de Meta | Sin verificacion verde (sello de confianza) |
| Sin reglas de 24h window | Menos confiable (reconexiones, errores de session) |
| El cliente no sabe que es "no oficial" | Sin soporte oficial de Meta |

## WhatsApp Business API (oficial)

| Ventajas | Desventajas |
|---|---|
| 100% seguro contra bans (uso correcto) | **Costo por conversacion: $0.005-0.05 USD/msg** |
| Botones interactivos, catalogo nativo | Requiere verificacion de negocio por Meta |
| Verificacion verde (sello de confianza) | Setup complejo (BSP o Meta Cloud API) |
| Webhooks confiables | Regla estricta: 24h window para iniciar conversaciones |
| Plantillas aprobadas por Meta | Plantillas deben ser aprobadas antes de usar |
| Soporte oficial de Meta | Mensajes que inicia el negocio: **$0.008-0.074 USD cada uno** |

## Impacto en el modelo de negocio

### Costo con API oficial (50 chats/dia × 30 dias = 1,500 conversaciones/mes)

| Modelo de precio WABA | Costo/mes | Impacto |
|---|---|---|
| Conversaciones iniciadas por usuario: ~$0.005 USD | **~$7.50 USD** (~$30k COP) | Aun viable |
| Conversaciones iniciadas por negocio: ~$0.05 USD | **~$75 USD** (~$300k COP) | **Destruye el margen** |
| Mix real (80% usuarios + 20% templates) | **~$22 USD** (~$88k COP) | Margen reduce del 97% al ~85% |

> El costo por mensaje **no es el asesino**. El problema es que tu modelo actual se basa en responder a quien te contacta primero (barato). Pero si necesitas enviar campañas o recordatorios, cada template cuesta y debe ser aprobado.

## Cuando migrar

| Fase | Clientes | Recomendacion |
|---|---|---|
| **Ahora** | 1 | Quedarse en Baileys. El riesgo de ban a 50 chats/dia es practicamente nulo. |
| **Crecimiento** | 10-30 | Seguir en Baileys. Monitorear si algun cliente reporta problemas. |
| **Evaluar** | 30-50 | Ofrecer **plan Business con WABA opcional** para clientes grandes que lo pidan. |
| **Migrar** | 50+ | Migrar los clientes que exijan funciones avanzadas (botones, verificacion verde). |

## Alternativas intermedias

| Opcion | Costo | Ideal para |
|---|---|---|
| **Seguir en Baileys** | $0/msg | Todos los clientes actuales |
| **WhatsApp Business App** (app movil) | Gratis | Tu mismo numero, sin API |
| **WABA con BSP colombiano** (Twilio, etc.) | ~$0.005-0.05/msg | Clientes enterprise que lo exijan |
| **Dual: Baileys + WABA** | Mix | Baileys para 80% de clientes, WABA solo para Business |

## Mi recomendacion

**No migres todavia.** Baileys funciona perfecto para el volumen y precios actuales. Migrar a WABA ahora:

- Aumentaria costos un **400-1,000%** (de ~$1 USD/mes a ~$7-75 USD/mes por tenant)
- Destruiría tu ventaja competitiva (precios de $49-75k COP se verian afectados)
- Es complejo y lento (verificacion Meta puede tardar semanas)

**Cuando SI migrar:**

1. Alguien te banea un numero importante
2. Un cliente grande (farmacia, supermercado) **exige** verificacion verde
3. Necesitas funciones que solo WABA tiene (botones de pago, catalogo nativo)
4. Tienes 50+ clientes y el riesgo acumulado de bans supera el costo de WABA

**Estrategia recomendada:** Mantener Baileys como default. Cuando un cliente pida "oficial", ofrecer el **plan Business a $120k COP/mes** y absorber el costo de WABA dentro de ese precio (margen aun viable).

## Timeline sugerido

| Etapa | Cuando | Accion |
|---|---|---|
| **Fase 1** | Mes 1-6 | Baileys puro. Enfocarse en conseguir clientes. |
| **Fase 2** | Mes 6-9 | Evaluar si algun cliente pide funciones WABA. |
| **Fase 3** | Mes 9-12 | Si hay demanda, crear plan "Enterprise con WABA" a precio premium. |
| **Fase 4** | Ano 2 | Migrar solo clientes que lo paguen. 80% sigue en Baileys. |

> La regla de oro: **no arregles lo que no esta roto**. Baileys no es ideal, pero para un SaaS de $49-75k COP/mes en Colombia, es la unica forma de mantener margenes del 90%+.
