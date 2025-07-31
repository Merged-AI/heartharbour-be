import OpenAI from "openai";
import { createServerSupabase } from "../lib/supabase.js";
import {
  requireSubscriptionAccess,
  FEATURE_LEVELS,
} from "../lib/subscription-access.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Utility function to clean OpenAI JSON responses
function cleanOpenAIJsonResponse(response: string): string {
  return response
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .replace(/^\s*[\r\n]/gm, "") // Remove empty lines
    .trim();
}

interface AnalyticsResult {
  success: boolean;
  error?: string;
  status?: number;
  data?: any;
  message?: string;
  code?: string;
  details?: any;
  analyticsStatus?: string;
}

interface TherapySession {
  id: string;
  child_id: string;
  family_id: string;
  created_at: string;
  session_duration?: number;
  mood_analysis?: any;
  topics?: string[];
  messages?: any[];
}

interface DashboardAnalytics {
  id?: string;
  child_id: string;
  family_id: string;
  latest_mood: any;
  sessions_analytics: any;
  emotional_trend: any;
  active_concerns: any;
  alerts: any;
  communication_insights: any[];
  growth_development_insights: any[];
  family_communication_summary: any;
  conversation_organization: any;
  family_wellness_tips: any[];
  family_communication_goals: any[];
  child_name: string | null;
  weekly_insight: {
    story: string;
    what_happened: string;
    good_news: string;
  } | null;
  action_plan: {
    steps: {
      timeframe: string;
      action: string;
      description: string;
    }[];
    quick_win: string;
  } | null;
  progress_tracking: {
    wins: string[];
    working_on: {
      issue: string;
      note: string;
    }[];
    when_to_worry: string;
  } | null;
  updated_at: string;
  created_at?: string;
}

// Utility function to get the start of the current week (Sunday)
function getStartOfWeek(date: Date = new Date()): Date {
  const startOfWeek = new Date(date);
  startOfWeek.setHours(0, 0, 0, 0);
  startOfWeek.setDate(date.getDate() - date.getDay());
  return startOfWeek;
}

// Utility function to check if analytics data is from the current week
function isAnalyticsDataCurrent(updatedAt: string): boolean {
  const analyticsDate = new Date(updatedAt);
  const currentWeekStart = getStartOfWeek();
  const analyticsWeekStart = getStartOfWeek(analyticsDate);

  return analyticsWeekStart.getTime() === currentWeekStart.getTime();
}

async function validateChildAccess(
  familyId: string,
  childId: string
): Promise<boolean> {
  try {
    const supabase = createServerSupabase();
    const { data: child, error } = await supabase
      .from("children")
      .select("id")
      .eq("id", childId)
      .eq("family_id", familyId)
      .single();

    return !error && child !== null;
  } catch (error) {
    return false;
  }
}

