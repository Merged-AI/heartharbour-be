import express from "express";
import {
  sendWeeklyProgressEmails,
  sendTestProgressEmail,
  testEmail,
  scheduleWeeklyEmails,
} from "../controllers/emailController";

const router = express.Router();

// Send weekly progress emails
router.post("/weekly-progress", sendWeeklyProgressEmails);

// Send test email
router.post("/test", sendTestProgressEmail);

// Test email connection
router.get("/test-connection", testEmail);

// Schedule weekly emails (for cron jobs)
router.post("/schedule-weekly", scheduleWeeklyEmails);

// Manual trigger for scheduler (GET for easy testing)
router.get("/schedule-weekly", scheduleWeeklyEmails);

export default router;
