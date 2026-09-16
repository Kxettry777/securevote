const database = require("../database");

// Administrative actions only. Never put ballot choices, credentials, or voter
// transaction references into the identity-linked administrative audit log.
async function record(query, actor, action, targetId, electionId = null) {
  if (!actor) return;
  await query("INSERT INTO audit_log (actor_id, action, target_id, election_id) VALUES (?, ?, ?, ?)", [actor.id, action, targetId, electionId]);
}
async function list(before) {
  const [latest] = await database.execute("SELECT CAST(MAX(id) AS CHAR) AS latestId FROM audit_log");
  const rows = await database.execute(`SELECT CAST(a.id AS CHAR) AS id, a.action, a.target_id AS targetId, a.election_id AS electionId,
    a.created_at AS createdAt, u.full_name AS actorName, e.title AS electionTitle
    FROM audit_log a JOIN users u ON u.id = a.actor_id LEFT JOIN elections e ON e.id = a.election_id
    WHERE a.id <= ? ${before ? "AND a.id < ?" : ""} ORDER BY a.id DESC LIMIT 51`, before ? [latest.latestId ?? "0", before] : [latest.latestId ?? "0"]);
  return { entries: rows.slice(0, 50), nextCursor: rows.length > 50 ? rows[49].id : null, latestId: latest.latestId };
}
async function remove(id) {
  const result = await database.execute("DELETE FROM audit_log WHERE id = ?", [id]);
  return result.affectedRows;
}
async function clear(throughId) {
  // Keep events written after the admin opened the confirmation screen.
  const result = await database.execute("DELETE FROM audit_log WHERE id <= ?", [throughId]);
  return result.affectedRows;
}
module.exports = { record, list, remove, clear };
