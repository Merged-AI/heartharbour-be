import OpenAI from 'openai';
import { createServerSupabase } from '../lib/supabase.js';
import { requireSubscriptionAccess, FEATURE_LEVELS } from '../lib/subscription-access.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

async function validateChildAccess(familyId: string, childId: string): Promise<boolean> {
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
  const startOfWeek = getStartOfWeek(now);

  // Basic session statistics
  const sessionsThisWeek = sessions.filter(
    (s) => new Date(s.created_at) >= startOfWeek
  ).length;

  const totalSessions = sessions.length;
  const averageDuration =
    sessions.reduce((acc, s) => acc + (s.session_duration || 0), 0) /
    totalSessions;

  // Prepare session data for OpenAI analysis
  const sessionData = sessions.map((s) => ({
    date: s.created_at,
    duration: s.session_duration,
    mood_analysis: s.mood_analysis,
    topics: s.topics,
    messages: s.messages,
  }));

  // Get AI analysis for emotional trends and insights
  const aiAnalysisPrompt = `Analyze these therapy sessions (up to last 10 sessions) for a child and provide comprehensive insights focusing on recent trends and patterns. Focus on emotional trends, communication patterns, and therapeutic progress. Sessions data:
${JSON.stringify(sessionData, null, 2)}

Provide analysis in this exact JSON format, ensuring confidence_score is a percentage between 0-100:
{
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
  },
  "communication_insights": [{
    "topic": string,
    "confidence_score": number,
    "observations": string[],
    "parent_insights": string[],
    "communication_tips": string[],
    "recommended_next_step": string
  }],
  "growth_development_insights": [{
    "category": string,
    "insight_summary": string,
    "insight_detail": string,
    "suggested_actions": string[]
  }],
  "family_communication_summary": {
    "strengths": string[],
    "growth_areas": string[],
    "recommendations": string[]
  },
  "conversation_organization": {
    "key_topics": string[],
    "questions_to_consider": string[]
  },
  "family_wellness_tips": [{
    "title": string,
    "description": string
  }],
  "family_communication_goals": [
    {
      "goal_type": "This Week",
      "description": string
    },
    {
      "goal_type": "Ongoing",
      "description": string
    },
    {
      "goal_type": "If Needed",
      "description": string
    }
  ]
}`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: "You are an expert child psychologist analyzing therapy session data to provide insights for parents and therapists.",
      },
      { role: "user", content: aiAnalysisPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const aiAnalysis = JSON.parse(
    completion.choices[0]?.message?.content || "{}"
  );

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
      key_factors: []
    },
    active_concerns: aiAnalysis.active_concerns || {
      count: 0,
      level: "stable",
      identified_concerns: [],
      priority_concerns: []
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
    communication_insights: aiAnalysis.communication_insights || [],
    growth_development_insights: aiAnalysis.growth_development_insights || [],
    family_communication_summary: aiAnalysis.family_communication_summary || {
      strengths: [],
      growth_areas: [],
      recommendations: []
    },
    conversation_organization: aiAnalysis.conversation_organization || {
      key_topics: [],
      questions_to_consider: []
    },
    family_wellness_tips: aiAnalysis.family_wellness_tips || [],
    family_communication_goals: aiAnalysis.family_communication_goals || [
      { goal_type: "This Week", description: "Continue regular check-ins" },
      { goal_type: "Ongoing", description: "Maintain supportive environment" },
      { goal_type: "If Needed", description: "Seek professional guidance" }
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

    // Fetch last 10 sessions for trend analysis
    const { data: recentSessions, error: sessionsError } = await supabase
      .from("therapy_sessions")
      .select("*")
      .eq("child_id", childId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (sessionsError) throw sessionsError;

    // Get total sessions count
    const { count: totalSessionCount, error: totalCountError } = await supabase
      .from("therapy_sessions")
      .select("*", { count: "exact", head: true })
      .eq("child_id", childId);

    if (totalCountError) throw totalCountError;

    // Calculate average duration from recent sessions
    const averageDuration =
      recentSessions?.reduce((acc, s) => acc + (s.session_duration || 0), 0) /
      (recentSessions?.length || 1);

    // Calculate analytics from recent sessions using OpenAI
    const analytics = await calculateAnalytics(
      childId,
      recentSessions || [],
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
      await requireSubscriptionAccess(familyId, FEATURE_LEVELS.ADVANCED_ANALYTICS);
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        status: 403
      };
    }

    const supabase = createServerSupabase();

    // Validate child access
    const hasAccess = await validateChildAccess(familyId, childId);
    if (!hasAccess) {
      return {
        success: false,
        error: 'Access denied to this child',
        status: 403
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
        message: "No analytics data available for this child yet"
      };
    }

    if (error) {
      throw error;
    }

    // Check if analytics data is from the current week
    if (analytics && !isAnalyticsDataCurrent(analytics.updated_at)) {
      console.log("Analytics data is from a previous week, triggering auto-refresh...");
      
      try {
        // Get child data for family_id
        const { data: child, error: childError } = await supabase
          .from("children")
          .select("id, family_id")
          .eq("id", childId)
          .single();

        if (childError || !child?.family_id) {
          console.warn("Could not get child data for auto-refresh, returning stale data");
          return {
            success: true,
            data: analytics
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
          console.warn("Could not get latest session for auto-refresh, returning stale data");
          return {
            success: true,
            data: analytics
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
            data: updatedAnalytics
          };
        }
      } catch (refreshError) {
        console.warn("Failed to auto-refresh analytics, returning stale data:", refreshError);
      }
    }

    return {
      success: true,
      data: analytics
    };

  } catch (error) {
    console.error('Error fetching dashboard analytics:', error);
    return {
      success: false,
      error: 'Failed to fetch dashboard analytics',
      status: 500
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
        error: 'Child not found',
        status: 404,
        details: `No child found with ID: ${normalizedChildId}`,
        code: 'CHILD_NOT_FOUND'
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
        error: 'Database error while fetching child',
        status: 500,
        details: childError,
        code: 'DATABASE_ERROR'
      };
    }

    if (!child?.family_id) {
      return {
        success: false,
        error: 'Family ID not found for this child',
        status: 400
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
        error: 'Failed to fetch latest session',
        status: 500,
        details: sessionError
      };
    }

    if (!session) {
      return {
        success: false,
        error: 'No therapy sessions found for this child yet',
        status: 400,
        message: 'No therapy sessions found for this child yet'
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
        error: 'Failed to calculate analytics',
        status: 500,
        details: calcError
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
        error: 'Failed to fetch updated analytics',
        status: 202,
        details: analyticsError,
        message: 'Analytics calculation was triggered but verification failed'
      };
    }

    // Return the analytics record if it exists, or a success message if not
    return {
      success: true,
      data: analyticsData || { message: "Analytics calculation triggered" },
      analyticsStatus: analyticsData ? "completed" : "processing"
    };

  } catch (error) {
    console.error('Error in update dashboard analytics service:', error);
    return {
      success: false,
      error: 'Failed to update dashboard analytics',
      status: 500,
      details: error,
      message: 'An error occurred while calculating or storing analytics'
    };
  }
} 