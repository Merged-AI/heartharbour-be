import { Request, Response } from "express";
import * as sessionService from "../services/sessionService";

// Extend Request interface to include family property
declare global {
  namespace Express {
    interface Request {
      family?: {
        id: string;
        [key: string]: any;
      };
    }
  }
}

export const getCompletionInsights = async (req: Request, res: Response) => {
  try {
    const { childId } = req.body;
    const familyId = req.family?.id;

    if (!childId) {
      return res.status(400).json({ error: "Child ID is required" });
    }

    if (!familyId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const result = await sessionService.generateCompletionInsights(
      childId,
      familyId
    );

    res.json({
      success: true,
      insights: result.insights,
      childName: result.childName,
    });
  } catch (error: any) {
    console.error("❌ Error in getCompletionInsights controller:", error);
    res.status(500).json({
      error: "Failed to generate completion insights",
      message: error.message,
    });
  }
};
