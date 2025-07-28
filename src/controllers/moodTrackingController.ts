import { Request, Response } from 'express';
import * as moodTrackingService from '../services/moodTrackingService.js';

export const getMoodData = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;
    
    if (!family) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { days, childId, forceRefresh, forceAll } = req.query;
    
    if (!childId) {
      return res.status(400).json({ error: 'Child ID is required' });
    }

    const result = await moodTrackingService.getMoodData(
      family.id,
      childId as string,
      parseInt(days as string) || 7,
      forceRefresh === 'true',
      forceAll === 'true'
    );

    if (!result.success) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    res.json(result.data);

  } catch (error) {
    console.error('Get mood data error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const recordMood = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;
    
    if (!family) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const {
      childId,
      happiness,
      anxiety,
      sadness,
      stress,
      confidence,
      notes,
      moodDescription
    } = req.body;

    if (!childId) {
      return res.status(400).json({ error: 'Child ID is required' });
    }

    const result = await moodTrackingService.recordMood(
      family.id,
      childId,
      { happiness, anxiety, sadness, stress, confidence },
      notes,
      moodDescription
    );

    if (!result.success) {
      return res.status(result.status || 500).json({ 
        error: result.error,
        details: result.details 
      });
    }

    res.json({
      success: true,
      moodEntry: result.moodEntry,
      moodAnalysis: result.moodAnalysis,
      aiAnalysis: result.aiAnalysis,
      has_alert: result.has_alert,
      alert_level: result.alert_level,
      alert_message: result.alert_message,
      message: result.message
    });

  } catch (error) {
    console.error('Record mood error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateMood = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;
    const { moodId } = req.params;
    
    if (!family) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const {
      childId,
      happiness,
      anxiety,
      sadness,
      stress,
      confidence,
      notes,
      moodDescription
    } = req.body;

    if (!childId) {
      return res.status(400).json({ error: 'Child ID is required' });
    }

    const result = await moodTrackingService.updateMood(
      family.id,
      childId,
      moodId,
      { happiness, anxiety, sadness, stress, confidence },
      notes,
      moodDescription
    );

    if (!result.success) {
      return res.status(result.status || 500).json({ 
        error: result.error,
        details: result.details 
      });
    }

    res.json({
      success: true,
      moodEntry: result.moodEntry,
      moodAnalysis: result.moodAnalysis,
      aiAnalysis: result.aiAnalysis,
      has_alert: result.has_alert,
      alert_level: result.alert_level,
      alert_message: result.alert_message,
      message: result.message
    });

  } catch (error) {
    console.error('Update mood error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteMood = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;
    const { moodId } = req.params;
    const { childId } = req.query;
    
    if (!family) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!childId) {
      return res.status(400).json({ error: 'Child ID is required' });
    }

    const result = await moodTrackingService.deleteMood(
      family.id,
      childId as string,
      moodId
    );

    if (!result.success) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    res.json({
      success: true,
      message: result.message
    });

  } catch (error) {
    console.error('Delete mood error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const analyzeMoodQuick = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;
    
    if (!family) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { childId, moodDescription } = req.body;

    if (!childId || !moodDescription) {
      return res.status(400).json({ error: 'Child ID and mood description are required' });
    }

    const result = await moodTrackingService.analyzeMoodQuick(
      family.id,
      childId,
      moodDescription
    );

    if (!result.success) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    res.json({
      success: true,
      child: result.child,
      moodAnalysis: result.moodAnalysis,
      has_alert: result.has_alert,
      alert_level: result.alert_level,
      alert_message: result.alert_message,
      message: result.message
    });

  } catch (error) {
    console.error('Quick mood analysis error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const reanalyzeMoodEntries = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;
    const { childId } = req.query;
    
    if (!family) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!childId) {
      return res.status(400).json({ error: 'Child ID is required' });
    }

    const result = await moodTrackingService.reanalyzeMoodEntries(
      family.id,
      childId as string
    );

    if (!result.success) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    res.json({
      success: true,
      message: result.message,
      results: result.results,
      totalEntries: result.totalEntries,
      reanalyzedCount: result.reanalyzedCount
    });

  } catch (error) {
    console.error('Reanalyze mood entries error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}; 