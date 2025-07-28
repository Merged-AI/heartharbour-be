import { Request, Response } from 'express';
import * as profileCheckService from '../services/profileCheckService.js';

export const checkProfile = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;
    
    if (!family) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { childId } = req.query;

    const result = await profileCheckService.checkProfile(
      family.id,
      childId as string | undefined
    );

    if (!result.success) {
      return res.status(result.status || 500).json({
        error: result.error,
        requiresChildRegistration: result.requiresChildRegistration,
        requiresProfileCompletion: result.requiresProfileCompletion,
        childId: result.childId,
        message: result.message
      });
    }

    res.json({
      success: true,
      child: result.child,
      children: result.children
    });

  } catch (error) {
    console.error('Profile check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}; 