import { createClient } from "@supabase/supabase-js";
import { createServerSupabase } from "../lib/supabase";

export interface Family {
  id: string;
  family_name: string;
  parent_name: string;
  parent_email: string;
  subscription_plan: string;
  subscription_status: string;
  trial_ends_at: string;
  created_at: string;
}

export interface Child {
  id: string;
  name: string;
  age: number;
  current_concerns: string;
}

export interface UserData {
  family: Family;
  children: Child[];
}

interface AuthResult {
  success: boolean;
  error?: string;
  status?: number;
  sessionToken?: string;
  family?: any;
  user?: any;
}

interface CheckUserResult {
  success: boolean;
  exists: boolean;
  userId?: string;
  familyId?: string;
  email?: string;
  message: string;
}

function generateSessionToken(familyId: string): string {
  // In a production app, use proper JWT or secure session tokens
  return Buffer.from(`${familyId}:${Date.now()}`).toString("base64");
}

export async function login(
  email: string,
  password: string
): Promise<AuthResult> {
  try {
    const supabase = createServerSupabase();

    // Sign in with Supabase Auth
    const { data: authData, error: authError } =
      await supabase.auth.signInWithPassword({
        email: email.toLowerCase(),
        password: password,
      });

    if (authError || !authData.user) {
      return {
        success: false,
        error: "Invalid email or password",
        status: 401,
      };
    }

    // Get family data
    const { data: family, error: familyError } = await supabase
      .from("families")
      .select("*")
      .eq("user_id", authData.user.id)
      .single();

    if (familyError || !family) {
      return {
        success: false,
        error: "Family record not found",
        status: 404,
      };
    }

    // Generate session token
    const sessionToken = generateSessionToken(family.id);

    return {
      success: true,
      sessionToken,
      family: {
        id: family.id,
        name: family.family_name,
        parent_name: family.parent_name,
      },
    };
  } catch (error) {
    console.error("Login error:", error);
    return {
      success: false,
      error: "Internal server error",
      status: 500,
    };
  }
}

export async function autoLogin(
  email: string,
  password: string
): Promise<AuthResult> {
  try {
    // Create admin Supabase client
    const adminSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Verify user exists and authenticate
    const { data: authData, error: authError } =
      await adminSupabase.auth.signInWithPassword({
        email: email.toLowerCase(),
        password: password,
      });

    if (authError || !authData.user) {
      return {
        success: false,
        error: "Failed to authenticate",
        status: 401,
      };
    }

    // Find family by email
    const { data: family, error: familyError } = await adminSupabase
      .from("families")
      .select("*")
      .eq("parent_email", email.toLowerCase())
      .single();

    if (familyError || !family) {
      return {
        success: false,
        error: "Family record not found",
        status: 404,
      };
    }

    // Generate session token
    const sessionToken = generateSessionToken(family.id);

    return {
      success: true,
      sessionToken,
      user: {
        id: authData.user.id,
        email: authData.user.email,
      },
      family: {
        id: family.id,
        name: family.family_name,
        parent_name: family.parent_name,
      },
    };
  } catch (error) {
    console.error("Auto-login error:", error);
    return {
      success: false,
      error: "Failed to authenticate",
      status: 500,
    };
  }
}

export async function checkUser(
  email: string,
  password?: string,
  familyData?: any
): Promise<CheckUserResult> {
  try {
    const supabase = createServerSupabase();

    // Check if user exists in auth.users
    const { data: authUsers, error: authError } =
      await supabase.auth.admin.listUsers();

    if (authError) {
      console.error("Error checking auth users:", authError);
      return {
        success: false,
        exists: false,
        message: "Failed to check user status",
      };
    }

    const user = authUsers.users.find((u) => u.email === email.toLowerCase());

    if (!user) {
      console.log("User not found in auth.users for email:", email);

      // If we have family data, try to create the user directly as a fallback
      if (familyData && password) {
        return await createUserWithFamily(email, password, familyData);
      }

      return {
        success: false,
        exists: false,
        message: "User not created yet",
      };
    }

    // Check if family record exists
    const { data: family, error: familyError } = await supabase
      .from("families")
      .select("id, user_id")
      .eq("user_id", user.id)
      .single();

    if (familyError || !family) {
      console.log("Family record not found for user:", user.id);
      return {
        success: false,
        exists: false,
        message: "Family record not created yet",
      };
    }

    return {
      success: true,
      exists: true,
      userId: user.id,
      familyId: family.id,
      email: user.email!,
      message: "User account ready",
    };
  } catch (error) {
    console.error("Check user error:", error);
    return {
      success: false,
      exists: false,
      message: "Failed to check user status",
    };
  }
}

export async function logout(): Promise<void> {
  try {
    const supabase = createServerSupabase();
    await supabase.auth.signOut();
  } catch (error) {
    console.error("Logout error:", error);
    // Don't throw error for logout failures
  }
}

export async function setPin(
  familyId: string,
  pin: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = createServerSupabase();

    const { error } = await supabase
      .from("families")
      .update({ parent_pin: pin })
      .eq("id", familyId);

    if (error) {
      console.error("Error saving PIN:", error);
      return { success: false, error: "Failed to save PIN" };
    }

    return { success: true };
  } catch (error) {
    console.error("PIN save error:", error);
    return { success: false, error: "Internal server error" };
  }
}

