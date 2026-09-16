const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const mysql = require("mysql2/promise");
const database = require("../database");
const { setupDatabase } = require("../scripts/setup-db");
const User = require("../models/User");

test("party role migration preserves legacy nominations and never overwrites later edits", async t => {
  const previous = process.env.MYSQL_DATABASE;
  const name = `securevote_test_${randomUUID().replaceAll("-", "")}`;
  process.env.MYSQL_DATABASE = name;
  const { database: ignored, ...options } = database.config();
  const connection = await mysql.createConnection(options);
  t.after(async () => {
    assert.match(name, /^securevote_test_[0-9a-f]{32}$/);
    await connection.query(`DROP DATABASE IF EXISTS \`${name}\``);
    await connection.end();
    if (previous === undefined) delete process.env.MYSQL_DATABASE;
    else process.env.MYSQL_DATABASE = previous;
  });
  await connection.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci`);
  await connection.changeUser({ database: name });
  const directory = path.join(__dirname, "../sql");
  for (const file of (await fs.readdir(directory)).filter(file => /^\d+_.*\.sql$/.test(file) && Number(file.slice(0, 3)) <= 19).sort()) {
    await connection.query(await fs.readFile(path.join(directory, file), "utf8"));
  }
  const [roles] = await connection.query("SELECT * FROM candidate_roles ORDER BY rank_order");
  const parties = [randomUUID(), randomUUID()];
  const nominees = [];
  for (const [index, partyId] of parties.entries()) {
    await connection.execute("INSERT INTO registered_parties (id, name, short_name, symbol, symbol_image, manifesto) VALUES (?, ?, '', 'Sun', ?, '')", [partyId, `Legacy party ${index}`, Buffer.from("fixture-image")]);
    for (const role of roles) {
      const id = randomUUID(); nominees.push(id);
      await connection.execute("INSERT INTO registered_candidates (id, party_id, role_id, full_name, biography) VALUES (?, ?, ?, 'Legacy nominee', 'Keep this statement')", [id, partyId, role.id]);
    }
    await connection.execute("INSERT INTO party_submissions (party_id) VALUES (?)", [partyId]);
  }
  await setupDatabase();
  const [migratedRoles] = await connection.query("SELECT * FROM party_candidate_roles");
  const [migratedNominees] = await connection.query("SELECT * FROM party_candidates");
  assert.equal(migratedRoles.length, 6);
  assert.ok(migratedRoles.every(role => User.isValidId(role.id)));
  assert.deepEqual(migratedNominees.map(c => c.id).sort(), nominees.sort());
  assert.ok(migratedNominees.every(c => c.biography === "Keep this statement" && migratedRoles.some(r => r.id === c.role_id && r.party_id === c.party_id)));
  assert.equal((await connection.query("SELECT * FROM party_submissions"))[0].length, 2);
  await connection.execute("UPDATE party_candidate_roles SET name = 'Chairperson' WHERE id = ?", [migratedRoles[0].id]);
  await setupDatabase();
  assert.equal((await connection.query("SELECT * FROM party_candidate_roles"))[0].length, 6);
  assert.equal((await connection.execute("SELECT name FROM party_candidate_roles WHERE id = ?", [migratedRoles[0].id]))[0][0].name, "Chairperson");
  assert.equal((await connection.query("SELECT * FROM party_candidates"))[0].length, 6);
});
