/**
 * Enseñarle al bot un lugar conocido (barrio, conjunto, punto de
 * referencia) que Nominatim/Photon no encuentran bien o que quedan fuera
 * del radio de búsqueda. Una vez cargado, `resolveDeliveryAddress()` lo
 * encuentra al instante por nombre exacto, LIKE o alias — sin llamar a
 * ningún geocoder externo.
 *
 * Uso interactivo:
 *   npx tsx scripts/add-known-place.ts
 *
 * Uso por flags (para scriptear varios de una):
 *   npx tsx scripts/add-known-place.ts \
 *     --tenant cookliz \
 *     --name "Guaduales del Otún" \
 *     --url "https://maps.google.com/?q=4.83,-75.68" \
 *     --aliases "guaduales,via frailes,guaduales del otun"
 *
 * También acepta --lat y --lng en vez de --url.
 */
import "./env-loader";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  getTenantBySlug,
  listTenants,
  upsertKnownPlace,
  findKnownPlace,
} from "../src/lib/db";
import { extractLatLngFromUrl } from "../src/lib/geo";

function parseFlags(argv: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "";
      flags[key] = val;
    }
  }
  return flags;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const rl = readline.createInterface({ input, output });

  const interactive = Object.keys(flags).length === 0;
  if (interactive) {
    console.log("\n=== Enseñar un lugar conocido al bot ===\n");
    const tenants = listTenants();
    console.log("Tenants disponibles:");
    for (const t of tenants) console.log(`  - ${t.slug} (id ${t.id}, ${t.name})`);
    console.log("");
  }

  const tenantSlug =
    flags.tenant || (await rl.question("Slug del tenant: ")).trim();
  const tenant = getTenantBySlug(tenantSlug);
  if (!tenant) {
    console.error(`No existe un tenant con slug "${tenantSlug}"`);
    rl.close();
    process.exit(1);
  }

  const name = (
    flags.name || (await rl.question("Nombre del lugar (ej: Guaduales del Otún): "))
  ).trim();
  if (!name) {
    console.error("El nombre es obligatorio");
    rl.close();
    process.exit(1);
  }

  let lat: number | undefined;
  let lng: number | undefined;

  if (flags.lat && flags.lng) {
    lat = Number(flags.lat);
    lng = Number(flags.lng);
  } else if (flags.url) {
    const coords = await extractLatLngFromUrl(flags.url);
    if (!coords) {
      console.error(`No pude extraer lat/lng de: ${flags.url}`);
      rl.close();
      process.exit(1);
    }
    lat = coords.lat;
    lng = coords.lng;
  } else {
    const mapsUrl = (
      await rl.question(
        "Link de Google Maps del lugar (o Enter para escribir lat/lng a mano): ",
      )
    ).trim();
    if (mapsUrl) {
      const coords = await extractLatLngFromUrl(mapsUrl);
      if (!coords) {
        console.error("No pude extraer coordenadas de ese link.");
        rl.close();
        process.exit(1);
      }
      lat = coords.lat;
      lng = coords.lng;
    } else {
      lat = Number((await rl.question("Latitud: ")).trim());
      lng = Number((await rl.question("Longitud: ")).trim());
    }
  }

  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
    console.error("Coordenadas inválidas.");
    rl.close();
    process.exit(1);
  }

  let aliases: string[] | undefined;
  const aliasesRaw =
    flags.aliases !== undefined
      ? flags.aliases
      : await rl.question(
          "Alias separados por coma (ej: guaduales,via frailes) [Enter para ninguno]: ",
        );
  if (aliasesRaw.trim()) {
    aliases = aliasesRaw
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
  }

  rl.close();

  const existing = findKnownPlace(tenant.id, name);
  upsertKnownPlace(tenant.id, name, lat, lng, aliases);

  console.log(
    `\n✅ ${existing ? "Actualizado" : "Creado"}: "${name}" (${lat}, ${lng}) para tenant "${tenant.name}"${
      aliases ? ` — alias: ${aliases.join(", ")}` : ""
    }\n`,
  );
  console.log(
    "El bot ya lo va a reconocer en el próximo mensaje que lo mencione, sin llamar a Nominatim/Photon.\n",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
