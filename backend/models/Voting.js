const { randomBytes, createHash, createCipheriv, createDecipheriv, timingSafeEqual } = require("node:crypto");
const { id } = require("ethers");
const database = require("../database");
const Election = require("./Election");
const chainService = require("../blockchain/service");
const fail = (status, message) => { throw new Election.ElectionError(status, message); };
const digest = value => createHash("sha256").update(value).digest("hex");

function encrypt(nullifier, electionId, voterId) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(chainService.configuration().encryptionKey, "hex"), iv);
  cipher.setAAD(Buffer.from(`${electionId}:${voterId}`));
  const data = Buffer.concat([cipher.update(nullifier, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
function decrypt(value, electionId, voterId) {
  try {
    const data = Buffer.from(value, "base64");
    const decipher = createDecipheriv("aes-256-gcm", Buffer.from(chainService.configuration().encryptionKey, "hex"), data.subarray(0, 12));
    decipher.setAAD(Buffer.from(`${electionId}:${voterId}`));
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
  } catch { fail(503, "The credential encryption key does not match this database. Restore the matching configuration."); }
}

async function eligibility(query, electionId, actor, active = true) {
  // The same election -> user lock order is used by assignment and issuance.
  const [election] = await query("SELECT starts_at AS startsAt, ends_at AS endsAt FROM elections WHERE id = ? FOR UPDATE", [electionId]);
  const [user] = await query("SELECT role, is_approved AS approved FROM users WHERE id = ? FOR UPDATE", [actor.id]);
  if (!user || user.role !== "voter" || !user.approved) fail(403, "An approved voter account is required");
  const [assigned] = await query("SELECT voter_id FROM election_voters WHERE election_id = ? AND voter_id = ?", [electionId, actor.id]);
  if (!election || !assigned) fail(404, "Election not found");
  const [clock] = await query("SELECT UTC_TIMESTAMP(3) AS now");
  if (active && (clock.now < election.startsAt || clock.now >= election.endsAt)) fail(409, "This election is not active");
  if (active) {
    const [parties] = await query("SELECT COUNT(*) AS total FROM candidates WHERE election_id = ?", [electionId]);
    if (parties.total < 2) fail(409, "At least two political parties are required to open voting");
  }
  return { ...election, now: clock.now };
}

async function issue(electionId, actor) {
  await Election.detail(electionId, actor);
  const chain = await chainService.ensureElection(electionId);
  return database.transaction(async query => {
    const election = await eligibility(query, electionId, actor);
    const [credential] = await query("SELECT * FROM voting_credentials WHERE election_id = ? AND voter_id = ? FOR UPDATE", [electionId, actor.id]);
    const nullifier = credential ? decrypt(credential.encrypted_nullifier, electionId, actor.id) : `0x${randomBytes(32).toString("hex")}`;
    const [job] = await query("SELECT status FROM chain_transactions WHERE job_key = ?", [`ballot:${nullifier}`]);
    if (job && job.status !== "failed") fail(409, "A ballot has already been submitted. Check its transaction status.");
    if (await chain.contract.hasVoted(id(electionId), nullifier)) fail(409, "Your vote has already been recorded");
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Math.floor(Math.min(election.now.getTime() + 5 * 60000, election.endsAt.getTime()) / 1000) * 1000);
    if (expiresAt <= election.now) fail(409, "This election is closing");
    const encrypted = credential?.encrypted_nullifier ?? encrypt(nullifier, electionId, actor.id);
    await query(`INSERT INTO voting_credentials (election_id, voter_id, encrypted_nullifier, token_hash, expires_at)
      VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE token_hash = VALUES(token_hash), expires_at = VALUES(expires_at)`, [electionId, actor.id, encrypted, digest(token), expiresAt]);
    return { credential: token, expiresAt };
  });
}

async function cast(electionId, actor, candidateId, token) {
  await Election.detail(electionId, actor);
  const chain = await chainService.ensureElection(electionId);
  const job = await database.transaction(async query => {
    const election = await eligibility(query, electionId, actor);
    const [candidate] = await query("SELECT id FROM candidates WHERE id = ? AND election_id = ?", [candidateId, electionId]);
    if (!candidate) fail(400, "Choose a party from this election");
    const [credential] = await query("SELECT * FROM voting_credentials WHERE election_id = ? AND voter_id = ? FOR UPDATE", [electionId, actor.id]);
    if (!credential || !timingSafeEqual(Buffer.from(credential.token_hash, "hex"), Buffer.from(digest(token), "hex"))) fail(400, "Invalid voting credential. Prepare your ballot again.");
    const nullifier = decrypt(credential.encrypted_nullifier, electionId, actor.id);
    await chainService.lock(query, chain);
    const [existing] = await query("SELECT * FROM chain_transactions WHERE job_key = ?", [`ballot:${nullifier}`]);
    if (existing && existing.status !== "failed") return existing;
    if (election.now >= credential.expires_at) fail(409, "Your voting credential expired. Prepare your ballot again.");
    if (await chain.contract.hasVoted(id(electionId), nullifier)) fail(409, "Your vote has already been recorded");
    return chainService.prepare(query, chain, { key: `ballot:${nullifier}`, electionId, kind: "ballot", method: "castVote",
      args: [id(electionId), id(candidateId), nullifier, Math.floor(credential.expires_at.getTime() / 1000)] });
  });
  await chainService.flush(chain);
  await chainService.reconcile(chain, job);
  return chainService.publicReceipt(job, chain);
}

async function status(electionId, actor) {
  await Election.detail(electionId, actor);
  const [credential] = await database.execute("SELECT * FROM voting_credentials WHERE election_id = ? AND voter_id = ?", [electionId, actor.id]);
  if (!credential) return { status: "not_submitted" };
  const nullifier = decrypt(credential.encrypted_nullifier, electionId, actor.id);
  const [job] = await database.execute("SELECT * FROM chain_transactions WHERE job_key = ?", [`ballot:${nullifier}`]);
  if (!job) return { status: "not_submitted" };
  const chain = await chainService.connect();
  await chainService.flush(chain);
  await chainService.reconcile(chain, job);
  return chainService.publicReceipt(job, chain);
}

async function results(electionId, actor) {
  const detail = await Election.detail(electionId, actor);
  if (detail.election.status !== "ended") fail(409, "Results are available after the election ends");
  // No candidate means no valid ballot could have been cast; make this explicit.
  if (detail.candidates.length < 2) {
    const [published] = await database.execute("SELECT job_key FROM chain_transactions WHERE job_key = ?", [`election:${electionId}`]);
    if (!published) {
      const parties = detail.candidates.map(party => ({ ...party, votes: 0 }));
      return { candidates: parties, parties, totalVotes: 0, status: "insufficient_parties", receipts: [], audit: null };
    }
  }
  const chain = await chainService.ensureElection(electionId);
  const [candidateIds, totals] = await chain.contract.results(id(electionId));
  const counts = new Map(candidateIds.map((key, index) => [key, Number(totals[index])]));
  if (counts.size !== detail.candidates.length || detail.candidates.some(candidate => !counts.has(id(candidate.id)))) fail(503, "Party records do not match the ledger");
  const candidates = detail.candidates.map(candidate => ({ ...candidate, votes: counts.get(id(candidate.id)) })).sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
  const jobs = await database.execute("SELECT * FROM chain_transactions WHERE election_id = ? AND kind = 'ballot' ORDER BY nonce", [electionId]);
  for (const job of jobs) await chainService.reconcile(chain, job);
  const events = await chain.contract.queryFilter(chain.contract.filters.BallotAccepted(id(electionId)), chain.config.deploymentBlock);
  const totalVotes = candidates.reduce((sum, candidate) => sum + candidate.votes, 0);
  const confirmed = jobs.filter(job => job.status === "confirmed");
  const hashes = new Set(events.map(event => event.transactionHash));
  const eventCounts = new Map();
  for (const event of events) eventCounts.set(event.args.candidateId, (eventCounts.get(event.args.candidateId) || 0) + 1);
  const matches = confirmed.length === events.length && confirmed.every(job => hashes.has(job.transaction_hash)) && totalVotes === events.length && candidateIds.every(key => (eventCounts.get(key) || 0) === counts.get(key));
  const pending = jobs.filter(job => job.status === "pending").length;
  const [failures] = await database.execute("SELECT COUNT(*) AS total FROM chain_attempts WHERE election_id = ? AND kind = 'ballot' AND status = 'failed'", [electionId]);
  return { candidates, parties: candidates, totalVotes, status: pending ? "pending" : matches ? "verified" : "mismatch", contractAddress: chain.config.address,
    chainId: chain.config.chainId, receipts: confirmed.map(job => chainService.publicReceipt(job, chain)),
    audit: { confirmedTransactions: confirmed.length, ballotEvents: events.length, pendingTransactions: pending, failedTransactions: failures.total, matches } };
}
module.exports = { issue, cast, status, results };
