import { Router } from "express";
import * as sessionsController from "../controllers/sessionsController.js";
import { authenticateUser } from "../lib/auth";

const router = Router();

// GET /api/sessions - Get all sessions
router.get("/", authenticateUser, sessionsController.getSessions);

// POST /api/sessions - Create new session
router.post("/", authenticateUser, sessionsController.createSession);

// GET /api/sessions/:sessionId - Get specific session
router.get("/:sessionId", authenticateUser, sessionsController.getSession);

// PUT /api/sessions/:sessionId - Update session
router.put("/:sessionId", authenticateUser, sessionsController.updateSession);

// DELETE /api/sessions/:sessionId - Delete session
router.delete(
  "/:sessionId",
  authenticateUser,
  sessionsController.deleteSession
);

export default router;
