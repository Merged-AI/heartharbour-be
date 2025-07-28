import { Router } from "express";
import * as profileCheckController from "../controllers/profileCheckController.js";
import { authenticateUser } from "../lib/auth";

const router = Router();

// GET /api/profile-check - Check profile completion status
router.get("/", authenticateUser, profileCheckController.checkProfile);

export default router;
