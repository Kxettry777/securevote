const express = require("express");
const User = require("../models/User");
const Audit = require("../models/Audit");
const Enrollment = require("../models/Enrollment");
const Dashboard = require("../models/Dashboard");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth, requireRole("admin"));

router.get("/dashboard", async (req, res) => {
  try { res.json(await Dashboard.overview()); }
  catch { res.status(503).json({ message: "The dashboard could not be loaded. Please try again." }); }
});

const validAuditId = value => typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value);
router.delete("/audit/:id", async (req, res) => {
  if (!validAuditId(req.params.id) || req.body?.confirmation !== "DELETE") return res.status(400).json({ message: "Supply a valid audit entry and type DELETE to confirm" });
  try {
    const deleted = await Audit.remove(req.params.id);
    res.status(deleted ? 200 : 404).json({ message: deleted ? "Audit entry deleted" : "Audit entry not found", deleted });
  } catch { res.status(503).json({ message: "The audit entry could not be deleted" }); }
});
router.delete("/audit", async (req, res) => {
  if (!validAuditId(req.body?.throughId) || req.body?.confirmation !== "DELETE") return res.status(400).json({ message: "Refresh the audit log and type DELETE to confirm" });
  try { res.json({ message: "Audit history deleted", deleted: await Audit.clear(req.body.throughId) }); }
  catch { res.status(503).json({ message: "The audit history could not be deleted" }); }
});

router.post("/voters", async (req, res) => {
  const { fullName, email, institutionalId, isApproved } = req.body ?? {};
  if (typeof fullName !== "string" || fullName.trim().length < 2 || fullName.trim().length > 80) return res.status(400).json({ message: "Full name must be between 2 and 80 characters" });
  if (typeof email !== "string" || email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return res.status(400).json({ message: "Enter a valid email address" });
  if (typeof institutionalId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]{1,63}$/.test(institutionalId.trim())) return res.status(400).json({ message: "Enter an institutional ID of 2–64 letters, numbers, dots, slashes, underscores, or hyphens" });
  if (req.body.password !== undefined) return res.status(400).json({ message: "Voters must set their own password through activation" });
  if (typeof isApproved !== "boolean") return res.status(400).json({ message: "Choose whether the voter is approved" });
  try {
    const result = await Enrollment.enroll({ fullName, email, institutionalId, isApproved }, req.account);
    res.status(201).json({ ...result, message: "Voter enrolled. Share the activation link with the voter." });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ message: "An account with this email or institutional ID already exists" });
    res.status(500).json({ message: "The voter could not be registered" });
  }
});

router.post("/voters/:id/activation", async (req, res) => {
  if (!User.isValidId(req.params.id)) return res.status(400).json({ message: "Invalid voter ID" });
  try {
    const activation = await Enrollment.reissue(req.params.id, req.account);
    if (!activation) return res.status(409).json({ message: "This voter is already activated or has no pending enrollment. Refresh the voter list." });
    res.json({ activation, message: "New activation link created. The previous link is no longer valid." });
  } catch { res.status(500).json({ message: "The activation link could not be created" }); }
});

router.get("/audit", async (req, res) => {
  const before = req.query.before;
  if (before !== undefined && (typeof before !== "string" || !/^[1-9][0-9]{0,18}$/.test(before))) return res.status(400).json({ message: "Invalid audit cursor" });
  try { res.json(await Audit.list(before)); }
  catch { res.status(503).json({ message: "The audit log is unavailable" }); }
});

router.get("/voters", async (req, res) => {
  try {
    const voters = await User.listVoters();

    return res.json({ voters });
  } catch (error) {
    console.error("Voter list failed:", error.message);
    return res.status(500).json({ message: "Voters could not be loaded" });
  }
});

router.patch("/voters/:id/approval", async (req, res) => {
  try {
    const { isApproved } = req.body ?? {};

    if (!User.isValidId(req.params.id)) {
      return res.status(400).json({ message: "Invalid voter ID" });
    }

    if (typeof isApproved !== "boolean") {
      return res.status(400).json({ message: "isApproved must be a boolean" });
    }

    const voter = await User.setVoterApproval(req.params.id, isApproved, req.account);

    if (!voter) {
      return res.status(404).json({ message: "Voter not found" });
    }

    return res.json({
      message: isApproved ? "Voter approved" : "Voter approval revoked",
      voter,
    });
  } catch (error) {
    console.error("Voter approval update failed:", error.message);
    return res
      .status(500)
      .json({ message: "Voter approval could not be updated" });
  }
});

module.exports = router;
