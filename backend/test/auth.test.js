const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { randomUUID } = require("node:crypto");
const database = require("../database");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Enrollment = require("../models/Enrollment");
const app = require("../app");

// Exercise the real HTTP routes, password hashing, and JWT middleware with an
// isolated in-memory repository. MySQL persistence needs a separate smoke test.
test("registration, approval, and session authorization", async (t) => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "isolated-test-secret-never-used-by-the-application";
  const users = new Map();
  let connected = true;
  t.mock.method(database, "isAvailable", async () => connected);
  t.mock.method(User, "findByEmail", async email => [...users.values()].find(user => user.email === email) ?? null);
  t.mock.method(User, "findById", async id => users.get(id) ?? null);
  t.mock.method(User, "listVoters", async () => [...users.values()].filter(user => user.role === "voter").map(({ passwordHash, ...user }) => user));
  t.mock.method(User, "create", async data => {
    const user = { role: "voter", isApproved: false, ...data, id: randomUUID(), createdAt: new Date() };
    users.set(user.id, user);
    return user;
  });
  t.mock.method(User, "setVoterApproval", async (id, isApproved) => {
    const user = users.get(id);
    if (!user || user.role !== "voter") return null;
    user.isApproved = isApproved;
    const { passwordHash, ...publicUser } = user;
    return publicUser;
  });
  const admin = await User.create({ fullName: "Test Admin", email: "admin@example.com", passwordHash: await bcrypt.hash("admin-password", 4), role: "admin", isApproved: true });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });
  async function request(path, method = "GET", body, token) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, data: await response.json() };
  }
  let voterId, adminToken, voterToken;
  await t.test("public registration is disabled and cannot create accounts", async () => {
    const before = users.size;
    for (const body of [undefined, {}, { fullName: "Test Voter", email: "voter@example.com", password: "voter-password", role: "admin", isApproved: true }]) {
      assert.equal((await request("/auth/register", "POST", body)).status, 403);
    }
    assert.equal(users.size, before);
  });
  // Existing accounts retain their passwords and approval behavior.
  voterId = (await User.create({ fullName: "Test Voter", email: "voter@example.com", passwordHash: await bcrypt.hash("voter-password", 4) })).id;
  await t.test("pending voter cannot sign in", async () => {
    assert.equal((await request("/auth/login", "POST", { email: "voter@example.com", password: "voter-password" })).status, 403);
  });
  await t.test("malformed credentials and incorrect passwords are rejected", async () => {
    assert.equal((await request("/auth/login", "POST", { email: {}, password: [] })).status, 400);
    assert.equal((await request("/auth/login", "POST", { email: "admin@example.com", password: "incorrect" })).status, 401);
  });
  await t.test("admin sign-in and voter list exclude password hashes", async () => {
    const result = await request("/auth/login", "POST", { email: "admin@example.com", password: "admin-password" });
    assert.equal(result.status, 200);
    adminToken = result.data.token;
    const list = await request("/admin/voters", "GET", undefined, adminToken);
    assert.equal(list.status, 200);
    assert.equal(list.data.voters.length, 1);
    assert.equal(list.data.voters[0].passwordHash, undefined);
  });
  await t.test("admin endpoints require a valid session", async () => {
    assert.equal((await request("/admin/voters")).status, 401);
    assert.equal((await request("/admin/voters", "GET", undefined, "invalid")).status, 401);
  });
  await t.test("enrollment rejects missing identity and admin-selected passwords", async () => {
    const body = { fullName: "New Voter", email: "new@example.com", institutionalId: "STU-001", isApproved: true };
    for (const invalid of [{ ...body, fullName: " " }, { ...body, email: "invalid" }, { ...body, institutionalId: undefined }, { ...body, institutionalId: "bad id" }, { ...body, isApproved: "true" }, { ...body, password: "password123" }]) {
      assert.equal((await request("/admin/voters", "POST", invalid, adminToken)).status, 400);
    }
    assert.equal((await request("/admin/voters", "POST", body)).status, 401);
    assert.equal((await request(`/admin/voters/${voterId}/activation`, "POST")).status, 401);
  });
  await t.test("activation validates its token and password before using the repository", async () => {
    const activate = t.mock.method(Enrollment, "activate", async () => null);
    for (const body of [undefined, {}, { token: "bad", password: "password123" }, { token: "a".repeat(64), password: "short" }, { token: "a".repeat(64), password: "\u{1F600}".repeat(20) }]) {
      assert.equal((await request("/auth/activate", "POST", body)).status, 400);
    }
    assert.equal(activate.mock.callCount(), 0);
    assert.equal((await request("/auth/activate", "POST", { token: "a".repeat(64), password: "password123" })).status, 400);
    assert.equal(activate.mock.callCount(), 1);
    activate.mock.restore();
  });
  await t.test("approval validates ID and boolean; cannot approve an admin", async () => {
    assert.equal((await request("/admin/voters/invalid/approval", "PATCH", { isApproved: true }, adminToken)).status, 400);
    assert.equal((await request(`/admin/voters/${voterId}/approval`, "PATCH", { isApproved: "true" }, adminToken)).status, 400);
    assert.equal((await request(`/admin/voters/${admin.id}/approval`, "PATCH", { isApproved: true }, adminToken)).status, 404);
  });
  await t.test("approval enables voter login and profile retrieval", async () => {
    const approval = await request(`/admin/voters/${voterId}/approval`, "PATCH", { isApproved: true }, adminToken);
    assert.equal(approval.status, 200);
    assert.equal(approval.data.voter.passwordHash, undefined);
    const login = await request("/auth/login", "POST", { email: "voter@example.com", password: "voter-password" });
    assert.equal(login.status, 200);
    voterToken = login.data.token;
    const profile = await request("/auth/me", "GET", undefined, voterToken);
    assert.equal(profile.status, 200);
    assert.equal(profile.data.user.id, voterId);
    assert.equal(profile.data.user.passwordHash, undefined);
  });
  await t.test("voter cannot list voters or change approval", async () => {
    assert.equal((await request("/admin/voters", "GET", undefined, voterToken)).status, 403);
    assert.equal((await request("/admin/voters", "POST", {}, voterToken)).status, 403);
    assert.equal((await request(`/admin/voters/${voterId}/activation`, "POST", undefined, voterToken)).status, 403);
    assert.equal((await request(`/admin/voters/${voterId}/approval`, "PATCH", { isApproved: true }, voterToken)).status, 403);
  });
  await t.test("revocation blocks an already-issued voter token", async () => {
    assert.equal((await request(`/admin/voters/${voterId}/approval`, "PATCH", { isApproved: false }, adminToken)).status, 200);
    assert.equal((await request("/auth/me", "GET", undefined, voterToken)).status, 403);
  });
  await t.test("authorization uses current role instead of stale JWT role", async () => {
    admin.role = "auditor";
    assert.equal((await request("/admin/voters", "GET", undefined, adminToken)).status, 403);
    admin.role = "admin";
  });
  await t.test("expired tokens and deleted accounts are rejected", async () => {
    const expired = jwt.sign({ sub: String(admin.id) }, process.env.JWT_SECRET, { expiresIn: -1 });
    assert.equal((await request("/auth/me", "GET", undefined, expired)).status, 401);
    users.delete(String(admin.id));
    assert.equal((await request("/auth/me", "GET", undefined, adminToken)).status, 401);
  });
  await t.test("database outage returns a clear 503 while health remains available", async () => {
    connected = false;
    assert.equal((await request("/auth/login", "POST", { email: "voter@example.com", password: "voter-password" })).status, 503);
    const health = await request("/health");
    assert.equal(health.status, 200);
    assert.equal(health.data.database, "disconnected");
  });
});
