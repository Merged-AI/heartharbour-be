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

// Calculate check-in streak for a child
async function calculateStreakData(childId: string, supabase: any) {
  try {
    // Get all sessions for this child, grouped by date
    const { data: sessions, error } = await supabase
      .from("therapy_sessions")
      .select("created_at")
      .eq("child_id", childId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    if (!sessions || sessions.length === 0) {
      return {
        current_streak: 0,
        longest_streak: 0,
        last_check_in_date: null,
      };
    }

    // Group sessions by date (remove time component)
    const sessionDates = new Set();
    sessions.forEach((session: any) => {
      const date = session.created_at.split("T")[0]; // Get YYYY-MM-DD part
      sessionDates.add(date);
    });

    // Convert to sorted array of dates (most recent first)
    const sortedDates = Array.from(sessionDates).sort().reverse();

    // Calculate current streak
    let currentStreak = 0;
    const today = new Date().toISOString().split("T")[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    // Check if there's activity today or yesterday to maintain streak
    if (sortedDates.includes(today) || sortedDates.includes(yesterday)) {
      let checkDate = new Date();
      for (let i = 0; i < sortedDates.length; i++) {
        const sessionDate = sortedDates[i];
        const expectedDate = checkDate.toISOString().split("T")[0];

        if (sessionDate === expectedDate) {
          currentStreak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else if (
          sessionDate ===
          new Date(checkDate.getTime() - 24 * 60 * 60 * 1000)
            .toISOString()
            .split("T")[0]
        ) {
          // Allow for previous day if we haven't checked today yet
          currentStreak++;
          checkDate.setDate(checkDate.getDate() - 2);
        } else {
          break;
        }
      }
    }

    // Calculate longest streak
    let longestStreak = 0;
    let tempStreak = 1;

    for (let i = 0; i < sortedDates.length - 1; i++) {
      const currentDate = new Date(sortedDates[i] as string);
      const nextDate = new Date(sortedDates[i + 1] as string);
      const dayDifference =
        (currentDate.getTime() - nextDate.getTime()) / (1000 * 60 * 60 * 24);

      if (dayDifference === 1) {
        tempStreak++;
      } else {
        longestStreak = Math.max(longestStreak, tempStreak);
        tempStreak = 1;
      }
    }
    longestStreak = Math.max(longestStreak, tempStreak);

    return {
      current_streak: currentStreak,
      longest_streak: longestStreak,
      last_check_in_date: sortedDates[0] || null,
    };
  } catch (error) {
    console.error("Error calculating streak data:", error);
    return {
      current_streak: 0,
      longest_streak: 0,
      last_check_in_date: null,
    };
  }
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

Create a compassionate, non-clinical analysis for PARENTS in this exact JSON format. Use natural, warm language that parents can easily understand. Avoid technical jargon, numerical scores, or clinical terminology in parent-facing content. Write as if speaking to a caring parent about their child's emotional growth:
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
    "wins": [
      "Write 2-3 meaningful wins this week in natural parent language. Focus on: emotional moments, social interactions, communication breakthroughs, coping strategies used, or personal growth. Avoid technical scores or clinical language. Examples: 'Shared excitement about a school project', 'Asked for help when feeling overwhelmed', 'Used breathing exercises during a difficult moment'"
    ],
    "working_on": [
      {
        "issue": "Area needing continued support (in simple parent terms)",
        "note": "What progress looks like and realistic expectations"
      }
    ],
    "when_to_worry": "Clear, specific indicators that would suggest parents should seek additional professional support"
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

    // If no sessions this week, create empty analytics record with helpful guidance
    if (!thisWeekSessions || thisWeekSessions.length === 0) {
      // Create/update analytics record with zero current week data but preserve basic info
      const { data: child } = await supabase
        .from("children")
        .select("name")
        .eq("id", childId)
        .single();

      const childName = child?.name || null;

      // Calculate streak data (this works regardless of current week sessions)
      const streakData = await calculateStreakData(childId, supabase);

      // Get latest session for reference
      const { data: latestSessionData, error: latestSessionError } =
        await supabase
          .from("therapy_sessions")
          .select("*")
          .eq("child_id", childId)
          .order("created_at", { ascending: false })
          .limit(1)
          .single();

      // Create empty analytics record for current week
      const emptyWeekAnalytics = {
        child_id: childId,
        family_id: familyId,
        child_name: childName,
        latest_mood: null,
        sessions_analytics: {
          sessions_this_week: 0,
          total_sessions: totalSessionCount || 0,
          average_duration: 0,
          last_session_at: latestSessionData?.created_at || null,
          streak_analytics: streakData,
        },
        emotional_trend: {
          status: "",
          attention_needed: false,
          analysis_period: "no_current_data",
          key_factors: [],
        },
        active_concerns: {
          count: 0,
          level: "",
          identified_concerns: [],
          priority_concerns: [],
        },
        weekly_insight: null,
        action_plan: null,
        progress_tracking: null,
        alerts: {
          has_alert: false,
          alert_type: undefined,
          alert_title: undefined,
          alert_description: undefined,
          created_at: undefined,
        },
        communication_insights: [],
        growth_development_insights: [],
        family_communication_summary: {
          strengths: [],
          growth_areas: [],
          recommendations: [],
          updated_at: new Date().toISOString(),
        },
        conversation_organization: {
          key_topics: [],
          questions_to_consider: [],
          updated_at: new Date().toISOString(),
        },
        family_wellness_tips: [],
        family_communication_goals: [],
        updated_at: new Date().toISOString(),
      };

      // Upsert the empty analytics record
      const { data: upsertData, error: upsertError } = await supabase
        .from("dashboard_analytics")
        .upsert(emptyWeekAnalytics)
        .select()
        .single();

      if (upsertError) {
        console.error(
          `Error upserting empty analytics for child ${childId}:`,
          upsertError
        );
        throw upsertError;
      }

      return;
    }

    // Calculate average duration from this week's sessions
    const averageDuration =
      thisWeekSessions.reduce((acc, s) => acc + (s.session_duration || 0), 0) /
      thisWeekSessions.length;

    // Calculate streak data
    const streakData = await calculateStreakData(childId, supabase);

    // Calculate analytics from this week's sessions only using OpenAI
    const analytics = await calculateAnalytics(
      childId,
      thisWeekSessions,
      latestSession
    );

    // Update the sessions_analytics with accurate counts and add streak data
    const updatedAnalytics = {
      ...analytics,
      sessions_analytics: {
        ...analytics.sessions_analytics,
        sessions_this_week: weeklySessionCount || 0,
        total_sessions: totalSessionCount || 0,
        average_duration: Math.round(averageDuration),
        last_session_at: latestSession.created_at,
        streak_analytics: streakData,
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
