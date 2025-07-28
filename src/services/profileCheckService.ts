import { createServerSupabase } from "../lib/supabase.js";

interface ProfileCheckResult {
  success: boolean;
  error?: string;
  status?: number;
  requiresChildRegistration?: boolean;
  requiresProfileCompletion?: boolean;
  childId?: string;
  message?: string;
  child?: {
    id: string;
    name: string;
    profileCompleted: boolean;
  };
  children?: Array<{
    id: string;
    name: string;
    profileCompleted: boolean;
  }>;
}

export async function checkProfile(
  familyId: string,
  childId?: string
): Promise<ProfileCheckResult> {
  try {
    const supabase = createServerSupabase();

    // If childId is provided, check that specific child
    if (childId) {
      const { data: child, error: childError } = await supabase
        .from("children")
        .select("id, name, profile_completed, family_id")
        .eq("id", childId)
        .eq("family_id", familyId)
        .eq("is_active", true)
        .single();

      if (childError || !child) {
        return {
          success: false,
          error: "Child not found",
          status: 404,
        };
      }

      if (!child.profile_completed) {
        return {
          success: false,
          requiresProfileCompletion: true,
          childId: child.id,
          message: "Child profile needs completion",
          status: 422,
        };
      }

      return {
        success: true,
        child: {
          id: child.id,
          name: child.name,
          profileCompleted: child.profile_completed,
        },
      };
    }

    // If no childId, check if family has any children with completed profiles
    const { data: children, error: childrenError } = await supabase
      .from("children")
      .select("id, name, profile_completed")
      .eq("family_id", familyId)
      .eq("is_active", true)
      .order("created_at", { ascending: true });

    if (childrenError) {
      return {
        success: false,
        error: "Failed to check children",
        status: 500,
      };
    }

    if (!children || children.length === 0) {
      return {
        success: false,
        requiresChildRegistration: true,
        message: "No children found. Please add a child first.",
        status: 404,
      };
    }

    // Check if any child has a completed profile
    const childWithProfile = children.find((child) => child.profile_completed);

    if (!childWithProfile) {
      return {
        success: false,
        requiresProfileCompletion: true,
        childId: children[0].id, // Return first child for profile completion
        message: "Child profile needs completion",
        status: 422,
      };
    }

    return {
      success: true,
      children: children.map((child) => ({
        id: child.id,
        name: child.name,
        profileCompleted: child.profile_completed,
      })),
    };
  } catch (error) {
    console.error("Error in checkProfile service:", error);
    return {
      success: false,
      error: "Internal server error",
      status: 500,
    };
  }
}
