# Importación Flexible de Excel

## Resumen

El sistema de importación de productos soporta **cualquier estructura de archivo Excel**, detectando automáticamente:

- **Fila de encabezados** (no asume fila 1)
- **Tipos de columnas** (nombre, descripción, precio, stock, variantes)
- **Múltiples hojas** (importación simultánea)
- **Variantes de producto** (ej: precios por tamaño, color, vehículo)
- **Múltiples formatos de número** (COP, USD, con/sin decimales)

## Arquitectura

### Archivos relacionados

```
src/lib/excel-parser.ts    # Parser inteligente
src/app/api/products/import/route.ts  # Endpoint de importación
src/lib/db.ts              # Esquema de productos con variantes
```

###Nuevas capacidades

#### 1. Detección automática de fila de headers

El parser busca automáticamente la fila que contiene los encabezados de columna, puede estar en cualquier posición (fila 1, 2, 3, etc.).

#### 2. Detección de tipos de columna

El sistema analiza cada columna y determina su tipo:

| Tipo | Descripción | Aliases reconocidos |
|------|-------------|-------------------|
| `name` | Nombre del producto | name, nombre, producto, servicio, item, articulo, etc. |
| `description` | Descripción del producto | descripcion, detalle, info, notas, etc. |
| `stock` | Cantidad en inventario | stock, cantidad, qty, existencia, etc. |
| `variant` | Precio de una variante | Cualquier columna con "precio" en el nombre + valores numéricos |
| `unknown` | Columna no identificada | Se usa como precio base si es numérica |

#### 3. Sistema de variantes

Cuando un Excel tiene **múltiples columnas de precio** (ej: "Automóvil", "Camioneta", "SUV"), el sistema:

1. Crea un **producto base** con el primer precio
2. Crea **variantes** con nombre y precio específico

**Ejemplo Excel:**
```
| Servicio      | Descripción | Automóvil | Camioneta | SUV |
|---------------|-------------|-----------|-----------|-----|
| Lavado Full   | Limpieza... | 50.000    | 70.000    | 90.000 |
```

**Resultado en BD:**
```
Producto: "Lavado Full"
- basePrice: 50000
- variants: [
    { name: "Automóvil", price: 50000 },
    { name: "Camioneta", price: 70000 },
    { name: "SUV", price: 90000 }
  ]
```

#### 4. Múltiples hojas

Si el Excel tiene varias hojas (ej: "Servicios Principales", "Servicios Detallados"), puedes:

- Importar una hoja específica
- Importar **todas** las hojas automáticamente

## API

### POST `/api/products/import`

**Headers:**
```
Content-Type: multipart/form-data
```

**Parámetros:**

| Campo | Tipo | Default | Descripción |
|-------|------|---------|-------------|
| `file` | File | **requerido** | Archivo Excel (.xlsx, .xls) |
| `mode` | string | `"merge"` | `"merge"` = actualiza existentes, `"replace"` = solo nuevos |
| `importAllSheets` | boolean | `false` | Si `true`, importa todas las hojas |
| `targetSheet` | string | primera hoja | Nombre de hoja a importar |
| `tenantId` | number | contexto actual | Tenant destino (solo superadmin) |

**Ejemplo de respuesta exitosa:**

```json
{
  "success": true,
  "total": 8,
  "created": 6,
  "updated": 2,
  "skipped": 0,
  "errors": [],
  "sheets": [
    {
      "sheetName": "Servicios Principales",
      "productsFound": 5,
      "headerRow": 1,
      "columns": [
        { "header": "Servicio", "type": "name" },
        { "header": "Descripción", "type": "description" },
        { "header": "Automóvil (COP)", "type": "variant", "variantLabel": "automóvil" },
        { "header": "Camioneta (COP)", "type": "variant", "variantLabel": "camioneta" },
        { "header": "Camioneta Grande (COP)", "type": "variant", "variantLabel": "camioneta grande" }
      ]
    },
    {
      "sheetName": "Servicios Detallados",
      "productsFound": 3,
      "headerRow": 1,
      "columns": [...]
    }
  ],
  "detectedArchitecture": "multiple_variants:automóvil,camioneta,camioneta grande"
}
```

### GET `/api/products/import?url=...`

Previsualiza un archivo Excel desde URL sin importarlo.

**Parámetros:**
- `url`: URL del archivo Excel

**Respuesta:**
```json
{
  "success": true,
  "preview": [
    {
      "sheetName": "Servicios Principales",
      "totalRows": 5,
      "headerRow": 1,
      "detectedArchitecture": "multiple_variants:automóvil,camioneta,camioneta grande",
      "columns": [...],
      "sampleProducts": [
        {
          "name": "Servicio Express",
          "description": "Lavado exterior con espuma...",
          "basePrice": 70000,
          "variants": [
            { "name": "automóvil", "price": 70000, "stock": 1 },
            { "name": "camioneta", "price": 90000, "stock": 1 },
            { "name": "camioneta grande", "price": 110000, "stock": 1 }
          ]
        }
      ]
    }
  ]
}
```

