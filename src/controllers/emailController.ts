import { Request, Response } from "express";
import {
  sendWeeklyProgressEmail,
  sendTestEmail,
  testEmailConnection,
  WeeklyProgressEmailData,
} from "../services/emailService";
import { createServerSupabase } from "../lib/supabase";
import { getDashboardAnalytics } from "../services/analysisService";

export const sendWeeklyProgressEmails = async (req: Request, res: Response) => {
  try {
    const { familyId, childId, sendToAll = false } = req.body;
    const supabase = createServerSupabase();

    let processedEmails = 0;
    let errors: string[] = [];

    if (sendToAll) {
      // Process all active families with premium subscriptions
      const { data: families, error: familiesError } = await supabase
        .from("families")
        .select(
          `
          id,
          name,
          parent_email,
          subscription_status,
          subscription_tier,
          children (
            id,
            name,
            is_active
          )
        `
        )
        .eq("subscription_status", "active")
        .in("subscription_tier", ["premium", "family"]);

      if (familiesError) {
        console.error("Error fetching families:", familiesError);
        return res.status(500).json({ error: "Failed to fetch families" });
      }

      // Process each family
      for (const family of families || []) {
        if (!family.parent_email) continue;

        // Process each child in the family
        for (const child of family.children || []) {
          if (!child.is_active) continue;

          try {
            const emailSent = await processWeeklyEmailForChild(family, child);
            if (emailSent) processedEmails++;
          } catch (error) {
            console.error(
              `Error processing email for family ${family.id}, child ${child.id}:`,
              error
            );
            errors.push(
              `Failed to send email for ${family.name} - ${child.name}: ${
                error instanceof Error ? error.message : "Unknown error"
              }`
            );
          }
        }
      }
    } else if (familyId && childId) {
      // Process specific family and child
      const { data: family, error: familyError } = await supabase
        .from("families")
        .select(
          `
          id,
          name,
          parent_email,
          subscription_status,
          subscription_tier
        `
        )
        .eq("id", familyId)
        .single();

      if (familyError || !family) {
        return res.status(404).json({ error: "Family not found" });
      }

      const { data: child, error: childError } = await supabase
        .from("children")
        .select("id, name, is_active")
        .eq("id", childId)
        .eq("family_id", familyId)
        .single();

      if (childError || !child) {
        return res.status(404).json({ error: "Child not found" });
      }

      if (!child.is_active) {
        return res.status(400).json({ error: "Child is not active" });
      }

      const emailSent = await processWeeklyEmailForChild(family, child);
      if (emailSent) processedEmails = 1;
    } else {
      return res.status(400).json({
        error: "Either provide familyId and childId, or set sendToAll to true",
      });
    }

    res.json({
      success: true,
      message: `Successfully processed ${processedEmails} weekly progress emails`,
      processedEmails,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Error in weekly progress email controller:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const sendTestProgressEmail = async (req: Request, res: Response) => {
  try {
    const { testEmail, familyId, childId } = req.body;

    if (!testEmail) {
      return res.status(400).json({ error: "testEmail is required" });
    }

    const result = await sendTestEmail(testEmail, familyId, childId);

    res.json({
      success: true,
      message: "Test weekly progress email sent successfully",
      emailId: result.emailId,
      response: result.response,
    });
  } catch (error) {
    console.error("Error sending test weekly progress email:", error);
    res.status(500).json({
      error: "Failed to send test email",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

export const testEmail = async (req: Request, res: Response) => {
  try {
    const result = await testEmailConnection();

    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    console.error("Error testing email connection:", error);
    res.status(500).json({
      error: "Failed to test email connection",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

export const scheduleWeeklyEmails = async (req: Request, res: Response) => {
  try {
    // Verify cron authorization if in production
    const authHeader = req.headers.authorization;
    const expectedToken = process.env.CRON_SECRET_TOKEN;

    if (
      process.env.NODE_ENV === "production" &&
      expectedToken &&
      authHeader !== `Bearer ${expectedToken}`
    ) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Get current day of week (0 = Sunday, 1 = Monday, etc.)
    const today = new Date();
    const dayOfWeek = today.getDay();

    // Only send weekly emails on Sundays (or whatever day you prefer)
    if (dayOfWeek !== 0) {
      // 0 = Sunday
      return res.json({
        success: true,
        message: "Weekly emails are only sent on Sundays",
        dayOfWeek,
        skipped: true,
      });
    }

    // Call the weekly email function
    const result = await sendWeeklyProgressEmailsInternal();

    res.json({
      success: true,
      message: "Weekly email scheduler executed successfully",
      result,
    });
  } catch (error) {
    console.error("Error in weekly email scheduler:", error);
    res.status(500).json({
      error: "Internal server error",
      details: error instanceof Error ? error.message : "Unknown error",
    });
  }
};

// Internal function to send weekly emails (used by scheduler)
export async function sendWeeklyProgressEmailsInternal() {
  const supabase = createServerSupabase();
  let processedEmails = 0;
  let errors: string[] = [];

  // Get all active families with premium subscriptions
  const { data: families, error: familiesError } = await supabase
    .from("families")
    .select(
      `
      id,
      name,
      parent_email,
      subscription_status,
      subscription_tier,
      children (
        id,
        name,
        is_active
      )
    `
    )
    .eq("subscription_status", "active");

  if (familiesError) {
    throw new Error(`Failed to fetch families: ${familiesError.message}`);
  }

  // Process each family
  for (const family of families || []) {
    if (!family.parent_email) continue;

    // Process each child in the family
    for (const child of family.children || []) {
      if (!child.is_active) continue;

      try {
        const emailSent = await processWeeklyEmailForChild(family, child);
        if (emailSent) processedEmails++;
      } catch (error) {
        console.error(
          `Error processing email for family ${family.id}, child ${child.id}:`,
          error
        );
        errors.push(
          `Failed to send email for ${family.name} - ${child.name}: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    }
  }

  return {
    processedEmails,
    errors: errors.length > 0 ? errors : undefined,
  };
}

async function processWeeklyEmailForChild(
  family: any,
  child: any
): Promise<boolean> {
  try {
    // Check if child has had sessions this week
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const supabase = createServerSupabase();
    const { data: weeklySessions, error: sessionsError } = await supabase
      .from("therapy_sessions")
      .select("id, created_at")
      .eq("child_id", child.id)
      .gte("created_at", oneWeekAgo.toISOString())
      .eq("status", "completed");

    if (sessionsError) {
      console.error("Error fetching weekly sessions:", sessionsError);
      return false;
    }

    // Only send email if child had sessions this week
    if (!weeklySessions || weeklySessions.length === 0) {
      console.log(
        `No sessions this week for child ${child.name}, skipping email`
      );
      return false;
    }

    // Get dashboard analytics for the child
    const analyticsResult = await getDashboardAnalytics(family.id, child.id);

    if (!analyticsResult.success || !analyticsResult.data?.weekly_insight) {
      console.log(
        `No weekly insights available for child ${child.name}, skipping email`
      );
      return false;
    }

    const analytics = analyticsResult.data;

    // Prepare email data
    const emailData: WeeklyProgressEmailData = {
      parentName: extractFirstName(family.name),
      parentEmail: family.parent_email,
      childName: child.name,
      sessionCount: weeklySessions.length || 0,
      weeklyInsight: analytics.weekly_insight,
      moodImprovement: {
        status: analytics.emotional_trend?.status || "stable",
        summary:
          analytics.emotional_trend?.key_factors?.join(", ") ||
          "Continuing to build emotional awareness and communication skills.",
      },
      actionPlan: analytics.action_plan || {
        steps: [
          {
            timeframe: "This Week",
            action: "Continue regular conversations",
            description:
              "Encourage your child to share their thoughts and feelings openly.",
          },
        ],
        quick_win:
          "Take 10 minutes today to ask about their day and listen actively.",
      },
      wins: analytics.progress_tracking?.wins || [],
    };

    // Send the email
    const result = await sendWeeklyProgressEmail(emailData);

    console.log(
      `Weekly progress email sent successfully for ${child.name} to ${family.parent_email}`
    );
    return true;
  } catch (error) {
    console.error(
      `Error processing weekly email for child ${child.name}:`,
      error
    );
    return false;
  }
}

function extractFirstName(fullName: string): string {
  return fullName.split(" ")[0] || fullName;
}
