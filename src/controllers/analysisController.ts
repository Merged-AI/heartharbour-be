import { Request, Response } from "express";
import * as analysisService from "../services/analysisService.js";

export const getDashboardAnalytics = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { childId } = req.query;

    if (!childId) {
      return res.status(400).json({ error: "Child ID is required" });
    }

    const result = await analysisService.getDashboardAnalytics(
      family.id,
      childId as string
    );

    if (!result.success) {
      return res.status(result.status || 500).json({
        error: result.error,
        message: result.message,
        code: result.code,
      });
    }

    res.json({
      data: result.data,
      message: result.message,
    });
  } catch (error) {
    console.error("Get dashboard analytics error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const updateDashboardAnalytics = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const childId = req.body.childId || req.query.childId;

    if (!childId) {
      return res.status(400).json({ error: "Child ID is required" });
    }

    const result = await analysisService.updateDashboardAnalytics(
      family.id,
      childId
    );

    if (!result.success) {
      return res.status(result.status || 500).json({
        error: result.error,
        details: result.details,
        message: result.message,
        code: result.code,
      });
    }

    res.json({
      data: result.data,
      status: result.analyticsStatus,
      message: result.message,
    });
  } catch (error) {
    console.error("Update dashboard analytics error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
