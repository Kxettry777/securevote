const { randomUUID } = require("node:crypto");

// Copy legacy global definitions once, preserving nominee IDs and saved ballots.
// The transaction and migration marker make interrupted runs safe to retry.
async function migratePartyRoles(connection) {
  const migration = "party-specific-roles-v1";
  await connection.beginTransaction();
  try {
    const [existing] = await connection.execute("SELECT name FROM schema_migrations WHERE name = ? FOR UPDATE", [migration]);
    if (!existing.length) {
      const [parties] = await connection.execute("SELECT id FROM registered_parties ORDER BY id FOR UPDATE");
      const [roles] = await connection.execute("SELECT id, name, rank_order FROM candidate_roles ORDER BY rank_order");
      for (const party of parties) {
        for (const role of roles) {
          const roleId = randomUUID();
          await connection.execute("INSERT INTO party_candidate_roles (id, party_id, name, rank_order) VALUES (?, ?, ?, ?)", [roleId, party.id, role.name, role.rank_order]);
          await connection.execute(`INSERT INTO party_candidates (id, party_id, role_id, full_name, biography)
            SELECT id, party_id, ?, full_name, biography FROM registered_candidates WHERE party_id = ? AND role_id = ?`, [roleId, party.id, role.id]);
        }
      }
      await connection.execute("INSERT INTO schema_migrations (name) VALUES (?)", [migration]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
}
module.exports = { migratePartyRoles };
