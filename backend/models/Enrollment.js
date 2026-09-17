const { randomUUID, randomBytes, createHash } = require("node:crypto");
const database = require("../database");
const User = require("./User");
const Audit = require("./Audit");

const hashToken = token => createHash("sha256").update(token).digest("hex");
const validToken = token => typeof token === "string" && /^[a-f0-9]{64}$/.test(token);
function invitation() {
  return { token: randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) };
}

async function enroll({ fullName, email, institutionalId, isApproved }, actor) {
  const id = randomUUID();
  const activation = invitation();
  await database.transaction(async query => {
    // An empty hash cannot authenticate. Only activation sets a usable password.
    await query("INSERT INTO users (id, full_name, email, password_hash, role, is_approved) VALUES (?, ?, ?, '', 'voter', ?)", [id, fullName.trim(), email.trim().toLowerCase(), isApproved]);
    await query("INSERT INTO voter_enrollments (user_id, institutional_id, token_hash, expires_at) VALUES (?, ?, ?, ?)", [id, institutionalId.trim().toUpperCase(), hashToken(activation.token), activation.expiresAt]);
    await Audit.record(query, actor, "voter_registered_by_admin", id);
    if (isApproved) await Audit.record(query, actor, "voter_approved", id);
  });
  return { voter: await User.findById(id), activation };
}

async function reissue(id, actor) {
  const activation = invitation();
  const updated = await database.transaction(async query => {
    const result = await query("UPDATE voter_enrollments SET token_hash = ?, expires_at = ? WHERE user_id = ? AND activated_at IS NULL", [hashToken(activation.token), activation.expiresAt, id]);
    if (!result.affectedRows) return false;
    await Audit.record(query, actor, "voter_activation_reissued", id);
    return true;
  });
  return updated ? activation : null;
}

async function activate(token, passwordHash) {
  if (!validToken(token)) return null;
  return database.transaction(async query => {
    const [entry] = await query("SELECT user_id AS userId FROM voter_enrollments WHERE token_hash = ? AND activated_at IS NULL AND expires_at > UTC_TIMESTAMP(3) FOR UPDATE", [hashToken(token)]);
    if (!entry) return null;
    await query("UPDATE users SET password_hash = ? WHERE id = ? AND role = 'voter'", [passwordHash, entry.userId]);
    await query("UPDATE voter_enrollments SET token_hash = NULL, activated_at = UTC_TIMESTAMP(3) WHERE user_id = ?", [entry.userId]);
    await Audit.record(query, { id: entry.userId }, "voter_activated", entry.userId);
    // Activation never changes commission approval or election assignments.
    const [user] = await query("SELECT is_approved AS isApproved FROM users WHERE id = ?", [entry.userId]);
    return { isApproved: Boolean(user.isApproved) };
  });
}

module.exports = { enroll, reissue, activate, validToken };
