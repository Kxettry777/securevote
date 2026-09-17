const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const database = require("../database");
const User = require("../models/User");

module.exports = async function enrollmentChecks(t, request, { token, voterToken }) {
  const body = { fullName: "Activation Voter", email: "activation@example.com", institutionalId: "MEMBER-001", isApproved: true };
  let enrolled;
  await t.test("commission enrollment stores only a token hash and creates no election access", async () => {
    const result = await request("/admin/voters", "POST", body, token);
    assert.equal(result.status, 201);
    enrolled = result.data;
    const [stored] = await database.execute("SELECT * FROM voter_enrollments WHERE user_id = ?", [enrolled.voter.id]);
    assert.match(stored.token_hash, /^[a-f0-9]{64}$/);
    assert.notEqual(stored.token_hash, enrolled.activation.token);
    assert.ok(Date.parse(enrolled.activation.expiresAt) > Date.now() + 23 * 3600000);
    assert.equal((await User.findByEmail(body.email)).passwordHash, "");
    assert.equal((await database.execute("SELECT COUNT(*) AS total FROM election_voters WHERE voter_id = ?", [enrolled.voter.id]))[0].total, 0);
    assert.equal((await request("/auth/login", "POST", { email: body.email, password: "anything" })).status, 401);
    const prematureToken = jwt.sign({ sub: enrolled.voter.id }, process.env.JWT_SECRET);
    assert.equal((await request("/auth/me", "GET", undefined, prematureToken)).status, 403);
    const list = await request("/admin/voters", "GET", undefined, token);
    assert.ok(!JSON.stringify(list.data).includes(enrolled.activation.token));
    assert.ok(!JSON.stringify(list.data).includes(stored.token_hash));
  });
  await t.test("duplicate institutional IDs roll back the new account", async () => {
    const duplicate = { ...body, email: "duplicate-id@example.com", institutionalId: " member-001 " };
    assert.equal((await request("/admin/voters", "POST", duplicate, token)).status, 409);
    assert.equal(await User.findByEmail(duplicate.email), null);
  });
  await t.test("expired and replaced links cannot activate an account", async () => {
    await database.execute("UPDATE voter_enrollments SET expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE user_id = ?", [enrolled.voter.id]);
    const activation = { token: enrolled.activation.token, password: "activation-password" };
    assert.equal((await request("/auth/activate", "POST", activation)).status, 400);
    const route = `/admin/voters/${enrolled.voter.id}/activation`;
    assert.equal((await request(route, "POST")).status, 401);
    assert.equal((await request(route, "POST", undefined, voterToken)).status, 403);
    const replacement = await request(route, "POST", undefined, token);
    assert.equal(replacement.status, 200);
    assert.notEqual(replacement.data.activation.token, activation.token);
    // Even if its old expiry were extended, the replaced token is invalid.
    assert.equal((await request("/auth/activate", "POST", activation)).status, 400);
    enrolled.activation = replacement.data.activation;
  });
  await t.test("activation is single-use under concurrency and cannot grant role or approval", async () => {
    const activation = { token: enrolled.activation.token, password: "activation-password", role: "admin", isApproved: true };
    await request(`/admin/voters/${enrolled.voter.id}/approval`, "PATCH", { isApproved: false }, token);
    const results = await Promise.all([request("/auth/activate", "POST", activation), request("/auth/activate", "POST", activation)]);
    assert.deepEqual(results.map(result => result.status).sort(), [200, 400]);
    const stored = await User.findByEmail(body.email);
    assert.equal(stored.role, "voter");
    assert.equal(stored.isApproved, false);
    assert.equal(stored.activationPending, false);
    assert.ok(await bcrypt.compare(activation.password, stored.passwordHash));
    assert.equal((await request("/auth/login", "POST", { email: body.email, password: activation.password })).status, 403);
    assert.equal((await request(`/admin/voters/${stored.id}/activation`, "POST", undefined, token)).status, 409);
    assert.equal((await request("/auth/activate", "POST", { ...activation, password: "replacement-password" })).status, 400);
    await request(`/admin/voters/${stored.id}/approval`, "PATCH", { isApproved: true }, token);
    assert.equal((await request("/auth/login", "POST", { email: body.email, password: activation.password })).status, 200);
    const [entry] = await database.execute("SELECT token_hash FROM voter_enrollments WHERE user_id = ?", [stored.id]);
    assert.equal(entry.token_hash, null);
    const actions = await database.execute("SELECT action FROM audit_log WHERE target_id = ?", [stored.id]);
    for (const action of ["voter_registered_by_admin", "voter_activation_reissued", "voter_activated"]) assert.ok(actions.some(entry => entry.action === action));
    assert.equal(actions.filter(entry => entry.action === "voter_activated").length, 1);
  });
};
