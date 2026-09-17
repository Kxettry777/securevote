const express = require("express");
const Election = require("../models/Election");
const User = require("../models/User");
const { normalizeBanner } = require("../media/banner");
const { requireAuth, requireRole } = require("../middleware/auth");
const router = express.Router();
router.use(requireAuth, requireRole("admin", "voter", "auditor", "candidate", "party"));

function text(value, label, minimum, maximum) {
  if (typeof value !== "string" || value.trim().length < minimum || value.trim().length > maximum) {
    throw new Election.ElectionError(400, `${label} must be between ${minimum} and ${maximum} characters`);
  }
  return value.trim();
}

function electionInput(body = {}) {
  const title = text(body?.title, "Title", 3, 120);
  const description = text(body?.description ?? "", "Description", 0, 4000);
  const dates = [body?.startsAt, body?.endsAt].map(value => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
      throw new Election.ElectionError(400, "Supply valid UTC dates in ISO format");
    }
    const date = new Date(value);
    if (!Number.isFinite(date.getTime()) || date.toISOString() !== value || date.getUTCFullYear() < 1000) {
      throw new Election.ElectionError(400, "Supply valid election dates");
    }
    return date;
  });
  if (dates[1] <= dates[0]) throw new Election.ElectionError(400, "The end time must be after the start time");
  return { title, description, startsAt: dates[0], endsAt: dates[1] };
}

function partyIds(value) {
  if (!Array.isArray(value) || value.length < 2 || value.length > 100 || new Set(value).size !== value.length || value.some(id => !User.isValidId(id))) {
    throw new Election.ElectionError(400, "Select between 2 and 100 distinct registered parties");
  }
  return value;
}

function candidateInput(body = {}) {
  return { name: text(body?.name, "Party name", 2, 120), manifesto: text(body?.manifesto ?? "", "Manifesto", 0, 4000),
    shortName: text(body?.shortName ?? "", "Party abbreviation", 0, 16), symbol: text(body?.symbol ?? "", "Election symbol", 0, 60) };
}

const handle = action => async (req, res) => {
  try { await action(req, res); }
  catch (error) {
    if (error instanceof Election.ElectionError) return res.status(error.status).json({ message: error.message });
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "This party name or voter assignment already exists in the election" });
    console.error("Election request failed:", error.code || error.message);
    return res.status(500).json({ message: "The election request could not be completed" });
  }
};

for (const parameter of ["id", "candidateId", "voterId"]) {
  router.param(parameter, (req, res, next, value) => {
    if (!User.isValidId(value)) return res.status(400).json({ message: "Invalid identifier" });
    next();
  });
}

router.get("/", handle(async (req, res) => {
  if (req.query.removed !== undefined) throw new Election.ElectionError(400, "Removed elections are no longer available");
  res.json({ elections: await Election.list(req.account) });
}));
router.delete("/:id", requireRole("admin"), handle(async (req, res) => {
  if (req.body?.confirmation !== "DELETE") throw new Election.ElectionError(400, "Type DELETE to confirm permanent election deletion");
  await Election.remove(req.params.id, req.account);
  res.json({ message: "Election permanently deleted" });
}));
router.get("/:id", handle(async (req, res) => res.json(await Election.detail(req.params.id, req.account))));
router.post("/", requireRole("admin"), handle(async (req, res) => res.status(201).json(await Election.create({ ...electionInput(req.body), partyIds: partyIds(req.body?.partyIds) }, req.account))));
router.patch("/:id", requireRole("admin"), handle(async (req, res) => res.json(await Election.update(req.params.id, electionInput(req.body), req.account))));
router.get("/:id/banner", handle(async (req, res) => {
  const image = await Election.banner(req.params.id, req.account);
  res.set({ "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" }).send(image);
}));
router.put("/:id/banner", requireRole("admin"), express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "4mb" }), handle(async (req, res) => {
  const image = await normalizeBanner(req.body, req.get("Content-Type")?.split(";")[0].trim().toLowerCase());
  res.json(await Election.saveBanner(req.params.id, image, req.account));
}));
router.delete("/:id/banner", requireRole("admin"), handle(async (req, res) => res.json(await Election.saveBanner(req.params.id, null, req.account))));
// Party endpoints use the existing immutable ballot IDs so old receipts stay valid.
router.param("partyId", (req, res, next, value) => User.isValidId(value) ? next() : res.status(400).json({ message: "Invalid party identifier" }));
router.post("/:id/parties", requireRole("admin"), handle(async (req, res) => res.status(201).json({ party: await Election.saveCandidate(req.params.id, null, candidateInput(req.body), req.account) })));
router.patch("/:id/parties/:partyId", requireRole("admin"), handle(async (req, res) => res.json({ party: await Election.saveCandidate(req.params.id, req.params.partyId, candidateInput(req.body), req.account) })));
router.delete("/:id/parties/:partyId", requireRole("admin"), handle(async (req, res) => {
  await Election.removeCandidate(req.params.id, req.params.partyId, req.account);
  res.json({ message: "Party removed" });
}));
router.post("/:id/candidates", requireRole("admin"), handle(async (req, res) => res.status(201).json({ candidate: await Election.saveCandidate(req.params.id, null, candidateInput(req.body), req.account) })));
router.patch("/:id/candidates/:candidateId", requireRole("admin"), handle(async (req, res) => res.json({ candidate: await Election.saveCandidate(req.params.id, req.params.candidateId, candidateInput(req.body), req.account) })));
router.delete("/:id/candidates/:candidateId", requireRole("admin"), handle(async (req, res) => {
  await Election.removeCandidate(req.params.id, req.params.candidateId, req.account);
  res.json({ message: "Party removed" });
}));
router.post("/:id/voters", requireRole("admin"), handle(async (req, res) => {
  if (!User.isValidId(req.body?.voterId)) throw new Election.ElectionError(400, "Invalid voter ID");
  await Election.assignVoter(req.params.id, req.body.voterId, req.account);
  res.status(201).json({ message: "Voter assigned" });
}));
router.delete("/:id/voters/:voterId", requireRole("admin"), handle(async (req, res) => {
  await Election.removeVoter(req.params.id, req.params.voterId, req.account);
  res.json({ message: "Voter assignment removed" });
}));

module.exports = router;
