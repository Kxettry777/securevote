const { randomUUID } = require("node:crypto");
const database = require("../database");
const Audit = require("./Audit");

const publicColumns = "id, full_name AS fullName, email, role, is_approved AS isApproved, created_at AS createdAt, updated_at AS updatedAt";

function toUser(row) {
  return row ? { ...row, isApproved: Boolean(row.isApproved) } : null;
}

function isValidId(id) {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

async function findByEmail(email) {
  const rows = await database.execute(`SELECT ${publicColumns}, password_hash AS passwordHash FROM users WHERE email = ?`, [email]);
  return toUser(rows[0]);
}

async function findById(id) {
  const rows = await database.execute(`SELECT ${publicColumns} FROM users WHERE id = ?`, [id]);
  return toUser(rows[0]);
}

async function create({ fullName, email, passwordHash, role = "voter", isApproved = false }) {
  const id = randomUUID();
  await database.execute(
    "INSERT INTO users (id, full_name, email, password_hash, role, is_approved) VALUES (?, ?, ?, ?, ?, ?)",
    [id, fullName.trim(), email.trim().toLowerCase(), passwordHash, role, isApproved],
  );
  return findById(id);
}

async function listVoters() {
  const rows = await database.execute(`SELECT ${publicColumns} FROM users WHERE role = ? ORDER BY created_at DESC, id`, ["voter"]);
  return rows.map(toUser);
}

async function registerVoter({ fullName, email, passwordHash, isApproved }, actor) {
  const id = randomUUID();
  await database.transaction(async query => {
    await query("INSERT INTO users (id, full_name, email, password_hash, role, is_approved) VALUES (?, ?, ?, ?, 'voter', ?)", [id, fullName.trim(), email.trim().toLowerCase(), passwordHash, isApproved]);
    await Audit.record(query, actor, "voter_registered_by_admin", id);
    if (isApproved) await Audit.record(query, actor, "voter_approved", id);
  });
  return findById(id);
}

async function setVoterApproval(id, isApproved, actor) {
  return database.transaction(async query => {
    const [existing] = await query("SELECT is_approved AS isApproved FROM users WHERE id = ? AND role = 'voter' FOR UPDATE", [id]);
    if (!existing) return null;
    await query("UPDATE users SET is_approved = ? WHERE id = ?", [isApproved, id]);
    if (Boolean(existing.isApproved) !== isApproved) await Audit.record(query, actor, isApproved ? "voter_approved" : "voter_revoked", id);
    const [row] = await query(`SELECT ${publicColumns} FROM users WHERE id = ?`, [id]);
    return toUser(row);
  });
}

module.exports = { isValidId, findByEmail, findById, create, listVoters, setVoterApproval, registerVoter };
