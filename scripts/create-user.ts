import "./env-loader";
import bcrypt from "bcryptjs";
import { createUser, getUserByEmail, hasAnyUser } from "../src/lib/db";
import type { UserRole } from "../src/lib/db";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

async function main() {
  const rl = readline.createInterface({ input, output });

  console.log("\n=== Crear usuario ===\n");

  const email = (await rl.question("Email: ")).trim().toLowerCase();
  if (!email) {
    console.error("Email requerido");
    process.exit(1);
  }

  if (getUserByEmail(email)) {
    console.error(`Ya existe un usuario con email: ${email}`);
    process.exit(1);
  }

  const name = (await rl.question("Nombre: ")).trim() || email.split("@")[0];
  const password = await rl.question("Contraseña (mínimo 8 chars): ");
  if (password.length < 8) {
    console.error("Contraseña muy corta");
    process.exit(1);
  }

  const isFirstUser = !hasAnyUser();
  let role: UserRole = "OPERATOR";

  if (isFirstUser) {
    console.log("Primer usuario detectado → rol ADMIN automático");
    role = "ADMIN";
  } else {
    const roleInput = (
      await rl.question("Rol (ADMIN/OPERATOR/VIEWER) [OPERATOR]: ")
    )
      .trim()
      .toUpperCase();
    if (roleInput === "ADMIN" || roleInput === "VIEWER") {
      role = roleInput;
    }
  }

  rl.close();

  const hash = await bcrypt.hash(password, 10);
  const user = createUser(email, hash, name, role, 1);

  console.log(`\n✅ Usuario creado:`);
  console.log(`   ID:    ${user.id}`);
  console.log(`   Email: ${user.email}`);
  console.log(`   Nombre: ${user.name}`);
  console.log(`   Rol:   ${user.role}`);
  console.log(`   Tenant: ${user.tenant_id}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
