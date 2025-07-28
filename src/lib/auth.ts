import { Request } from 'express';
import { createServerSupabase } from './supabase.js';

// Custom authentication function that works with auth_token cookie
export async function getAuthenticatedFamilyFromToken(req: Request) {
  const authToken = req.cookies?.auth_token;

  if (!authToken) {
    return null;
  }

  try {
    // Decode the token to get family ID
    const decoded = Buffer.from(authToken, 'base64').toString('utf-8');
    const [familyId] = decoded.split(':');
    
    if (!familyId) {
      return null;
    }

    // Fetch family data from database
    const supabase = createServerSupabase();
    const { data: family, error } = await supabase
      .from('families')
      .select('*')
      .eq('id', familyId)
      .single();

    if (error || !family) {
      return null;
    }

    return family;
  } catch (error) {
    console.error('Error decoding auth token:', error);
    return null;
  }
}

// Authentication middleware
export const authenticateUser = async (req: Request, res: any, next: any) => {
  try {
    const family = await getAuthenticatedFamilyFromToken(req);
    
    if (!family) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Attach family to request object
    (req as any).family = family;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}; 