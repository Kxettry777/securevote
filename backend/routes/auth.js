const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
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

router.post("/register", async (req, res) => {
  try {
    const { fullName, email, password } = req.body ?? {};

    if (typeof fullName !== "string" || typeof email !== "string" || typeof password !== "string") {
      return res
        .status(400)
        .json({ message: "Full name, email, and password are required" });
    }

    if (fullName.trim().length < 2 || fullName.trim().length > 80) {
      return res.status(400).json({ message: "Full name must be between 2 and 80 characters" });
    }
    if (email.trim().length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ message: "Enter a valid email address" });
    }
    if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
      return res
        .status(400)
        .json({ message: "Password must be at least 8 characters and at most 72 UTF-8 bytes" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await User.findByEmail(normalizedEmail);

    if (existingUser) {
      return res
        .status(409)
        .json({ message: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      fullName: fullName.trim(),
      email: normalizedEmail,
      passwordHash,
      role: "voter",
      isApproved: false,
    });

    return res.status(201).json({
      message: "Registration submitted for admin approval",
      user: publicUser(user),
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "An account with this email already exists" });
    }
    console.error("Registration failed:", error.message);
    return res
      .status(500)
      .json({ message: "Registration could not be completed" });
  }
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

    if (!user || !passwordMatches) {
      return res.status(401).json({ message: "Invalid email or password" });
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
