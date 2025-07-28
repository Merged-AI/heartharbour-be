import { Router } from "express";
import * as authController from "../controllers/authController.js";
import { authenticateUser } from "../lib/auth";

const router = Router();

// POST /api/auth/login - User login
router.post("/login", authController.login);

// POST /api/auth/logout - User logout
router.post("/logout", authController.logout);

// POST /api/auth/auto-login - Auto login functionality
router.post("/auto-login", authController.autoLogin);

// POST /api/auth/check-user - Check if user exists
router.post("/check-user", authController.checkUser);

// GET /api/auth/me - Get current user and family data
router.get("/me", authenticateUser, authController.getCurrentUser);

// PIN management routes
router.get("/pin", authenticateUser, authController.testPin);
router.post("/pin", authenticateUser, authController.setPin);
router.put("/pin", authenticateUser, authController.updatePin);
router.post("/pin/validate", authenticateUser, authController.validatePin);

export default router;
