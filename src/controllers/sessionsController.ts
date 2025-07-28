import { Request, Response } from "express";
import * as sessionsService from "../services/sessionsService.js";

export const getSessions = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const limit = parseInt(req.query.limit as string) || 50;
    const childId = req.query.childId as string;

    const result = await sessionsService.getSessions(family.id, limit, childId);

    if (!result.success) {
      return res.status(result.status || 500).json({
        error: result.error,
      });
    }

    res.json({
      success: true,
      sessions: result.sessions,
    });
  } catch (error) {
    console.error("Get sessions error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const createSession = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { childId, messages, moodAnalysis, sessionSummary } = req.body;

    if (!childId || !messages) {
      return res.status(400).json({
        error: "Child ID and messages are required",
      });
    }

    const result = await sessionsService.createSession(
      family.id,
      childId,
      messages,
      moodAnalysis,
      sessionSummary
    );

    if (!result.success) {
      return res.status(result.status || 500).json({
        error: result.error,
      });
    }

    res.json({
      success: true,
      session: result.session,
    });
  } catch (error) {
    console.error("Create session error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getSession = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { sessionId } = req.params;

    const result = await sessionsService.getSession(family.id, sessionId);

    if (!result.success) {
      return res.status(result.status || 500).json({
        error: result.error,
      });
    }

    res.json({
      success: true,
      session: result.session,
    });
  } catch (error) {
    console.error("Get session error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const updateSession = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { sessionId } = req.params;
    const updates = req.body;

    const result = await sessionsService.updateSession(
      family.id,
      sessionId,
      updates
    );

    if (!result.success) {
      return res.status(result.status || 500).json({
        error: result.error,
      });
    }

    res.json({
      success: true,
      session: result.session,
    });
  } catch (error) {
    console.error("Update session error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const deleteSession = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { sessionId } = req.params;

    const result = await sessionsService.deleteSession(family.id, sessionId);

    if (!result.success) {
      return res.status(result.status || 500).json({
        error: result.error,
      });
    }

    res.json({
      success: true,
      message: "Session deleted successfully",
    });
  } catch (error) {
    console.error("Delete session error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
