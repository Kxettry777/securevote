const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const database = require("../database");
const Audit = require("../models/Audit");
const { purgeRemovedElections } = require("../scripts/purge-removed-elections");

module.exports = async function electionDeletionChecks(t, request, { token, voterId, voterToken, adminId, partyToken, schedule, symbolImage }) {
  const created = await request("/elections", "POST", schedule, token);
  assert.equal(created.status, 201);
  const electionId = created.data.election.id;
  const path = `/elections/${electionId}`;
  const confirmation = { confirmation: "DELETE" };
  const partiesBefore = (await request("/registry", "GET", undefined, token)).data;
  const countsBefore = (await request("/admin/dashboard", "GET", undefined, token)).data.elections;
  assert.equal((await request(`${path}/voters`, "POST", { voterId }, token)).status, 201);
  await database.execute("INSERT INTO election_banners (election_id, image_data, version) VALUES (?, ?, ?)", [electionId, Buffer.from(symbolImage.split(",")[1], "base64"), "a".repeat(64)]);
  await database.execute("INSERT INTO voting_credentials (election_id, voter_id, encrypted_nullifier, token_hash, expires_at) VALUES (?, ?, ?, ?, ?)", [electionId, voterId, "test-only", "a".repeat(64), new Date(schedule.endsAt)]);
  const before = (await request(path, "GET", undefined, token)).data;
  const endElection = id => database.execute("UPDATE elections SET starts_at = UTC_TIMESTAMP(3) - INTERVAL 2 HOUR, ends_at = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE id = ?", [id]);

  await t.test("permanent election deletion requires admin confirmation and an ended election", async () => {
    assert.equal((await request(path, "DELETE", confirmation)).status, 401);
    for (const unauthorized of [voterToken, partyToken]) assert.equal((await request(path, "DELETE", confirmation, unauthorized)).status, 403);
    for (const body of [undefined, {}, { confirmation: "delete" }]) assert.equal((await request(path, "DELETE", body, token)).status, 400);
    assert.equal((await request("/elections/invalid", "DELETE", confirmation, token)).status, 400);
    assert.equal((await request(`/elections/${randomUUID()}`, "DELETE", confirmation, token)).status, 404);
    assert.equal((await request(path, "DELETE", confirmation, token)).status, 409);
    await database.execute("UPDATE elections SET starts_at = UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE id = ?", [electionId]);
    assert.equal((await request(path, "DELETE", confirmation, token)).status, 409);
    await endElection(electionId);
  });
  await t.test("permanent deletion retains pending ledger transactions for recovery", async () => {
    const hash = `0x${"b".repeat(64)}`;
    await database.execute("INSERT INTO chain_transactions (job_key, election_id, kind, nonce, transaction_hash, raw_transaction) VALUES (?, ?, 'election', 0, ?, 'test-only')", [`election:${electionId}`, electionId, hash]);
    await database.execute("INSERT INTO chain_attempts (transaction_hash, election_id, kind, nonce) VALUES (?, ?, 'election', 0)", [hash, electionId]);
    assert.equal((await request(path, "DELETE", confirmation, token)).status, 409);
    await database.execute("UPDATE chain_transactions SET status = 'failed' WHERE election_id = ?", [electionId]);
    assert.equal((await request(path, "DELETE", confirmation, token)).status, 409);
    assert.deepEqual((await request(path, "GET", undefined, token)).data.parties, before.parties);
    await database.execute("UPDATE chain_attempts SET status = 'failed' WHERE election_id = ?", [electionId]);
  });
  await t.test("an audit failure rolls back permanent election deletion and its dependents", async () => {
    const audit = t.mock.method(Audit, "record", async () => { throw new Error("Simulated audit outage"); });
    try { assert.equal((await request(path, "DELETE", confirmation, token)).status, 500); }
    finally { audit.mock.restore(); }
    const after = (await request(path, "GET", undefined, token)).data;
    assert.deepEqual(after.parties, before.parties);
    assert.deepEqual(after.voters, before.voters);
    for (const table of ["voting_credentials", "election_banners", "chain_transactions", "chain_attempts"]) {
      assert.equal((await database.execute(`SELECT COUNT(*) AS total FROM ${table} WHERE election_id = ?`, [electionId]))[0].total, 1);
    }
  });
  await t.test("deletion removes local election data for every role, updates counts, and cannot be restored", async () => {
    const results = await Promise.all([request(path, "DELETE", confirmation, token), request(path, "DELETE", confirmation, token)]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 404]);
    for (const actor of [token, voterToken, partyToken]) {
      for (const suffix of ["", "/banner", "/results"]) assert.equal((await request(`${path}${suffix}`, "GET", undefined, actor)).status, 404);
      assert.ok(!(await request("/elections", "GET", undefined, actor)).data.elections.some(e => e.id === electionId));
    }
    assert.equal((await request(`${path}/restore`, "POST", undefined, token)).status, 404);
    assert.equal((await request("/elections?removed=true", "GET", undefined, token)).status, 400);
    for (const table of ["voting_credentials", "election_voters", "chain_transactions", "chain_attempts", "election_banners", "candidates", "removed_elections"]) {
      assert.equal((await database.execute(`SELECT COUNT(*) AS total FROM ${table} WHERE election_id = ?`, [electionId]))[0].total, 0);
    }
    for (const candidate of before.parties) {
      for (const table of ["party_details", "election_party_snapshots"]) assert.equal((await database.execute(`SELECT COUNT(*) AS total FROM ${table} WHERE candidate_id = ?`, [candidate.id]))[0].total, 0);
    }
    assert.deepEqual((await request("/registry", "GET", undefined, token)).data, partiesBefore);
    assert.equal((await request("/auth/me", "GET", undefined, voterToken)).status, 200);
    assert.equal((await request("/admin/dashboard", "GET", undefined, token)).data.elections.total, countsBefore.total - 1);
    assert.equal((await database.execute("SELECT id FROM audit_log WHERE action = 'election_deleted' AND target_id = ?", [electionId])).length, 1);
  });
  await t.test("legacy cleanup permanently deletes only previously removed elections and is repeatable", async () => {
    const archived = (await request("/elections", "POST", schedule, token)).data.election.id;
    const retained = (await request("/elections", "POST", schedule, token)).data.election.id;
    await endElection(archived);
    await endElection(retained);
    await database.execute("INSERT INTO removed_elections (election_id, removed_by) VALUES (?, ?)", [archived, adminId]);
    assert.equal((await request(`/elections/${archived}`, "GET", undefined, token)).status, 404);
    assert.equal(await purgeRemovedElections(), 1);
    assert.equal(await purgeRemovedElections(), 0);
    assert.equal((await database.execute("SELECT id FROM elections WHERE id = ?", [archived])).length, 0);
    assert.equal((await request(`/elections/${retained}`, "GET", undefined, token)).status, 200);
    assert.equal((await request(`/elections/${retained}`, "DELETE", confirmation, token)).status, 200);
  });
};
