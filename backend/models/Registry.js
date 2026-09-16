const { randomUUID } = require("node:crypto");
const database = require("../database");
const Audit = require("./Audit");
const { ElectionError } = require("./Election");

const imageUrl = buffer => `data:image/webp;base64,${buffer.toString("base64")}`;
async function ownedParty(actor, query = database.execute) {
  const [row] = await query("SELECT party_id AS partyId FROM party_accounts WHERE user_id = ?", [actor.id]);
  if (!row) throw new ElectionError(403, "Your account is not linked to a registered party");
  return row.partyId;
}
async function list(actor) {
  const partyId = actor.role === "party" ? await ownedParty(actor) : null;
  const parties = await database.execute(`SELECT p.id, p.name, p.short_name AS shortName, p.symbol, p.symbol_image AS symbolImage, p.manifesto,
    u.email AS accountEmail, s.submitted_at AS submittedAt
    FROM registered_parties p LEFT JOIN party_accounts a ON a.party_id = p.id LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN party_submissions s ON s.party_id = p.id ${partyId ? "WHERE p.id = ?" : ""} ORDER BY p.name, p.id`, partyId ? [partyId] : []);
  const roles = await database.execute(`SELECT id, party_id AS partyId, name, rank_order AS \`rank\` FROM party_candidate_roles ${partyId ? "WHERE party_id = ?" : ""} ORDER BY rank_order, id`, partyId ? [partyId] : []);
  const candidates = await database.execute(`SELECT c.id, c.party_id AS partyId, c.role_id AS roleId, c.full_name AS fullName, c.biography,
    r.name AS roleName, r.rank_order AS \`rank\` FROM party_candidates c JOIN party_candidate_roles r ON r.id = c.role_id
    ${partyId ? "WHERE c.party_id = ?" : ""} ORDER BY r.rank_order, c.full_name, c.id`, partyId ? [partyId] : []);
  return { parties: parties.map(p => ({ ...p, symbolImage: imageUrl(p.symbolImage), candidates: candidates.filter(c => c.partyId === p.id), roles: roles.filter(r => r.partyId === p.id) })), roles, candidates };
}
async function saveParty(id, data, actor) {
  const target = id || randomUUID();
  await database.transaction(async query => {
    if (id) {
      const [party] = await query("SELECT id FROM registered_parties WHERE id = ? FOR UPDATE", [id]);
      if (!party) throw new ElectionError(404, "Registered party not found");
      await query(`UPDATE registered_parties SET name = ?, short_name = ?, symbol = ?, manifesto = ?${data.symbolImage ? ", symbol_image = ?" : ""} WHERE id = ?`,
        [data.name, data.shortName, data.symbol, data.manifesto, ...(data.symbolImage ? [data.symbolImage] : []), id]);
    } else {
      if (!data.symbolImage) throw new ElectionError(400, "Upload an election symbol to register this party");
      await query("INSERT INTO registered_parties (id, name, short_name, symbol, manifesto, symbol_image) VALUES (?, ?, ?, ?, ?, ?)", [target, data.name, data.shortName, data.symbol, data.manifesto, data.symbolImage]);
      const userId = randomUUID();
      await query("INSERT INTO users (id, full_name, email, password_hash, role, is_approved) VALUES (?, ?, ?, ?, 'party', TRUE)", [userId, data.name.slice(0, 80), data.email, data.passwordHash]);
      await query("INSERT INTO party_accounts (party_id, user_id) VALUES (?, ?)", [target, userId]);
      for (const [index, name] of ["President", "Vice president", "Secretary"].entries()) {
        await query("INSERT INTO party_candidate_roles (id, party_id, name, rank_order) VALUES (?, ?, ?, ?)", [randomUUID(), target, name, index + 1]);
      }
    }
    await query("DELETE FROM party_submissions WHERE party_id = ?", [target]);
    await Audit.record(query, actor, id ? "party_registration_updated" : "party_registered", target);
  });
  return { id: target };
}
async function saveRole(id, data, actor) {
  const target = id || randomUUID();
  await database.transaction(async query => {
    const [party] = await query("SELECT id FROM registered_parties WHERE id = ? FOR UPDATE", [data.partyId]);
    if (!party) throw new ElectionError(404, "Registered party not found");
    if (id) {
      const result = await query("UPDATE party_candidate_roles SET name = ?, rank_order = ? WHERE id = ? AND party_id = ?", [data.name, data.rank, id, data.partyId]);
      if (!result.affectedRows) throw new ElectionError(404, "Role not found");
    } else await query("INSERT INTO party_candidate_roles (id, party_id, name, rank_order) VALUES (?, ?, ?, ?)", [target, data.partyId, data.name, data.rank]);
    await query("DELETE FROM party_submissions WHERE party_id = ?", [data.partyId]);
    await Audit.record(query, actor, id ? "candidate_role_updated" : "candidate_role_created", target);
  });
  return { id: target };
}
async function saveCandidate(id, data, actor) {
  const target = id || randomUUID();
  await database.transaction(async query => {
    const partyId = await ownedParty(actor, query);
    if (partyId !== data.partyId) throw new ElectionError(403, "You can nominate candidates only for your own party");
    // Serialize roster edits with election snapshots using the party lock.
    const [party] = await query("SELECT id FROM registered_parties WHERE id = ? FOR UPDATE", [data.partyId]);
    if (!party) throw new ElectionError(400, "Choose a registered party");
    const [role] = await query("SELECT id FROM party_candidate_roles WHERE id = ? AND party_id = ? FOR SHARE", [data.roleId, data.partyId]);
    if (!role) throw new ElectionError(400, "Choose a candidate role");
    if (id) {
      const result = await query("UPDATE party_candidates SET role_id = ?, full_name = ?, biography = ? WHERE id = ? AND party_id = ?", [data.roleId, data.fullName, data.biography, id, data.partyId]);
      if (!result.affectedRows) throw new ElectionError(404, "Candidate not found in this party");
    } else await query("INSERT INTO party_candidates (id, party_id, role_id, full_name, biography) VALUES (?, ?, ?, ?, ?)", [target, data.partyId, data.roleId, data.fullName, data.biography]);
    await query("DELETE FROM party_submissions WHERE party_id = ?", [data.partyId]);
    await Audit.record(query, actor, id ? "registered_candidate_updated" : "candidate_registered", target);
  });
  return { id: target };
}
async function removeCandidate(id, actor) {
  await database.transaction(async query => {
    const partyId = await ownedParty(actor, query);
    const [candidate] = await query("SELECT party_id FROM party_candidates WHERE id = ?", [id]);
    if (!candidate || candidate.party_id !== partyId) throw new ElectionError(404, "Candidate not found in your party");
    await query("SELECT id FROM registered_parties WHERE id = ? FOR UPDATE", [candidate.party_id]);
    const result = await query("DELETE FROM party_candidates WHERE id = ?", [id]);
    if (!result.affectedRows) throw new ElectionError(404, "Candidate not found");
    await query("DELETE FROM party_submissions WHERE party_id = ?", [partyId]);
    await Audit.record(query, actor, "registered_candidate_removed", id);
  });
}
async function snapshot(query, electionId, partyIds) {
  // Stable lock order also supports concurrent election preparation.
  for (const partyId of [...partyIds].sort()) {
    const [party] = await query("SELECT * FROM registered_parties WHERE id = ? FOR UPDATE", [partyId]);
    if (!party) throw new ElectionError(400, "One of the selected parties is not registered");
    const roles = await query("SELECT id FROM party_candidate_roles WHERE party_id = ? ORDER BY id FOR SHARE", [partyId]);
    const [submission] = await query("SELECT party_id FROM party_submissions WHERE party_id = ? FOR SHARE", [partyId]);
    if (!submission) throw new ElectionError(409, `${party.name} must submit its candidate roster before election creation`);
    const roster = await query(`SELECT c.id, c.full_name AS fullName, c.biography, r.name AS roleName, r.rank_order AS \`rank\`
      FROM party_candidates c JOIN party_candidate_roles r ON r.id = c.role_id WHERE c.party_id = ? ORDER BY r.rank_order, c.id FOR SHARE`, [partyId]);
    if (!roles.length || roster.length !== roles.length) throw new ElectionError(409, `${party.name} needs one candidate for every role`);
    const id = randomUUID();
    await query("INSERT INTO candidates (id, election_id, name, manifesto) VALUES (?, ?, ?, ?)", [id, electionId, party.name, party.manifesto]);
    await query("INSERT INTO party_details (candidate_id, short_name, symbol) VALUES (?, ?, ?)", [id, party.short_name, party.symbol]);
    await query("INSERT INTO election_party_snapshots (candidate_id, party_id, symbol_image, roster) VALUES (?, ?, ?, ?)", [id, partyId, party.symbol_image, JSON.stringify(roster)]);
  }
}
async function submit(actor) {
  const partyId = await ownedParty(actor);
  await database.transaction(async query => {
    await query("SELECT id FROM registered_parties WHERE id = ? FOR UPDATE", [partyId]);
    const roles = await query("SELECT id FROM party_candidate_roles WHERE party_id = ? ORDER BY id FOR SHARE", [partyId]);
    const candidates = await query("SELECT id FROM party_candidates WHERE party_id = ? FOR SHARE", [partyId]);
    if (!roles.length || candidates.length !== roles.length) throw new ElectionError(409, "Nominate one candidate for every role before submitting your roster");
    await query("INSERT INTO party_submissions (party_id) VALUES (?) ON DUPLICATE KEY UPDATE submitted_at = CURRENT_TIMESTAMP(3)", [partyId]);
    await Audit.record(query, actor, "party_roster_submitted", partyId);
  });
}
module.exports = { list, saveParty, saveRole, saveCandidate, removeCandidate, submit, snapshot, imageUrl };
