const assert = require("node:assert/strict");
const sharp = require("sharp");

module.exports = async function registeredParties(request, adminToken, count = 2) {
  const image = await sharp({ create: { width: 48, height: 48, channels: 3, background: "#24568e" } }).png().toBuffer();
  const symbolImage = `data:image/png;base64,${image.toString("base64")}`;
  const registry = await request("/registry", "GET", undefined, adminToken);
  assert.equal(registry.status, 200);
  const parties = [];
  for (let index = 0; index < count; index++) {
    const body = { name: `Party ${index + 1}`, shortName: `P${index + 1}`, symbol: "Sun", symbolImage, email: `party${index + 1}@example.com`, password: "party-password", manifesto: "Our party manifesto" };
    const created = await request("/registry/parties", "POST", body, adminToken);
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const login = await request("/auth/login", "POST", { email: body.email, password: body.password });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.role, "party");
    const party = { ...body, id: created.data.id, token: login.data.token, user: login.data.user, candidates: [] };
    party.roles = (await request("/registry", "GET", undefined, party.token)).data.roles;
    for (const role of party.roles) {
      const nominee = { partyId: party.id, roleId: role.id, fullName: `Nominee ${index + 1} ${role.name}`, biography: "Candidate statement" };
      const result = await request("/registry/candidates", "POST", nominee, party.token);
      assert.equal(result.status, 201, JSON.stringify(result.data));
      party.candidates.push({ ...nominee, id: result.data.id });
    }
    assert.equal((await request("/registry/submit", "POST", {}, party.token)).status, 200);
    parties.push(party);
  }
  return { parties, roles: parties[0].roles, symbolImage };
};