async function calculateAnalytics(
  childId: string,
  sessions: TherapySession[],
  latestSession: TherapySession
): Promise<Omit<DashboardAnalytics, "id" | "created_at">> {
  const now = new Date();

  // Basic session statistics - all sessions passed are from this week
  const sessionsThisWeek = sessions.length;
  const totalSessions = sessions.length;
  const averageDuration =
    totalSessions > 0
      ? sessions.reduce((acc, s) => acc + (s.session_duration || 0), 0) /
        totalSessions
      : 0;

  // Prepare session data for OpenAI analysis
  const sessionData = sessions.map((s) => ({
    date: s.created_at,
    duration: s.session_duration,
    mood_analysis: s.mood_analysis,
    topics: s.topics,
    messages: s.messages,
  }));

  // Get child's name - we'll need to fetch it from the children table
  let childName: string | null = null;
  try {
    const supabase = createServerSupabase();
    const { data: child } = await supabase
      .from("children")
      .select("name")
      .eq("id", childId)
      .single();
    childName = child?.name || null;
  } catch (error) {
    console.warn("Could not fetch child name:", error);
  }

  // Get AI analysis for story-driven insights
  const aiAnalysisPrompt = `You are a family communication coach. Analyze ONLY this week's therapy sessions for a child${
    childName ? ` named ${childName}` : ""
  } and create a warm, story-driven weekly insight that parents can easily understand and act on. Focus on what the child is working through, what happened THIS WEEK specifically, and positive growth patterns from these recent conversations.

IMPORTANT: Base your analysis ONLY on the sessions provided below, which are from this current week. Do not make assumptions about previous weeks or sessions not included.

Write the "story" field to complete this sentence: "${
    childName || "[Child's name]"
  } is working through..."

This week's sessions data:
${JSON.stringify(sessionData, null, 2)}

Create a compassionate, non-clinical analysis in this exact JSON format:
{
  "weekly_insight": {
    "story": "is working through [describe the developmental challenge in warm, normal terms]",
    "what_happened": "Brief summary of what the child shared or experienced this week",
    "good_news": "Positive emotional growth or communication progress observed"
  },
  "action_plan": {
    "steps": [
      {
        "timeframe": "Tonight",
        "action": "Specific immediate action for parents",
        "description": "Brief explanation of how to do it"
      },
      {
        "timeframe": "This Week", 
        "action": "Ongoing weekly action",
        "description": "How to implement throughout the week"
      },
      {
        "timeframe": "Next Week",
        "action": "Future step if needed",
        "description": "When and how to take this step"
      }
    ],
    "quick_win": "One simple thing parents can do right now for immediate positive impact"
  },
  "progress_tracking": {
    "wins": ["Positive behaviors or growth observed (max 3)"],
    "working_on": [
      {
        "issue": "Challenge still being addressed",
        "note": "Reassuring context about why this is normal/expected"
      }
    ],
    "when_to_worry": "Clear guidance on concerning signs that warrant professional help"
  },
  "emotional_trend": {
    "status": "improving" | "declining" | "stable",
    "attention_needed": boolean,
    "analysis_period": "last_10_sessions",
    "key_factors": string[]
  },
  "active_concerns": {
    "count": number,
    "level": "stable" | "monitoring" | "high_priority",
    "identified_concerns": string[],
    "priority_concerns": string[]
  }
}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content:
          "You are a warm, experienced family communication coach who helps parents understand their child's emotional journey through caring, story-driven insights and practical action steps.",
      },
      { role: "user", content: aiAnalysisPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const responseContent = completion.choices[0]?.message?.content || "{}";
  const aiAnalysis = JSON.parse(cleanOpenAIJsonResponse(responseContent));

  // Calculate latest mood from the most recent session
  const moodAnalysis = latestSession.mood_analysis || {
    happiness: 5,
    anxiety: 5,
    sadness: 5,
    stress: 5,
    confidence: 5,
  };

  const latestMood = {
    status:
      moodAnalysis.happiness > 7
        ? "Happy"
        : moodAnalysis.anxiety > 7
        ? "Anxious"
        : moodAnalysis.sadness > 7
        ? "Sad"
        : moodAnalysis.stress > 7
        ? "Stressed"
        : moodAnalysis.confidence > 7
        ? "Confident"
        : "Stable",
    trend:
      moodAnalysis.happiness > 7
        ? "Improving"
        : moodAnalysis.anxiety > 7 ||
          moodAnalysis.sadness > 7 ||
          moodAnalysis.stress > 7
        ? "Needs attention"
        : "Stable",
    recorded_at: latestSession.created_at,
  };

  // Determine if alerts are needed based on AI analysis
  const hasAlert = aiAnalysis.active_concerns?.level === "high_priority";

  return {
    child_id: childId,
    family_id: latestSession.family_id,
    latest_mood: latestMood,
    sessions_analytics: {
      sessions_this_week: sessionsThisWeek,
      total_sessions: totalSessions,
      average_duration: Math.round(averageDuration),
      last_session_at: latestSession.created_at,
    },
    emotional_trend: aiAnalysis.emotional_trend || {
      status: "stable",
      attention_needed: false,
      analysis_period: "last_10_sessions",
      key_factors: [],
    },
    active_concerns: aiAnalysis.active_concerns || {
      count: 0,
      level: "stable",
      identified_concerns: [],
      priority_concerns: [],
    },
    alerts: {
      has_alert: hasAlert,
      alert_type: hasAlert ? "warning" : undefined,
      alert_title: hasAlert ? "High Priority Concerns Detected" : undefined,
      alert_description: hasAlert
        ? "Multiple concerns requiring immediate attention identified."
        : undefined,
      created_at: hasAlert ? now.toISOString() : undefined,
    },
    // New story-driven fields
    child_name: childName,
    weekly_insight: aiAnalysis.weekly_insight || null,
    action_plan: aiAnalysis.action_plan || null,
    progress_tracking: aiAnalysis.progress_tracking || null,
    // Legacy fields (kept for backwards compatibility)
    communication_insights: [],
    growth_development_insights: [],
    family_communication_summary: {
      strengths: [],
      growth_areas: [],
      recommendations: [],
    },
    conversation_organization: {
      key_topics: [],
      questions_to_consider: [],
    },
    family_wellness_tips: [],
    family_communication_goals: [
      { goal_type: "This Week", description: "Continue regular check-ins" },
      { goal_type: "Ongoing", description: "Maintain supportive environment" },
      { goal_type: "If Needed", description: "Seek professional guidance" },
    ],
    updated_at: new Date().toISOString(),
  };
}

export async function calculateAndStoreDashboardAnalytics(
  childId: string,
  latestSession: TherapySession,
  familyId: string
): Promise<void> {
  const supabase = createServerSupabase();

  try {
    // Get current date and start of week
    const now = new Date();
    const startOfWeek = getStartOfWeek(now);

    // Fetch sessions count for this week
    const { count: weeklySessionCount, error: weeklyCountError } =
      await supabase
        .from("therapy_sessions")
        .select("*", { count: "exact", head: true })
        .eq("child_id", childId)
        .gte("created_at", startOfWeek.toISOString());

    if (weeklyCountError) throw weeklyCountError;

    // Fetch only this week's sessions for analysis
    const { data: thisWeekSessions, error: sessionsError } = await supabase
      .from("therapy_sessions")
      .select("*")
      .eq("child_id", childId)
      .gte("created_at", startOfWeek.toISOString())
      .order("created_at", { ascending: false });

    if (sessionsError) throw sessionsError;

    // Get total sessions count
    const { count: totalSessionCount, error: totalCountError } = await supabase
      .from("therapy_sessions")
      .select("*", { count: "exact", head: true })
      .eq("child_id", childId);

    if (totalCountError) throw totalCountError;

    // If no sessions this week, we can't generate meaningful analytics
    if (!thisWeekSessions || thisWeekSessions.length === 0) {
      console.log(
        `No sessions this week for child ${childId}, skipping analytics generation`
      );
      // Don't update analytics - let the getDashboardAnalytics return 400 error
      return;
    }

    // Calculate average duration from this week's sessions
    const averageDuration =
      thisWeekSessions.reduce((acc, s) => acc + (s.session_duration || 0), 0) /
      thisWeekSessions.length;

    // Calculate analytics from this week's sessions only using OpenAI
    const analytics = await calculateAnalytics(
      childId,
      thisWeekSessions,
      latestSession
    );

    // Update the sessions_analytics with accurate counts
    const updatedAnalytics = {
      ...analytics,
      sessions_analytics: {
        ...analytics.sessions_analytics,
        sessions_this_week: weeklySessionCount || 0,
        total_sessions: totalSessionCount || 0,
        average_duration: Math.round(averageDuration),
        last_session_at: latestSession.created_at,
      },
    };

    const { data: upsertData, error: upsertError } = await supabase
      .from("dashboard_analytics")
      .upsert({
        ...updatedAnalytics,
        child_id: childId,
        family_id: familyId,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (upsertError) throw upsertError;
  } catch (error) {
    console.error("Error in calculateAndStoreDashboardAnalytics:", error);
    throw error;
  }
}

export async function getDashboardAnalytics(
  familyId: string,
  childId: string
): Promise<AnalyticsResult> {
  try {
    // Check subscription access for advanced analytics
    try {
      await requireSubscriptionAccess(
        familyId,
        FEATURE_LEVELS.ADVANCED_ANALYTICS
      );
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        status: 403,
      };
    }

    const supabase = createServerSupabase();

    // Validate child access
    const hasAccess = await validateChildAccess(familyId, childId);
    if (!hasAccess) {
      return {
        success: false,
        error: "Access denied to this child",
        status: 403,
      };
    }

    // Fetch dashboard analytics for the child
    const { data: analytics, error } = await supabase
      .from("dashboard_analytics")
      .select("*")
      .eq("child_id", childId)
      .single();

    // Handle case where no analytics exist yet
    if (error?.code === "PGRST116") {
      return {
        success: false,
        error: "No analytics data available for this child yet",
        status: 400,
        message: "No analytics data available for this child yet",
      };
    }

    if (error) {
      throw error;
    }

    // Check if analytics data is from the current week
    if (analytics && !isAnalyticsDataCurrent(analytics.updated_at)) {
      console.log(
        "Analytics data is from a previous week, triggering auto-refresh..."
      );

      try {
        // Get child data for family_id
        const { data: child, error: childError } = await supabase
          .from("children")
          .select("id, family_id")
          .eq("id", childId)
          .single();

        if (childError || !child?.family_id) {
          console.warn(
            "Could not get child data for auto-refresh, returning stale data"
          );
          return {
            success: true,
            data: analytics,
          };
        }

        // Get the latest session for recalculation
        const { data: session, error: sessionError } = await supabase
          .from("therapy_sessions")
          .select("*")
          .eq("child_id", childId)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

        if (sessionError || !session) {
          console.warn(
            "Could not get latest session for auto-refresh, returning stale data"
          );
          return {
            success: true,
            data: analytics,
          };
        }

        // Trigger analytics recalculation
        await calculateAndStoreDashboardAnalytics(
          childId,
          session,
          child.family_id
        );

        // Fetch the updated analytics
        const { data: updatedAnalytics, error: updatedError } = await supabase
          .from("dashboard_analytics")
          .select("*")
          .eq("child_id", childId)
          .single();

        if (!updatedError && updatedAnalytics) {
          console.log("Analytics auto-refreshed successfully for new week");
          return {
            success: true,
            data: updatedAnalytics,
          };
        }
      } catch (refreshError) {
        console.warn(
          "Failed to auto-refresh analytics, returning stale data:",
          refreshError
        );
      }
    }

    return {
      success: true,
      data: analytics,
    };
  } catch (error) {
    console.error("Error fetching dashboard analytics:", error);
    return {
      success: false,
      error: "Failed to fetch dashboard analytics",
      status: 500,
    };
  }
}

export async function updateDashboardAnalytics(
  familyId: string,
  childId: string
): Promise<AnalyticsResult> {
  try {
    const supabase = createServerSupabase();

    // Normalize the ID
    const normalizedChildId = childId.trim();

    // Validate child access
    const hasAccess = await validateChildAccess(familyId, normalizedChildId);
    if (!hasAccess) {
      return {
        success: false,
        error: "Child not found",
        status: 404,
        details: `No child found with ID: ${normalizedChildId}`,
        code: "CHILD_NOT_FOUND",
      };
    }

    // Get child data
    const { data: child, error: childError } = await supabase
      .from("children")
      .select("id, family_id")
      .eq("id", normalizedChildId)
      .single();

    if (childError) {
      console.error("Error fetching child:", childError);
      return {
        success: false,
        error: "Database error while fetching child",
        status: 500,
        details: childError,
        code: "DATABASE_ERROR",
      };
    }

    if (!child?.family_id) {
      return {
        success: false,
        error: "Family ID not found for this child",
        status: 400,
      };
    }

    // Fetch the latest session
    const { data: session, error: sessionError } = await supabase
      .from("therapy_sessions")
      .select("*")
      .eq("child_id", normalizedChildId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (sessionError) {
      console.error("Error fetching latest session:", sessionError);
      return {
        success: false,
        error: "Failed to fetch latest session",
        status: 500,
        details: sessionError,
      };
    }

    if (!session) {
      return {
        success: false,
        error: "No therapy sessions found for this child yet",
        status: 400,
        message: "No therapy sessions found for this child yet",
      };
    }

    // Trigger analytics recalculation
    try {
      await calculateAndStoreDashboardAnalytics(
        normalizedChildId,
        session,
        child.family_id
      );
    } catch (calcError) {
      console.error("Error in calculateAndStoreDashboardAnalytics:", calcError);
      return {
        success: false,
        error: "Failed to calculate analytics",
        status: 500,
        details: calcError,
      };
    }

    // Add a small delay to allow for database consistency
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Fetch the updated analytics
    const { data: analyticsData, error: analyticsError } = await supabase
      .from("dashboard_analytics")
      .select("*")
      .eq("child_id", normalizedChildId)
      .maybeSingle();

    if (analyticsError) {
      console.error("Error fetching updated analytics:", analyticsError);
      return {
        success: false,
        error: "Failed to fetch updated analytics",
        status: 202,
        details: analyticsError,
        message: "Analytics calculation was triggered but verification failed",
      };
    }

    // Return the analytics record if it exists, or a success message if not
    return {
      success: true,
      data: analyticsData || { message: "Analytics calculation triggered" },
      analyticsStatus: analyticsData ? "completed" : "processing",
    };
  } catch (error) {
    console.error("Error in update dashboard analytics service:", error);
    return {
      success: false,
      error: "Failed to update dashboard analytics",
      status: 500,
      details: error,
      message: "An error occurred while calculating or storing analytics",
    };
  }
}
