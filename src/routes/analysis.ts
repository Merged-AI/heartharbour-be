import { Router } from "express";
import * as analysisController from "../controllers/analysisController.js";
import { authenticateUser } from "../lib/auth";

const router = Router();

// GET /api/analysis/dashboard-analytics - Get dashboard analytics data
router.get(
  "/dashboard-analytics",
  authenticateUser,
  analysisController.getDashboardAnalytics
);

// POST /api/analysis/dashboard-analytics - Update/recalculate dashboard analytics
router.post(
  "/dashboard-analytics",
  authenticateUser,
  analysisController.updateDashboardAnalytics
);

export default router;