export async function validatePin(
  familyId: string,
  pin: string
): Promise<{ success: boolean; error?: string; status?: number }> {
  try {
    const supabase = createServerSupabase();

    // Get the stored PIN for this family
    const { data: family, error } = await supabase
      .from("families")
      .select("parent_pin")
      .eq("id", familyId)
      .single();

    if (error) {
      console.error("Error fetching PIN:", error);
      return { success: false, error: "Failed to validate PIN", status: 500 };
    }

    if (!family.parent_pin) {
      return { success: false, error: "PIN not set up", status: 404 };
    }

    // Compare the provided PIN with the stored PIN
    if (pin === family.parent_pin) {
      return { success: true };
    } else {
      return { success: false, error: "Incorrect PIN", status: 401 };
    }
  } catch (error) {
    console.error("PIN validation error:", error);
    return { success: false, error: "Internal server error", status: 500 };
  }
}

export async function checkPinExists(
  familyId: string
): Promise<{ success: boolean; error?: string; status?: number }> {
  try {
    const supabase = createServerSupabase();

    // Check if user has a PIN set up
    const { data: family, error } = await supabase
      .from("families")
      .select("parent_pin")
      .eq("id", familyId)
      .single();

    if (error) {
      console.error("Error fetching PIN:", error);
      return {
        success: false,
        error: "Failed to check PIN status",
        status: 500,
      };
    }

    if (!family.parent_pin) {
      return { success: false, error: "PIN not set up", status: 404 };
    }

    return { success: true };
  } catch (error) {
    console.error("PIN check error:", error);
    return { success: false, error: "Internal server error", status: 500 };
  }
}

async function createUserWithFamily(
  email: string,
  password: string,
  familyData: any
): Promise<CheckUserResult> {
  try {
    console.log("Attempting to create user directly as fallback...");

    const adminSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Create the user
    const { data: newUser, error: createError } =
      await adminSupabase.auth.admin.createUser({
        email: email.toLowerCase(),
        password: password,
        email_confirm: true,
        user_metadata: {
          name: familyData.parentName,
          family_name: familyData.familyName,
        },
      });

    if (createError || !newUser.user) {
      console.error("Failed to create user directly:", createError);
      return {
        success: false,
        exists: false,
        message: "User not created yet",
      };
    }

    // Create family record
    const { data: family, error: familyError } = await adminSupabase
      .from("families")
      .insert({
        name: familyData.familyName,
        family_name: familyData.familyName,
        parent_name: familyData.parentName,
        parent_email: email.toLowerCase(),
        user_id: newUser.user.id,
        subscription_plan: "family_communication_coach",
        subscription_status: "trialing",
        trial_ends_at: new Date(
          Date.now() + 7 * 24 * 60 * 60 * 1000
        ).toISOString(),
      })
      .select()
      .single();

    if (familyError || !family) {
      console.error("Failed to create family record:", familyError);
      // Clean up the user if family creation fails
      await adminSupabase.auth.admin.deleteUser(newUser.user.id);
      return {
        success: false,
        exists: false,
        message: "Family record not created yet",
      };
    }

    // Create children records if provided
    if (familyData.children && familyData.children.length > 0) {
      const childrenRecords = familyData.children.map((child: any) => ({
        family_id: family.id,
        name: child.name,
        age: Number(child.age),
        current_concerns: child.concerns || null,
        is_active: true,
        created_at: new Date().toISOString(),
      }));

      const { error: childrenError } = await adminSupabase
        .from("children")
        .insert(childrenRecords);

      if (childrenError) {
        console.error("Error creating children:", childrenError);
        // Continue anyway - children can be added later
      }
    }

    return {
      success: true,
      exists: true,
      userId: newUser.user.id,
      familyId: family.id,
      email: newUser.user.email!,
      message: "User account created successfully",
    };
  } catch (error) {
    console.error("Fallback user creation failed:", error);
    return {
      success: false,
      exists: false,
      message: "User not created yet",
    };
  }
}

export async function getUserWithChildren(familyId: string): Promise<UserData> {
  const supabase = createServerSupabase();

  // Fetch children for this family
  const { data: children } = await supabase
    .from("children")
    .select("id, name, age, current_concerns")
    .eq("family_id", familyId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  // Get family data (assuming it's already fetched in middleware)
  const { data: family } = await supabase
    .from("families")
    .select("*")
    .eq("id", familyId)
    .single();

  if (!family) {
    throw new Error("Family not found");
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
      created_at: family.created_at,
    },
    children: children || [],
  };
}

export async function updatePin(
  familyId: string,
  currentPin: string,
  newPin: string
): Promise<{ success: boolean; error?: string; status?: number }> {
  try {
    const supabase = createServerSupabase();

    // First, verify the current PIN
    const { data: family, error: fetchError } = await supabase
      .from("families")
      .select("parent_pin")
      .eq("id", familyId)
      .single();

    if (fetchError) {
      console.error("Error fetching current PIN:", fetchError);
      return {
        success: false,
        error: "Failed to verify current PIN",
      };
    }

    if (!family.parent_pin) {
      return {
        success: false,
        error: "No PIN set up. Use POST method to create initial PIN.",
        status: 400,
      };
    }

    if (family.parent_pin !== currentPin) {
      return {
        success: false,
        error: "Current PIN is incorrect",
        status: 400,
      };
    }

    // Update to new PIN
    const { error: updateError } = await supabase
      .from("families")
      .update({ parent_pin: newPin })
      .eq("id", familyId);

    if (updateError) {
      console.error("Error updating PIN:", updateError);
      return {
        success: false,
        error: "Failed to update PIN",
      };
    }

    return { success: true };
  } catch (error) {
    console.error("PIN update error:", error);
    return {
      success: false,
      error: "Internal server error",
    };
  }
}
