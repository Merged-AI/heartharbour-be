import { Request, Response } from "express";
import * as chatService from "../services/chatService.js";

export const sendMessage = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { message, history, childId } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    if (!childId) {
      return res.status(400).json({ error: "Child ID is required" });
    }

    const result = await chatService.processMessage(
      family.id,
      childId,
      message,
      history
    );

    if (!result.success) {
      return res.status(result.status || 500).json({
        error: result.error,
        requiresSubscription: result.requiresSubscription,
        feature: result.feature,
        requiresProfileCompletion: result.requiresProfileCompletion,
        childId: result.childId,
      });
    }

    res.json({
      response: result.response,
      moodAnalysis: result.moodAnalysis,
      crisis: result.crisis,
    });
  } catch (error) {
    console.error("Send message error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getChildContext = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { childId } = req.query;

    if (!childId) {
      return res.status(400).json({ error: "Child ID is required" });
    }

    const result = await chatService.getChildContext(
      family.id,
      childId as string
    );

    if (!result.success) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    res.json({
      success: true,
      childContext: result.childContext,
    });
  } catch (error) {
    console.error("Get child context error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const handleVoiceChat = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { audioData, childId, sessionId, messageHistory = [] } = req.body;

    if (!audioData) {
      return res.status(400).json({ error: "Audio data is required" });
    }

    if (!childId) {
      return res.status(400).json({ error: "Child ID is required" });
    }

    const result = await chatService.processVoiceMessage(
      family.id,
      childId,
      audioData,
      sessionId,
      messageHistory
    );

    if (!result.success) {
      return res.status(result.status || 500).json({
        error: result.error,
        requiresSubscription: result.requiresSubscription,
        feature: result.feature,
        requiresProfileCompletion: result.requiresProfileCompletion,
        childId: result.childId,
        details: result.details,
      });
    }

    res.json({
      success: true,
      transcribedText: result.transcribedText,
      aiResponse: result.aiResponse,
      audioResponse: result.audioResponse,
      useClientTTS: result.useClientTTS,
      sessionId: result.sessionId,
      timestamp: result.timestamp,
      isEmpty: result.isEmpty,
      crisis: result.crisis,
    });
  } catch (error) {
    console.error("Voice chat error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const realtimeProxy = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { event, childId, data } = req.body;

    if (!childId) {
      return res.status(400).json({ error: "Child ID is required" });
    }

    const result = await chatService.handleRealtimeEvent(
      family.id,
      childId,
      event,
      data
    );

    if (!result.success) {
      return res.status(result.status || 500).json({
        error: result.error,
        requiresSubscription: result.requiresSubscription,
        feature: result.feature,
      });
    }

    res.json({
      success: true,
      response: result.response,
      sessionId: result.sessionId,
      timestamp: result.timestamp,
    });
  } catch (error) {
    console.error("Realtime proxy error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getChatSessions = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { childId, page, pageSize } = req.query;

    if (!childId) {
      return res.status(400).json({ error: "Child ID is required" });
    }

    const result = await chatService.getChatSessions(
      family.id,
      childId as string,
      parseInt(page as string) || 1,
      parseInt(pageSize as string) || 5
    );

    if (!result.success) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    res.json({
      sessions: result.sessions,
      pagination: result.pagination,
      child: result.child,
    });
  } catch (error) {
    console.error("Get chat sessions error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const completeSession = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const { childId, sessionDuration } = req.body;

    if (!childId) {
      return res.status(400).json({ error: "Child ID is required" });
    }

    const result = await chatService.completeSessionsForChild(
      family.id,
      childId,
      sessionDuration
    );

    if (!result.success) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Complete session error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
