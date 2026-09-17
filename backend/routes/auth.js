const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Enrollment = require("../models/Enrollment");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function createToken(user) {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }

  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "2h" },
  );
}

function publicUser(user) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    isApproved: user.isApproved,
  };
}

// Public enrollment is deliberately disabled, including for authenticated users.
router.post("/register", (req, res) => res.status(403).json({
  message: "Voter enrollment is managed by the election commission. Contact your administrator for an activation link.",
}));

router.post("/activate", async (req, res) => {
  const { token, password } = req.body ?? {};
  if (!Enrollment.validToken(token)) return res.status(400).json({ message: "This activation link is invalid or expired. Ask the election commission for a new link." });
  if (typeof password !== "string" || password.length < 8 || Buffer.byteLength(password, "utf8") > 72) return res.status(400).json({ message: "Password must be at least 8 characters and at most 72 UTF-8 bytes" });
  try {
    const result = await Enrollment.activate(token, await bcrypt.hash(password, 12));
    if (!result) return res.status(400).json({ message: "This activation link is invalid, expired, or already used. Ask the election commission for a new link." });
    res.json({ message: result.isApproved ? "Account activated. You can now sign in." : "Account activated. The election commission must approve your account before you can sign in." });
  } catch { res.status(500).json({ message: "Activation could not be completed. Please try again." }); }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body ?? {};

    if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password || Buffer.byteLength(password, "utf8") > 72) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findByEmail(normalizedEmail);
    const passwordMatches =
      user && (await bcrypt.compare(password, user.passwordHash));

    if (!user || !passwordMatches || user.activationPending) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (user.role === "party" && !await User.hasActiveParty(user.id)) {
      return res.status(403).json({ message: "This party registration is no longer active. Contact your administrator." });
    }

    if (user.role === "voter" && !user.isApproved) {
      return res
        .status(403)
        .json({ message: "Your account is awaiting admin approval" });
    }

    return res.json({ token: createToken(user), user: publicUser(user) });
  } catch (error) {
    console.error("Login failed:", error.message);
    return res.status(500).json({ message: "Login could not be completed" });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = req.account;

    if (!user) {
      return res.status(404).json({ message: "User account not found" });
    }

    return res.json({ user: publicUser(user) });
  } catch (error) {
    console.error("Profile lookup failed:", error.message);
    return res.status(500).json({ message: "Profile could not be loaded" });
  }
});

module.exports = router;
