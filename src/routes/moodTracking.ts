import { Router } from "express";
import * as moodTrackingController from "../controllers/moodTrackingController.js";
import { authenticateUser } from "../lib/auth";

const router = Router();

// GET /api/mood-tracking - Get mood tracking data
router.get("/", authenticateUser, moodTrackingController.getMoodData);

// POST /api/mood-tracking - Record mood data
router.post("/", authenticateUser, moodTrackingController.recordMood);

// PUT /api/mood-tracking/:moodId - Update mood entry
router.put("/:moodId", authenticateUser, moodTrackingController.updateMood);

// DELETE /api/mood-tracking/:moodId - Delete mood entry
router.delete("/:moodId", authenticateUser, moodTrackingController.deleteMood);

// PATCH /api/mood-tracking/analyze - Quick mood analysis (doesn't save)
router.patch(
  "/analyze",
  authenticateUser,
  moodTrackingController.analyzeMoodQuick
);

// DELETE /api/mood-tracking/reanalyze - Force re-analyze all entries
router.delete(
  "/reanalyze",
  authenticateUser,
  moodTrackingController.reanalyzeMoodEntries
);

export default router;
