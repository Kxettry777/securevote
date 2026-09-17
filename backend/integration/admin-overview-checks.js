const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const database = require("../database");
const Audit = require("../models/Audit");

module.exports = async function adminOverviewChecks(t, request, { token, voterToken, first, second, electionId, otherId, schedule }) {
  let initialOverview;
  const route = `/registry/parties/${first.id}`;
  const confirmation = { confirmation: "DELETE" };
  // Earlier registry checks intentionally return this party to draft and add
  // roles. Prepare a complete submitted roster for deletion/rollback checks.
  const currentParty = (await request("/registry", "GET", undefined, first.token)).data.parties[0];
  for (const role of currentParty.roles) {
    if (currentParty.candidates.some(candidate => candidate.roleId === role.id)) continue;
    assert.equal((await request("/registry/candidates", "POST", {
      partyId: first.id, roleId: role.id, fullName: `Deletion check ${role.name}`, biography: "Test nominee",
    }, first.token)).status, 201);
  }
  assert.equal((await request("/registry/submit", "POST", {}, first.token)).status, 200);
  await t.test("admin dashboard counts real accounts, rosters, and election states", async () => {
    assert.equal((await request("/admin/dashboard")).status, 401);
    for (const unauthorized of [voterToken, first.token]) {
      assert.equal((await request("/admin/dashboard", "GET", undefined, unauthorized)).status, 403);
    }
    const result = await request("/admin/dashboard", "GET", undefined, token);
    assert.equal(result.status, 200);
    initialOverview = result.data;
    const voters = (await request("/admin/voters", "GET", undefined, token)).data.voters;
    const parties = (await request("/registry", "GET", undefined, token)).data.parties;
    assert.deepEqual(result.data.voters, {
      total: voters.length,
      approved: voters.filter(voter => voter.isApproved).length,
      pendingApproval: voters.filter(voter => !voter.isApproved).length,
      pendingActivation: voters.filter(voter => voter.activationPending).length,
    });
    assert.deepEqual(result.data.parties, { total: parties.length, submitted: parties.filter(party => party.submittedAt).length });
    assert.deepEqual(result.data.elections, { total: 2, upcoming: 1, active: 0, ended: 1 });
    await database.execute("UPDATE elections SET starts_at = UTC_TIMESTAMP(3) - INTERVAL 1 MINUTE WHERE id = ?", [otherId]);
    assert.equal((await request("/admin/dashboard", "GET", undefined, token)).data.elections.active, 1);
    await database.execute("UPDATE elections SET starts_at = ? WHERE id = ?", [new Date(schedule.startsAt), otherId]);
    await request(`/elections/${electionId}`, "DELETE", undefined, token);
    assert.deepEqual((await request("/admin/dashboard", "GET", undefined, token)).data.elections, { total: 1, upcoming: 1, active: 0, ended: 0 });
    await request(`/elections/${electionId}/restore`, "POST", undefined, token);
  });
  await t.test("party deletion requires an admin, valid ID, and explicit confirmation", async () => {
    assert.equal((await request(route, "DELETE", confirmation)).status, 401);
    for (const unauthorized of [voterToken, first.token, second.token]) {
      assert.equal((await request(route, "DELETE", confirmation, unauthorized)).status, 403);
    }
    assert.equal((await request(route, "DELETE", {}, token)).status, 400);
    assert.equal((await request("/registry/parties/invalid", "DELETE", confirmation, token)).status, 400);
    assert.equal((await request(`/registry/parties/${randomUUID()}`, "DELETE", confirmation, token)).status, 404);
    assert.equal((await request("/auth/me", "GET", undefined, first.token)).status, 200);
  });
  await t.test("a failed deletion audit rolls back account access and roster submission", async () => {
    const audit = t.mock.method(Audit, "record", async () => { throw new Error("Simulated audit outage"); });
    try { assert.equal((await request(route, "DELETE", confirmation, token)).status, 500); }
    finally { audit.mock.restore(); }
    assert.equal((await database.execute("SELECT party_id FROM deleted_parties WHERE party_id = ?", [first.id])).length, 0);
    assert.equal((await database.execute("SELECT party_id FROM party_submissions WHERE party_id = ?", [first.id])).length, 1);
    assert.equal((await request("/auth/me", "GET", undefined, first.token)).status, 200);
  });
  await t.test("party deletion disables existing sessions and preserves saved ballot snapshots", async () => {
    const before = (await request(`/elections/${electionId}`, "GET", undefined, token)).data;
    const upcoming = (await request(`/elections/${otherId}`, "GET", undefined, token)).data;
    await request("/registry/submit", "POST", {}, first.token);
    const results = await Promise.all([request(route, "DELETE", confirmation, token), request(route, "DELETE", confirmation, token)]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 404]);
    const registry = (await request("/registry", "GET", undefined, token)).data;
    assert.ok(!registry.parties.some(party => party.id === first.id));
    assert.ok(!registry.roles.some(role => role.partyId === first.id));
    assert.ok(!registry.candidates.some(candidate => candidate.partyId === first.id));
    assert.equal((await request("/auth/login", "POST", { email: first.email, password: first.password })).status, 403);
    for (const path of ["/auth/me", "/registry", "/elections"]) {
      assert.equal((await request(path, "GET", undefined, first.token)).status, 403);
    }
    assert.equal((await request("/registry/submit", "POST", {}, first.token)).status, 403);
    assert.equal((await request(route, "PATCH", first, token)).status, 404);
    assert.equal((await request("/registry/roles", "POST", { partyId: first.id, name: "New role", rank: 99 }, token)).status, 404);
    assert.equal((await request("/elections", "POST", schedule, token)).status, 400);
    assert.deepEqual((await request(`/elections/${electionId}`, "GET", undefined, token)).data.parties, before.parties);
    assert.deepEqual((await request(`/elections/${otherId}`, "GET", undefined, token)).data.parties, upcoming.parties);
    assert.equal((await request("/auth/me", "GET", undefined, second.token)).status, 200);
    const overview = (await request("/admin/dashboard", "GET", undefined, token)).data;
    assert.equal(overview.parties.total, initialOverview.parties.total - 1);
    assert.equal(overview.parties.submitted, initialOverview.parties.submitted - 1);
    assert.deepEqual(overview.elections, initialOverview.elections);
    const records = await database.execute("SELECT action FROM audit_log WHERE target_id = ?", [first.id]);
    assert.equal(records.filter(record => record.action === "party_registration_deleted").length, 1);
    assert.ok(records.some(record => record.action === "party_roster_submitted"));
  });
};
