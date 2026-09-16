const path = require("node:path");
const mysql = require("mysql2/promise");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });

let pool;

function config() {
  const database = process.env.MYSQL_DATABASE || "securevote";
  if (!/^[a-zA-Z0-9_]{1,64}$/.test(database)) {
    throw new Error("MYSQL_DATABASE must contain only letters, numbers, or underscores (max 64)");
  }
  const port = Number(process.env.MYSQL_PORT || 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid MYSQL_PORT");
  return {
    host: process.env.MYSQL_HOST || "127.0.0.1", port,
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "", database,
    charset: "utf8mb4", timezone: "Z", connectTimeout: 5000,
  };
}

function getPool() {
  if (!pool) {
    pool = mysql.createPool({ ...config(), connectionLimit: 10, waitForConnections: true, queueLimit: 100 });
    // TIMESTAMP values and mysql2's date parsing must use the same time zone.
    pool.on("connection", connection => {
      connection.query("SET time_zone = '+00:00'", error => {
        if (error) connection.destroy();
      });
    });
  }
  return pool;
}

async function execute(sql, values = []) {
  const [rows] = await getPool().execute(sql, values);
  return rows;
}

async function isAvailable() {
  try {
    // Also detect an installation that has not run db:setup.
    await verifySchema();
    return true;
  } catch {
    return false;
  }
}

async function verifySchema() {
  await execute("SELECT u.id FROM users u LEFT JOIN elections e ON e.created_by = u.id LEFT JOIN candidates c ON c.election_id = e.id LEFT JOIN election_voters ev ON ev.election_id = e.id LIMIT 0");
  await execute("SELECT vc.voter_id FROM voting_credentials vc LEFT JOIN chain_transactions ct ON ct.election_id = vc.election_id LEFT JOIN chain_lock cl ON cl.id = 1 LIMIT 0");
  await execute("SELECT transaction_hash FROM chain_attempts LIMIT 0");
  await execute("SELECT id FROM audit_log LIMIT 0");
  await execute("SELECT election_id, version FROM election_banners LIMIT 0");
  await execute("SELECT candidate_id, short_name, symbol FROM party_details LIMIT 0");
  await execute("SELECT id FROM registered_parties LIMIT 0");
  await execute("SELECT id FROM candidate_roles LIMIT 0");
  await execute("SELECT id FROM registered_candidates LIMIT 0");
  await execute("SELECT candidate_id FROM election_party_snapshots LIMIT 0");
  await execute("SELECT party_id FROM party_accounts LIMIT 0");
  await execute("SELECT party_id FROM party_submissions LIMIT 0");
  await execute("SELECT party_id FROM party_candidate_roles LIMIT 0");
  await execute("SELECT party_id FROM party_candidates LIMIT 0");
  await execute("SELECT election_id FROM removed_elections LIMIT 0");
}

async function transaction(work) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const query = async (sql, values = []) => (await connection.execute(sql, values))[0];
    const result = await work(query);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function close() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

module.exports = { config, execute, isAvailable, verifySchema, transaction, close };
