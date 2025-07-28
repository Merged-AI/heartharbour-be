import { Router } from "express";
import * as chatController from "../controllers/chatController.js";
import { authenticateUser } from "../lib/auth";

const router = Router();

// POST /api/chat - Main chat endpoint
router.post("/", authenticateUser, chatController.sendMessage);

// GET /api/chat/child-context - Get child context for chat
router.get("/child-context", authenticateUser, chatController.getChildContext);

// POST /api/chat/voice - Voice chat endpoint
router.post("/voice", authenticateUser, chatController.handleVoiceChat);

// POST /api/chat/realtime-proxy - Realtime chat proxy
router.post("/realtime-proxy", authenticateUser, chatController.realtimeProxy);

// Chat sessions routes
router.get("/sessions", authenticateUser, chatController.getChatSessions);
router.post(
  "/sessions/complete",
  authenticateUser,
  chatController.completeSession
);

export default router;
