const { randomUUID, createHash } = require("node:crypto");
const database = require("../database");
const Audit = require("./Audit");

class ElectionError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const columns = `e.id, e.title, e.description, e.starts_at AS startsAt, e.ends_at AS endsAt,
  e.created_at AS createdAt,
  UTC_TIMESTAMP(3) AS serverTime,
  (SELECT b.version FROM election_banners b WHERE b.election_id = e.id) AS bannerVersion,
  CASE WHEN UTC_TIMESTAMP(3) < e.starts_at THEN 'upcoming'
       WHEN UTC_TIMESTAMP(3) < e.ends_at THEN 'active' ELSE 'ended' END AS status,
  (SELECT COUNT(*) FROM candidates c WHERE c.election_id = e.id) AS candidateCount`;

function scope(actor) {
  // Keep legacy removals hidden until the one-time permanent cleanup is run.
  const visible = " AND NOT EXISTS (SELECT 1 FROM removed_elections r WHERE r.election_id = e.id)";
  return visible + (actor.role !== "voter" ? "" : " AND EXISTS (SELECT 1 FROM election_voters ev WHERE ev.election_id = e.id AND ev.voter_id = ?)");
}

async function list(actor) {
  const rows = await database.execute(`SELECT ${columns} FROM elections e WHERE 1 = 1 ${scope(actor)} ORDER BY e.starts_at DESC, e.id`, actor.role !== "voter" ? [] : [actor.id]);
  return rows.map(election => ({ ...election, partyCount: election.candidateCount }));
}

async function remove(id, actor) {
  await database.transaction(async query => {
    const [election] = await query("SELECT ends_at AS endsAt FROM elections WHERE id = ? FOR UPDATE", [id]);
    if (!election) throw new ElectionError(404, "Election not found");
    const [clock] = await query("SELECT UTC_TIMESTAMP(3) AS now");
    if (election.endsAt > clock.now) throw new ElectionError(409, "Only ended elections can be deleted");
    // Match the election -> chain lock order used by voting. Never discard
    // signed transactions awaiting recovery, or race the relayer's nonce read.
    await query("SELECT id FROM chain_lock WHERE id = 1 FOR UPDATE");
    const transactions = await query("SELECT job_key FROM chain_transactions WHERE election_id = ? AND status = 'pending' LIMIT 1", [id]);
    const attempts = await query("SELECT transaction_hash FROM chain_attempts WHERE election_id = ? AND status = 'pending' LIMIT 1", [id]);
    if (transactions.length || attempts.length) throw new ElectionError(409, "Ledger transactions are still pending. Refresh this election's results before deleting it.");
    await query("DELETE FROM voting_credentials WHERE election_id = ?", [id]);
    await query("DELETE FROM election_voters WHERE election_id = ?", [id]);
    await query("DELETE FROM chain_attempts WHERE election_id = ?", [id]);
    await query("DELETE FROM chain_transactions WHERE election_id = ?", [id]);
    await query("DELETE FROM election_banners WHERE election_id = ?", [id]);
    // Party details and ballot snapshots cascade from the ballot candidates.
    await query("DELETE FROM candidates WHERE election_id = ?", [id]);
    await query("DELETE FROM removed_elections WHERE election_id = ?", [id]);
    await query("DELETE FROM elections WHERE id = ?", [id]);
    await Audit.record(query, actor, "election_deleted", id, id);
  });
}

async function detail(id, actor) {
  const rows = await database.execute(`SELECT ${columns} FROM elections e WHERE e.id = ? ${scope(actor)}`, actor.role !== "voter" ? [id] : [id, actor.id]);
  if (!rows[0]) throw new ElectionError(404, "Election not found");
  const rowsWithParties = await database.execute(`SELECT c.id, c.name, c.manifesto, COALESCE(p.short_name, '') AS shortName, COALESCE(p.symbol, '') AS symbol,
    s.party_id AS registryPartyId, s.symbol_image AS symbolImage, s.roster
    FROM candidates c LEFT JOIN party_details p ON p.candidate_id = c.id LEFT JOIN election_party_snapshots s ON s.candidate_id = c.id WHERE c.election_id = ? ORDER BY c.name, c.id`, [id]);
  const candidates = rowsWithParties.map(p => ({ ...p, symbolImage: p.symbolImage ? require("./Registry").imageUrl(p.symbolImage) : null, roster: p.roster ?? [] }));
  const result = { election: { ...rows[0], partyCount: rows[0].candidateCount }, candidates, parties: candidates };
  if (actor.role === "admin") {
    const voters = await database.execute(`SELECT u.id, u.full_name AS fullName, u.email, u.is_approved AS isApproved
      FROM election_voters ev JOIN users u ON u.id = ev.voter_id WHERE ev.election_id = ? ORDER BY u.full_name, u.id`, [id]);
    result.voters = voters.map(voter => ({ ...voter, isApproved: Boolean(voter.isApproved) }));
  }
  return result;
}

