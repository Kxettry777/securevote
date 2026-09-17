const database = require("../database");

async function overview() {
  const [[voters], [parties], [elections]] = await Promise.all([
    database.execute(`SELECT COUNT(*) AS total, COALESCE(SUM(u.is_approved), 0) AS approved,
      COALESCE(SUM(NOT u.is_approved), 0) AS pendingApproval,
      COALESCE(SUM(v.user_id IS NOT NULL AND v.activated_at IS NULL), 0) AS pendingActivation
      FROM users u LEFT JOIN voter_enrollments v ON v.user_id = u.id WHERE u.role = 'voter'`),
    database.execute(`SELECT COUNT(*) AS total, COUNT(s.party_id) AS submitted
      FROM registered_parties p LEFT JOIN party_submissions s ON s.party_id = p.id
      WHERE NOT EXISTS (SELECT 1 FROM deleted_parties d WHERE d.party_id = p.id)`),
    database.execute(`SELECT COUNT(*) AS total,
      COALESCE(SUM(e.starts_at > UTC_TIMESTAMP(3)), 0) AS upcoming,
      COALESCE(SUM(e.starts_at <= UTC_TIMESTAMP(3) AND e.ends_at > UTC_TIMESTAMP(3)), 0) AS active,
      COALESCE(SUM(e.ends_at <= UTC_TIMESTAMP(3)), 0) AS ended
      FROM elections e WHERE NOT EXISTS (SELECT 1 FROM removed_elections r WHERE r.election_id = e.id)`),
  ]);
  const counts = row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
  return { voters: counts(voters), parties: counts(parties), elections: counts(elections) };
}

module.exports = { overview };
