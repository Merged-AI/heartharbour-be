import express from "express";
import { authenticateUser } from "../lib/auth";
import * as sessionController from "../controllers/sessionController";
import * as sessionsController from "../controllers/sessionsController";

const router = express.Router();

// GET /api/sessions - Get therapy sessions for a family/child
router.get("/", authenticateUser, sessionsController.getSessions);

// POST /api/sessions/completion-insights - Generate session completion insights
router.post(
  "/completion-insights",
  authenticateUser,
  sessionController.getCompletionInsights
);

export default router;
