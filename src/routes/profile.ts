import { Router } from "express";
import * as profileController from "../controllers/profileController.js";
import { authenticateUser } from "../lib/auth";

const router = Router();

// GET /api/profile - Get user profile
router.get("/", authenticateUser, profileController.getProfile);

// POST /api/profile/update - Update user profile
router.post("/update", authenticateUser, profileController.updateProfile);

export default router;
