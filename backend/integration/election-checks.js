const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const database = require("../database");
const User = require("../models/User");

module.exports = async function electionChecks(t, request, { token, voterId, voterToken, adminId }) {
  const { parties, roles, symbolImage } = await require("./registry-fixtures")(request, token);
  const [first, second] = parties;
  const schedule = { title: "Student council", description: "Choose your representatives.", startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: new Date(Date.now() + 7200000).toISOString(), partyIds: parties.map(p => p.id) };
  let electionId, otherId;
  await t.test("symbol selection saves a matching name and image and rejects unknown choices", async () => {
    assert.equal((await request("/registry/symbols")).status, 401);
    assert.equal((await request("/registry/symbols", "GET", undefined, voterToken)).status, 403);
    const catalog = await request("/registry/symbols", "GET", undefined, token);
    assert.equal(catalog.status, 200);
    const bell = catalog.data.symbols.find(symbol => symbol.id === "bell");
    assert.ok(bell);
    assert.match(bell.image, /^data:image\/webp;base64,/);
    const body = { name: "Symbol selection party", shortName: "SSP", email: "symbol-choice@example.com", password: "symbol-party-password", symbolId: bell.id, symbol: "Wrong name", symbolImage: "invalid" };
    assert.equal((await request("/registry/parties", "POST", { ...body, symbolId: "unknown" }, token)).status, 400);
    const created = await request("/registry/parties", "POST", body, token);
    assert.equal(created.status, 201);
    const readParty = async () => (await request("/registry", "GET", undefined, token)).data.parties.find(party => party.id === created.data.id);
    let saved = await readParty();
    assert.equal(saved.symbol, bell.name);
    assert.equal(saved.symbolImage, bell.image);
    // Keeping a previously saved symbol does not overwrite its image.
    assert.equal((await request(`/registry/parties/${saved.id}`, "PATCH", { name: saved.name, shortName: saved.shortName, symbol: saved.symbol }, token)).status, 200);
    assert.equal((await readParty()).symbolImage, bell.image);
    const sun = catalog.data.symbols.find(symbol => symbol.id === "sun");
    assert.equal((await request(`/registry/parties/${saved.id}`, "PATCH", { name: saved.name, symbolId: sun.id }, token)).status, 200);
    saved = await readParty();
    assert.equal(saved.symbol, sun.name);
    assert.equal(saved.symbolImage, sun.image);
  });
  await t.test("party registration is admin-only, atomic, and excludes credentials", async () => {
    assert.equal((await request("/registry")).status, 401);
    assert.equal((await request("/registry", "GET", undefined, voterToken)).status, 403);
    assert.equal((await request("/registry/parties", "POST", first, first.token)).status, 403);
    const count = (await database.execute("SELECT COUNT(*) AS total FROM registered_parties"))[0].total;
    const body = { name: "Duplicate account party", email: first.email, password: "password-test", symbol: "Tree", symbolImage };
    assert.equal((await request("/registry/parties", "POST", body, token)).status, 409);
    assert.equal((await database.execute("SELECT COUNT(*) AS total FROM registered_parties"))[0].total, count);
    for (const invalid of [{ ...body, symbolImage: undefined }, { ...body, symbolImage: "data:image/png;base64,aW52YWxpZA==" }, { ...body, email: "invalid" }, { ...body, password: "short" }]) {
      assert.equal((await request("/registry/parties", "POST", invalid, token)).status, 400);
    }
    const own = (await request("/registry", "GET", undefined, first.token)).data;
    assert.equal(own.parties.length, 1);
    assert.equal(own.parties[0].id, first.id);
    assert.equal(own.candidates.length, roles.length);
    assert.ok(!JSON.stringify(own).includes(second.email));
    assert.ok(!JSON.stringify(own).includes("password"));
    assert.match(own.parties[0].symbolImage, /^data:image\/webp;base64,/);
    const selfRegistration = await request("/auth/register", "POST", { fullName: "Impersonator", email: "fake-party@example.com", password: "password-test", role: "party" });
    assert.equal(selfRegistration.status, 403);
    assert.equal(await User.findByEmail("fake-party@example.com"), null);
  });
  await t.test("parties nominate only their own candidates and submit complete rosters", async () => {
    const candidate = first.candidates[0];
    assert.equal((await request("/registry/candidates", "POST", candidate, token)).status, 403);
    assert.equal((await request("/registry/candidates", "POST", candidate, second.token)).status, 403);
    assert.equal((await request(`/registry/candidates/${candidate.id}`, "PATCH", { ...candidate, partyId: second.id, roleId: second.roles[0].id }, second.token)).status, 404);
    assert.equal((await request(`/registry/candidates/${candidate.id}`, "DELETE", undefined, second.token)).status, 404);
    assert.equal((await request("/registry/candidates", "POST", candidate, first.token)).status, 409);
    assert.equal((await request("/registry/roles", "POST", { name: "Treasurer", rank: 4 }, first.token)).status, 403);
    assert.equal((await request(`/registry/parties/${first.id}`, "PATCH", first, first.token)).status, 403);
    assert.equal((await request(`/registry/candidates/${candidate.id}`, "DELETE", undefined, first.token)).status, 200);
    assert.equal((await request("/registry/submit", "POST", {}, first.token)).status, 409);
    assert.equal((await request("/elections", "POST", schedule, token)).status, 409);
    const replacement = await request("/registry/candidates", "POST", candidate, first.token);
    assert.equal(replacement.status, 201);
    candidate.id = replacement.data.id;
    assert.equal((await request("/registry/submit", "POST", {}, first.token)).status, 200);
  });
  await t.test("election creation requires submitted parties, valid dates, and admin access", async () => {
    for (const unauthorized of [voterToken, first.token]) assert.equal((await request("/elections", "POST", schedule, unauthorized)).status, 403);
    for (const body of [null, {}, { ...schedule, title: " " }, { ...schedule, startsAt: "invalid" }, { ...schedule, startsAt: "2027-02-30T10:00:00.000Z" }, { ...schedule, endsAt: schedule.startsAt }, { ...schedule, partyIds: [] }, { ...schedule, partyIds: [first.id, first.id] }, { ...schedule, partyIds: [first.id, randomUUID()] }, { ...schedule, partyIds: ["invalid", second.id] }]) {
      assert.equal((await request("/elections", "POST", body, token)).status, 400);
    }
    assert.equal((await request("/elections", "POST", { ...schedule, startsAt: new Date(Date.now() - 10000).toISOString() }, token)).status, 409);
    assert.equal((await database.execute("SELECT COUNT(*) AS total FROM elections"))[0].total, 0);
    const created = await request("/elections", "POST", schedule, token);
    assert.equal(created.status, 201, JSON.stringify(created.data));
    electionId = created.data.election.id;
    assert.equal(created.data.parties.length, 2);
    assert.equal(created.data.parties[0].roster.length, roles.length);
    assert.deepEqual(created.data.parties[0].roster.map(c => c.rank), [1, 2, 3]);
    assert.equal((await database.execute("SELECT created_by AS creator FROM elections WHERE id = ?", [electionId]))[0].creator, adminId);
    otherId = (await request("/elections", "POST", { ...schedule, title: "Other election" }, token)).data.election.id;
    assert.equal((await request("/elections/invalid", "GET", undefined, token)).status, 400);
    assert.equal((await request(`/elections/${randomUUID()}`, "GET", undefined, token)).status, 404);
  });
  await t.test("registry changes require resubmission and never change saved ballots", async () => {
    const before = (await request(`/elections/${electionId}`, "GET", undefined, token)).data.parties;
    assert.equal((await request(`/registry/candidates/${first.candidates[0].id}`, "PATCH", { ...first.candidates[0], fullName: "New nominee for future elections" }, first.token)).status, 200);
    assert.equal((await request("/elections", "POST", schedule, token)).status, 409);
    assert.equal((await request("/registry/submit", "POST", {}, first.token)).status, 200);
    assert.equal((await request(`/registry/parties/${first.id}`, "PATCH", { ...first, name: "Renamed party", symbol: "New sun" }, token)).status, 200);
    assert.equal((await request("/registry/submit", "POST", {}, first.token)).status, 200);
    assert.equal((await request(`/registry/roles/${roles[0].id}`, "PATCH", { partyId: first.id, name: "Chairperson", rank: 1 }, token)).status, 200);
    const registry = (await request("/registry", "GET", undefined, token)).data;
    assert.equal(registry.parties.find(p => p.id === first.id).submittedAt, null);
    assert.ok(registry.parties.find(p => p.id === second.id).submittedAt);
    const after = (await request(`/elections/${electionId}`, "GET", undefined, first.token)).data;
    assert.deepEqual(after.parties, before);
    assert.equal(after.voters, undefined);
    for (const party of parties) assert.equal((await request("/registry/submit", "POST", {}, party.token)).status, 200);
    for (const suffix of ["parties", "candidates"]) {
      assert.equal((await request(`/elections/${electionId}/${suffix}`, "POST", { name: "Unregistered party" }, token)).status, 409);
      assert.equal((await request(`/elections/${electionId}/${suffix}/${before[0].id}`, "DELETE", undefined, token)).status, 409);
      assert.equal((await request(`/elections/${electionId}/${suffix}/${before[0].id}`, "PATCH", { name: "Changed" }, token)).status, 409);
    }
  });
  await t.test("eligibility remains admin-only and scopes voter reads", async () => {
    const path = `/elections/${electionId}`;
    const pending = await User.create({ fullName: "Pending Voter", email: "pending@example.com", passwordHash: "test-only" });
    for (const id of [pending.id, adminId, first.user.id, randomUUID()]) assert.equal((await request(`${path}/voters`, "POST", { voterId: id }, token)).status, 400);
    assert.equal((await request(path, "GET", undefined, voterToken)).status, 404);
    assert.equal((await request(`${path}/voters`, "POST", { voterId }, first.token)).status, 403);
    const assigned = await Promise.all([request(`${path}/voters`, "POST", { voterId }, token), request(`${path}/voters`, "POST", { voterId }, token)]);
    assert.deepEqual(assigned.map(r => r.status).sort(), [201, 409]);
    const detail = (await request(path, "GET", undefined, voterToken)).data;
    assert.equal(detail.parties.length, 2);
    assert.equal(detail.voters, undefined);
    assert.equal(JSON.stringify(detail).includes("@example.com"), false);
    assert.equal((await request(`/elections/${otherId}`, "GET", undefined, voterToken)).status, 404);
    assert.equal((await request(`${path}/voters/${voterId}`, "DELETE", undefined, token)).status, 200);
    assert.equal((await request(path, "GET", undefined, voterToken)).status, 404);
    assert.equal((await request(`${path}/voters`, "POST", { voterId }, token)).status, 201);
  });
  await t.test("banners persist, enforce access, and lock with the schedule", async () => {
    const sharp = require("sharp");
    const image = await sharp({ create: { width: 900, height: 300, channels: 3, background: "#24568e" } }).png().toBuffer();
    const path = `/elections/${electionId}`;
    assert.equal((await request(`${path}/banner`, "PUT", image, first.token, "image/png")).status, 403);
    assert.equal((await request(`${path}/banner`, "PUT", Buffer.from("invalid"), token, "image/png")).status, 400);
    assert.equal((await request(`${path}/banner`, "PUT", image, token, "image/png")).status, 200);
    await database.close();
    assert.equal((await request(`${path}/banner`, "GET", undefined, voterToken)).headers.get("content-type"), "image/webp");
    assert.equal((await request(`${path}/banner`, "DELETE", undefined, token)).status, 200);
    assert.equal((await request(`${path}/banner`, "GET", undefined, voterToken)).status, 404);
    assert.equal((await request(path, "PATCH", { ...schedule, title: "Updated schedule" }, token)).status, 200);
    await database.execute("UPDATE elections SET starts_at = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE id = ?", [electionId]);
    for (const args of [[path, "PATCH", schedule], [`${path}/voters`, "POST", { voterId }], [`${path}/voters/${voterId}`, "DELETE", undefined], [`${path}/banner`, "DELETE", undefined]]) assert.equal((await request(...args, token)).status, 409);
    assert.equal((await request(`${path}/banner`, "PUT", image, token, "image/png")).status, 409);
    assert.equal((await request(`${path}/credentials`, "POST", {}, first.token)).status, 403);
  });
  await t.test("registry and election changes are audited without passwords", async () => {
    assert.equal((await request("/admin/audit", "GET", undefined, first.token)).status, 403);
    const result = await request("/admin/audit", "GET", undefined, token);
    assert.equal(result.status, 200);
    for (const action of ["party_registered", "party_roster_submitted", "candidate_registered", "election_created"]) assert.ok(result.data.entries.some(entry => entry.action === action), action);
    assert.ok(!JSON.stringify(result.data).includes("password"));
    assert.equal(result.data.entries.filter(e => e.electionId === electionId && e.action === "election_created").length, 1);
  });
  await t.test("candidate roles and nomination validation are scoped to each party", async () => {
    assert.equal((await request(`/registry/roles/${roles[0].id}`, "PATCH", { partyId: second.id, name: "Wrong owner", rank: 1 }, token)).status, 404);
    assert.equal((await request(`/registry/candidates/${first.candidates[0].id}`, "PATCH", { ...first.candidates[0], roleId: second.roles[0].id }, first.token)).status, 400);
    const body = { partyId: first.id, name: "Treasurer", rank: 4 };
    assert.equal((await request("/registry/roles", "POST", body, token)).status, 201);
    assert.equal((await request("/registry/roles", "POST", body, token)).status, 409);
    assert.equal((await request("/registry/roles", "POST", { ...body, partyId: second.id }, token)).status, 201);
    assert.equal((await request("/registry/submit", "POST", {}, first.token)).status, 409);
    const own = (await request("/registry", "GET", undefined, first.token)).data;
    assert.equal(own.roles.length, 4);
    assert.ok(own.roles.every(r => r.partyId === first.id));
    assert.equal(own.parties[0].roles.length, 4);
    // The composite foreign key also prevents cross-party nominations outside HTTP.
    await assert.rejects(database.execute("UPDATE party_candidates SET role_id = ? WHERE id = ?", [second.roles[0].id, first.candidates[0].id]), { code: "ER_NO_REFERENCED_ROW_2" });
  });
  await t.test("admin voter registration validates input, approval, and privileges", async () => {
    const body = { fullName: "Admin Added Voter", email: " added@example.com ", institutionalId: "ADDED-001", isApproved: true, role: "admin" };
    for (const unauthorized of [voterToken, first.token]) assert.equal((await request("/admin/voters", "POST", body, unauthorized)).status, 403);
    assert.equal((await request("/admin/voters", "POST", body)).status, 401);
    for (const invalid of [{ ...body, fullName: " " }, { ...body, email: "invalid" }, { ...body, institutionalId: " " }, { ...body, isApproved: "true" }]) assert.equal((await request("/admin/voters", "POST", invalid, token)).status, 400);
    const result = await request("/admin/voters", "POST", body, token);
    assert.equal(result.status, 201);
    assert.equal(result.data.voter.role, "voter");
    assert.equal(result.data.voter.email, "added@example.com");
    assert.equal(result.data.voter.passwordHash, undefined);
    assert.equal((await request("/auth/activate", "POST", { token: result.data.activation.token, password: "added-voter-password" })).status, 200);
    assert.equal((await request("/auth/login", "POST", { email: body.email, password: "added-voter-password" })).status, 200);
    assert.equal((await request("/admin/voters", "POST", body, token)).status, 409);
    const pending = { ...body, email: "added-pending@example.com", institutionalId: "ADDED-002", isApproved: false };
    const pendingResult = await request("/admin/voters", "POST", pending, token);
    assert.equal(pendingResult.status, 201);
    assert.equal((await request("/auth/activate", "POST", { token: pendingResult.data.activation.token, password: "pending-password" })).status, 200);
    assert.equal((await request("/auth/login", "POST", { email: pending.email, password: "pending-password" })).status, 403);
    assert.equal((await request(`/elections/${otherId}/voters`, "POST", { voterId: result.data.voter.id }, token)).status, 201);
  });
  await t.test("only admins can remove ended elections and restore participant access", async () => {
    const path = `/elections/${electionId}`;
    for (const unauthorized of [voterToken, first.token]) {
      assert.equal((await request(path, "DELETE", undefined, unauthorized)).status, 403);
      assert.equal((await request(`${path}/restore`, "POST", undefined, unauthorized)).status, 403);
      assert.equal((await request("/elections?removed=true", "GET", undefined, unauthorized)).status, 403);
    }
    assert.equal((await request(path, "DELETE", undefined, token)).status, 409);
    assert.equal((await request(`/elections/${otherId}`, "DELETE", undefined, token)).status, 409);
    await database.execute("UPDATE elections SET ends_at = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND, starts_at = UTC_TIMESTAMP(3) - INTERVAL 2 HOUR WHERE id = ?", [electionId]);
    const before = (await request(path, "GET", undefined, token)).data;
    assert.equal((await request(path, "DELETE", undefined, token)).status, 200);
    assert.equal((await request(path, "DELETE", undefined, token)).status, 409);
    assert.ok(!(await request("/elections", "GET", undefined, token)).data.elections.some(e => e.id === electionId));
    assert.equal((await request("/elections?removed=true", "GET", undefined, token)).data.elections[0].id, electionId);
    for (const unauthorized of [voterToken, first.token]) {
      assert.equal((await request(path, "GET", undefined, unauthorized)).status, 404);
      assert.equal((await request(`${path}/results`, "GET", undefined, unauthorized)).status, 404);
      assert.ok(!(await request("/elections", "GET", undefined, unauthorized)).data.elections.some(e => e.id === electionId));
    }
    const after = (await request(path, "GET", undefined, token)).data;
    assert.deepEqual(after.parties, before.parties);
    assert.deepEqual(after.voters, before.voters);
    assert.equal((await request(`${path}/restore`, "POST", undefined, token)).status, 200);
    assert.equal((await request(path, "GET", undefined, voterToken)).status, 200);
    assert.equal((await request(`${path}/restore`, "POST", undefined, token)).status, 404);
  });
  await t.test("audit deletion needs admin confirmation and preserves newer events and elections", async () => {
    const page = (await request("/admin/audit", "GET", undefined, token)).data;
    const entry = page.entries[0];
    for (const unauthorized of [voterToken, first.token]) {
      assert.equal((await request(`/admin/audit/${entry.id}`, "DELETE", { confirmation: "DELETE" }, unauthorized)).status, 403);
      assert.equal((await request("/admin/audit", "DELETE", { confirmation: "DELETE", throughId: page.latestId }, unauthorized)).status, 403);
    }
    assert.equal((await request(`/admin/audit/${entry.id}`, "DELETE", {}, token)).status, 400);
    assert.equal((await request("/admin/audit", "DELETE", { confirmation: "DELETE" }, token)).status, 400);
    assert.equal((await request(`/admin/audit/${entry.id}`, "DELETE", { confirmation: "DELETE" }, token)).status, 200);
    assert.equal((await request(`/admin/audit/${entry.id}`, "DELETE", { confirmation: "DELETE" }, token)).status, 404);
    await request(`/elections/${otherId}`, "PATCH", { ...schedule, title: "New event after confirmation opened" }, token);
    const cleared = await request("/admin/audit", "DELETE", { confirmation: "DELETE", throughId: page.latestId }, token);
    assert.equal(cleared.status, 200);
    assert.ok(cleared.data.deleted > 0);
    const latest = (await request("/admin/audit", "GET", undefined, token)).data;
    assert.equal(latest.entries.length, 1);
    assert.ok(BigInt(latest.entries[0].id) > BigInt(page.latestId));
    assert.equal((await request(`/elections/${electionId}`, "GET", undefined, token)).status, 200);
    assert.equal((await request("/admin/audit", "DELETE", { confirmation: "DELETE", throughId: latest.latestId }, token)).status, 200);
    assert.equal((await request("/admin/audit", "GET", undefined, token)).data.entries.length, 0);
  });

  await require("./admin-overview-checks")(t, request, { token, voterToken, first, second, electionId, otherId, schedule });
};