## Esquema de base de datos

### Campo `variants` en products

```sql
ALTER TABLE products ADD COLUMN variants TEXT;
-- JSON array: [{"name": "Automóvil", "price": 50000, "stock": 1}, ...]
```

### Tipo TypeScript

```typescript
interface ProductVariant {
  name: string;      // ej: "Automóvil", "Talla M", "Color Rojo"
  price: number;     // Precio de esta variante
  stock?: number;    // Stock específico (opcional)
}

interface Product {
  id: number;
  tenant_id: number;
  name: string;
  price: number;           // Precio base (primera variante o precio único)
  stock: number;
  active: number;
  description: string | null;
  variants: ProductVariant[] | null;  // null si no hay variantes
  created_at: number;
}
```

## Formatos de número soportados

El parser detecta y convierte automáticamente:

| Formato | Ejemplo input | Resultado |
|---------|---------------|-----------|
| COP con puntos | `$ 1.234.567` | `1234567` |
| COP con decimales | `$ 50.000,00` | `50000` |
| USD | `$99.99` | `99` |
| Solo número | `50000` | `50000` |
| Con moneda | `COP 100.000` | `100000` |
| Texto mixto | `Valor: $500` | `500` |

## Ejemplos de arquitecturas compatibles

### 1. Simple: Nombre + Precio

```
| Producto | Precio |
|----------|--------|
| Item A   | 10000  |
| Item B   | 20000  |
```

### 2. Con descripción

```
| Nombre | Descripción | Precio |
|--------|-------------|--------|
| Item A | Detalle... | 10000 |
```

### 3. Múltiples variantes (vehículos)

```
| Servicio | Automóvil | Camioneta | SUV |
|----------|-----------|-----------|-----|
| Lavado   | 50000     | 70000     | 90000 |
```

### 4. Headers en fila 2

```
| (vacío) | (vacío) | (vacío) |
| Nombre  | Precio  | Stock   |  <- header detectado
| Item A  | 10000   | 50      |
```

### 5. Múltiples hojas por categoría

```
Hoja 1: "Bebidas"
| Producto | Precio |
|----------|--------|
| Café     | 3000   |

Hoja 2: "Comidas"
| Producto | Precio |
|----------|--------|
| Arepa    | 5000   |

→ Importar ambas con importAllSheets=true
```

## Tips para usuarios

1. **¿El import no reconoce tu archivo?**
   - Asegúrate de que haya una fila de encabezados clara
   - Usa nombres como "Nombre", "Precio", "Descripción", "Stock"
   - El sistema es flexible con variaciones (ej: "nombre producto", "precio unitario")

2. **¿Tienes precios por tamaño/color/vehículo?**
   - Crea columnas con el sufijo (ej: "Precio M", "Precio G")
   - O usa el nombre de la variante (ej: "Automóvil", "Camioneta")
   - El sistema los detectará automáticamente

3. **¿Archivo muy grande con muchas hojas?**
   - Usa `importAllSheets=true` para importar todo de una vez
   - O especifica `targetSheet=nombre_exacto`

4. **¿Solo quieres productos nuevos?**
   - Usa `mode=replace` para saltar productos existentes

## Errores comunes

| Error | Causa | Solución |
|-------|-------|----------|
| `No se encontraron productos` | Headers no detectados | Verifica que la primera fila tenga nombres de columna |
| `Hoja no encontrada` | Nombre de hoja incorrecto | Usa GET para previsualizar y ver nombres exactos |
| `Precio 0 en todos` | Formato de número no reconocido | Usa formato simple: `50000` en vez de `$ 50.000 COP` |

## Ejemplo de uso con curl

```bash
# Importar archivo local
curl -X POST http://localhost:3000/api/products/import \
  -F "file=@productos.xlsx"

# Importar todas las hojas
curl -X POST http://localhost:3000/api/products/import \
  -F "file=@catalogo.xlsx" \
  -F "importAllSheets=true"

# Solo una hoja específica
curl -X POST http://localhost:3000/api/products/import \
  -F "file=@catalogo.xlsx" \
  -F "targetSheet=Servicios Principales"
```

## Futuras mejoras

- [ ] Detección automática de encoding (Latin-1, UTF-8)
- [ ] Soporte para archivos CSV
- [ ] Mapeo manual de columnas por el usuario
- [ ] Preview visual antes de importar
- [ ] Validación de datos con sugerencias de corrección
