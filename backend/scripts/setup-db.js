const fs = require("node:fs/promises");
const path = require("node:path");
const mysql = require("mysql2/promise");
const { config } = require("../database");

async function setupDatabase() {
  const { database, ...connectionOptions } = config();
  const connection = await mysql.createConnection(connectionOptions);
  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci`);
    await connection.changeUser({ database });
    const directory = path.join(__dirname, "../sql");
    const files = (await fs.readdir(directory)).filter(file => /^\d+_.*\.sql$/.test(file)).sort();
    for (const file of files) {
      await connection.query(await fs.readFile(path.join(directory, file), "utf8"));
    }
    await require("./migrate-party-roles").migratePartyRoles(connection);
    console.log(`MySQL database ${database} is ready`);
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  setupDatabase().catch(error => {
    console.error("MySQL setup failed:", error.code || "configuration error");
    console.error("Check MYSQL_* settings in backend/.env and ensure the account can create the database and tables.");
    process.exitCode = 1;
  });
}

module.exports = { setupDatabase };
