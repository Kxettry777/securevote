const database = require("./database");
const bcrypt = require("bcryptjs");
const app = require("./app");
const User = require("./models/User");

async function start() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET === "replace-with-a-long-random-secret") {
    throw new Error("Set JWT_SECRET in backend/.env");
  }
  await database.verifySchema();
  console.log("MySQL connected");
  await seedAdmin();
  const port = Number(process.env.PORT) || 5000;
  const server = app.listen(port, () => {
    console.log(`SecureVote API running on http://localhost:${port}`);
  });
  server.on("error", async error => {
    console.error("API listener failed:", error.code);
    await database.close();
    process.exitCode = 1;
  });
  const shutdown = () => server.close(async () => { await database.close(); });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  return server;
}

async function seedAdmin() {
  const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;

  if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.warn(
      "Admin seed skipped; ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD are required",
    );
    return;
  }

  const normalizedEmail = ADMIN_EMAIL.trim().toLowerCase();
  const existingAdmin = await User.findByEmail(normalizedEmail);

  if (existingAdmin) {
    return;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await User.create({
    fullName: ADMIN_NAME.trim(),
    email: normalizedEmail,
    passwordHash,
    role: "admin",
    isApproved: true,
  });
  console.log(`Initial admin created for ${normalizedEmail}`);
}


if (require.main === module) {
  start().catch(async error => {
    console.error("API startup failed:", error.code || error.message);
    console.error("Check backend/.env and run npm --prefix backend run db:setup.");
    await database.close();
    process.exitCode = 1;
  });
}

module.exports = { start, seedAdmin };
