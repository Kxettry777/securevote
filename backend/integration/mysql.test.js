const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { once } = require("node:events");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
const database = require("../database");
const { setupDatabase } = require("../scripts/setup-db");
const User = require("../models/User");
const app = require("../app");
const { seedAdmin } = require("../index");

test("MySQL schema, persistence, and full authentication workflow", async t => {
  const previousEnv = { ...process.env };
  const databaseName = `securevote_test_${randomUUID().replaceAll("-", "")}`;
  process.env.MYSQL_DATABASE = databaseName;
  process.env.JWT_SECRET = "mysql-integration-test-only-secret";
  process.env.ADMIN_NAME = "Integration Admin";
  process.env.ADMIN_EMAIL = "admin@example.com";
  process.env.ADMIN_PASSWORD = "integration-admin-password";
  let server;
  t.after(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
    await database.close();
    // Only remove the uniquely named database created by this test run.
    assert.match(databaseName, /^securevote_test_[0-9a-f]{32}$/);
    const { database: ignored, ...options } = database.config();
    const cleanup = await mysql.createConnection(options);
    try {
      await cleanup.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
    } finally {
      await cleanup.end();
      for (const key of ["MYSQL_DATABASE", "JWT_SECRET", "ADMIN_NAME", "ADMIN_EMAIL", "ADMIN_PASSWORD"]) {
        if (previousEnv[key] === undefined) delete process.env[key];
        else process.env[key] = previousEnv[key];
      }
    }
  });
  await setupDatabase();
  await setupDatabase();
  await seedAdmin();
  await seedAdmin();
  assert.equal((await database.execute("SELECT COUNT(*) AS count FROM users"))[0].count, 1);
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  async function request(path, method = "GET", body, token, contentType = "application/json") {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { "Content-Type": contentType, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: Buffer.isBuffer(body) ? body : body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, headers: response.headers, data: response.headers.get("content-type")?.startsWith("image/") ? Buffer.from(await response.arrayBuffer()) : await response.json() };
  }
  const registration = { fullName: "MySQL Voter", email: " VOTER@example.com ", password: "voter-password", role: "admin", isApproved: true };
  // Two simultaneous registrations must produce only one account.
  const results = await Promise.all([request("/auth/register", "POST", registration), request("/auth/register", "POST", registration)]);
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
  const voter = results.find(result => result.status === 201).data.user;
  assert.equal(voter.email, "voter@example.com");
  assert.equal(voter.role, "voter");
  assert.equal(voter.isApproved, false);
  assert.equal(voter.passwordHash, undefined);
  assert.ok(User.isValidId(voter.id));
  const stored = await User.findByEmail(voter.email);
  assert.ok(await bcrypt.compare("voter-password", stored.passwordHash));
  await database.close();
  assert.equal((await User.findById(voter.id)).id, voter.id);
  await assert.rejects(User.create({ fullName: "Duplicate", email: "VOTER@example.com", passwordHash: stored.passwordHash }), { code: "ER_DUP_ENTRY" });
  assert.equal(await User.findByEmail("' OR 1=1 -- "), null);
  assert.equal((await request("/auth/login", "POST", { email: voter.email, password: "voter-password" })).status, 403);
  const login = await request("/auth/login", "POST", { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
  assert.equal(login.status, 200);
  const token = login.data.token;
  const list = await request("/admin/voters", "GET", undefined, token);
  assert.equal(list.status, 200);
  assert.equal(list.data.voters.length, 1);
  assert.equal(list.data.voters[0].id, voter.id);
  assert.equal(list.data.voters[0].passwordHash, undefined);
  assert.ok(Number.isFinite(Date.parse(list.data.voters[0].createdAt)));
  assert.ok(Math.abs(Date.now() - Date.parse(list.data.voters[0].createdAt)) < 60000);
  assert.equal((await request(`/admin/voters/${login.data.user.id}/approval`, "PATCH", { isApproved: true }, token)).status, 404);
  for (let repeat = 0; repeat < 2; repeat++) {
    const approval = await request(`/admin/voters/${voter.id}/approval`, "PATCH", { isApproved: true }, token);
    assert.equal(approval.status, 200);
    assert.equal(approval.data.voter.isApproved, true);
    assert.equal(approval.data.voter.passwordHash, undefined);
  }
  const voterLogin = await request("/auth/login", "POST", { email: voter.email, password: "voter-password" });
  assert.equal(voterLogin.status, 200);
  const profile = await request("/auth/me", "GET", undefined, voterLogin.data.token);
  assert.equal(profile.status, 200);
  assert.equal(profile.data.user.passwordHash, undefined);
  assert.equal((await request("/admin/voters", "GET", undefined, voterLogin.data.token)).status, 403);
  await require("./election-checks")(t, request, { token, voterId: voter.id, voterToken: voterLogin.data.token, adminId: login.data.user.id });
  assert.equal((await request(`/admin/voters/${voter.id}/approval`, "PATCH", { isApproved: false }, token)).status, 200);
  assert.equal((await request("/auth/me", "GET", undefined, voterLogin.data.token)).status, 403);
  assert.equal((await request("/elections", "GET", undefined, voterLogin.data.token)).status, 403);
  assert.equal((await request("/health")).data.database, "connected");
});
