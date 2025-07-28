import { createServerSupabase } from '../lib/supabase';

interface UpdateProfileResult {
  success: boolean;
  error?: string;
  family?: any;
}

export async function getProfile(familyId: string) {
  try {
    const supabase = createServerSupabase();
    
    // Get family data
    const { data: family, error: familyError } = await supabase
      .from('families')
      .select('*')
      .eq('id', familyId)
      .single();

    if (familyError || !family) {
      throw new Error('Family not found');
    }

    // Get children data
    const { data: children, error: childrenError } = await supabase
      .from('children')
      .select('id, name, age, current_concerns')
      .eq('family_id', familyId)
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (childrenError) {
      console.error('Error fetching children:', childrenError);
      // Continue without children data rather than failing
    }

    return {
      family: {
        id: family.id,
        family_name: family.family_name,
        parent_name: family.parent_name,
        parent_email: family.parent_email,
        subscription_plan: family.subscription_plan,
        subscription_status: family.subscription_status,
        trial_ends_at: family.trial_ends_at,
        created_at: family.created_at
      },
      children: children || []
    };

  } catch (error) {
    console.error('Error getting profile:', error);
    throw error;
  }
}

export async function updateProfile(familyId: string, parentName: string, familyName: string): Promise<UpdateProfileResult> {
  try {
    const supabase = createServerSupabase();
    
    // Update the family information in the database
    const { data, error } = await supabase
      .from('families')
      .update({
        parent_name: parentName,
        family_name: familyName,
      })
      .eq('id', familyId)
      .select()
      .single();

    if (error) {
      console.error('Profile update error:', error);
      return { success: false, error: 'Failed to update profile' };
    }

    return {
      success: true,
      family: {
        parent_name: data.parent_name,
        family_name: data.family_name,
        children: data.children || [],
      }
    };

  } catch (error) {
    console.error('Profile update error:', error);
    return { success: false, error: 'Internal server error' };
  }
} 