async function checkSchedule(query, startsAt) {
  const [row] = await query("SELECT UTC_TIMESTAMP(3) AS now");
  if (startsAt <= row.now) throw new ElectionError(409, "The start time must be in the future");
}

async function editable(query, id) {
  const [election] = await query("SELECT starts_at AS startsAt FROM elections WHERE id = ? FOR UPDATE", [id]);
  if (!election) throw new ElectionError(404, "Election not found");
  // Check the clock after acquiring the lock, including time spent waiting.
  const [row] = await query("SELECT UTC_TIMESTAMP(3) AS now");
  if (election.startsAt <= row.now) throw new ElectionError(409, "This election has started. Its details, parties, and voter assignments are locked.");
}

async function create(data, actor) {
  const id = randomUUID();
  await database.transaction(async query => {
    await checkSchedule(query, data.startsAt);
    await query("INSERT INTO elections (id, title, description, starts_at, ends_at, created_by) VALUES (?, ?, ?, ?, ?, ?)", [id, data.title, data.description, data.startsAt, data.endsAt, actor.id]);
    if (!Array.isArray(data.partyIds) || data.partyIds.length < 2 || data.partyIds.length > 100 || new Set(data.partyIds).size !== data.partyIds.length) throw new ElectionError(400, "Select between 2 and 100 distinct registered parties");
    await require("./Registry").snapshot(query, id, data.partyIds);
    await Audit.record(query, actor, "election_created", id, id);
  });
  return detail(id, actor);
}

async function update(id, data, actor) {
  await database.transaction(async query => {
    await editable(query, id);
    await checkSchedule(query, data.startsAt);
    await query("UPDATE elections SET title = ?, description = ?, starts_at = ?, ends_at = ? WHERE id = ?", [data.title, data.description, data.startsAt, data.endsAt, id]);
    await Audit.record(query, actor, "election_updated", id, id);
  });
  return detail(id, actor);
}

async function saveCandidate(electionId) {
  await database.transaction(async query => {
    await editable(query, electionId);
    throw new ElectionError(409, "Register parties and candidates in the registry, then select them when creating an election. Ballot snapshots cannot be edited.");
  });
}

async function removeCandidate(electionId) {
  return saveCandidate(electionId);
}

async function assignVoter(electionId, voterId, actor) {
  await database.transaction(async query => {
    await editable(query, electionId);
    const [voter] = await query("SELECT role, is_approved AS isApproved FROM users WHERE id = ? FOR UPDATE", [voterId]);
    if (!voter || voter.role !== "voter" || !voter.isApproved) throw new ElectionError(400, "Only an approved voter can be assigned");
    await query("INSERT INTO election_voters (election_id, voter_id) VALUES (?, ?)", [electionId, voterId]);
    await Audit.record(query, actor, "voter_assigned", voterId, electionId);
  });
}

async function removeVoter(electionId, voterId, actor) {
  await database.transaction(async query => {
    await editable(query, electionId);
    const result = await query("DELETE FROM election_voters WHERE election_id = ? AND voter_id = ?", [electionId, voterId]);
    if (!result.affectedRows) throw new ElectionError(404, "Voter assignment not found");
    await Audit.record(query, actor, "voter_unassigned", voterId, electionId);
  });
}

async function saveBanner(id, image, actor) {
  await database.transaction(async query => {
    await editable(query, id);
    if (image) {
      const version = createHash("sha256").update(image).digest("hex");
      await query(`INSERT INTO election_banners (election_id, image_data, version) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE image_data = VALUES(image_data), version = VALUES(version)`, [id, image, version]);
    } else await query("DELETE FROM election_banners WHERE election_id = ?", [id]);
    await Audit.record(query, actor, image ? "election_banner_updated" : "election_banner_removed", id, id);
  });
  return detail(id, actor);
}

async function banner(id, actor) {
  // Use the same visibility rules as the election; never make private banners public.
  const rows = await database.execute(`SELECT b.image_data FROM elections e JOIN election_banners b ON b.election_id = e.id
    WHERE e.id = ? ${scope(actor)}`, actor.role === "voter" ? [id, actor.id] : [id]);
  if (!rows[0]) throw new ElectionError(404, "Election banner not found");
  return rows[0].image_data;
}

module.exports = { ElectionError, list, detail, create, update, saveCandidate, removeCandidate, assignVoter, removeVoter, saveBanner, banner, remove };
