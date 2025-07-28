import { Request, Response } from 'express';
import * as profileService from '../services/profileService.js';

export const getProfile = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;
    
    if (!family) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const profileData = await profileService.getProfile(family.id);
    res.json(profileData);

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateProfile = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;
    const { parent_name, family_name } = req.body;

    if (!family) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Validate input
    if (!parent_name || !family_name) {
      return res.status(400).json({ 
        error: 'Parent name and family name are required' 
      });
    }

    const result = await profileService.updateProfile(
      family.id, 
      parent_name.trim(), 
      family_name.trim()
    );
    
    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json({
      message: 'Profile updated successfully',
      family: result.family
    });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}; 