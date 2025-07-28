import OpenAI from "openai";
import { createServerSupabase } from "../lib/supabase.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type Message = {
  sender: "child" | "ai";
  content: string;
  timestamp: string;
};

interface SessionResult {
  success: boolean;
  error?: string;
  status?: number;
  sessions?: any[];
  session?: any;
}

// Analyze mood using OpenAI for accurate emotional assessment
async function analyzeMoodFromMessage(
  userMessage: string,
  aiResponse: string
): Promise<any> {
  try {
    const prompt = `Analyze the emotional state of a child based on their message. Provide a detailed mood analysis with scores from 1-10 for each dimension.

Child's message: "${userMessage}"

Please analyze the emotional content and provide scores for:
- happiness (1=very sad, 10=very happy)
- anxiety (1=very calm, 10=very anxious)
- sadness (1=not sad at all, 10=extremely sad)
- stress (1=very relaxed, 10=extremely stressed)
- confidence (1=very low confidence, 10=very confident)

IMPORTANT: Pay special attention to concerning content like:
- Thoughts of harm to self or others
- Suicidal ideation
- Extreme emotional distress
- Violent thoughts
- Hopelessness

For concerning content, use appropriate high scores for anxiety, sadness, and stress.

Respond with a JSON object only:
{
  "happiness": number,
  "anxiety": number,
  "sadness": number,
  "stress": number,
  "confidence": number,
  "insights": "Brief clinical observation about the emotional state"
}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a child psychologist specializing in emotional assessment. Provide accurate, nuanced mood analysis based on the child's message content.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 300,
      temperature: 0.3,
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error("No response from OpenAI");
    }

    // Parse the JSON response
    const moodAnalysis = JSON.parse(response);

    // Ensure all scores are within 1-10 range
    moodAnalysis.happiness = Math.max(
      1,
      Math.min(10, moodAnalysis.happiness || 5)
    );
    moodAnalysis.anxiety = Math.max(1, Math.min(10, moodAnalysis.anxiety || 5));
    moodAnalysis.sadness = Math.max(1, Math.min(10, moodAnalysis.sadness || 5));
    moodAnalysis.stress = Math.max(1, Math.min(10, moodAnalysis.stress || 5));
    moodAnalysis.confidence = Math.max(
      1,
      Math.min(10, moodAnalysis.confidence || 5)
    );

    return moodAnalysis;
  } catch (error) {
    console.error("Error analyzing mood with OpenAI:", error);
    // Return default neutral mood scores
    return {
      happiness: 5,
      anxiety: 5,
      sadness: 5,
      stress: 5,
      confidence: 5,
      insights: "Unable to analyze mood - using default values",
    };
  }
}

// Extract topics from message using OpenAI
async function extractTopicsFromMessage(message: string): Promise<string[]> {
  try {
    const prompt = `Extract the main topics and themes from this child's message. Focus on:
- Emotional themes (anxiety, happiness, sadness, anger, fear)
- Life areas (school, family, friends, activities)
- Specific concerns or issues
- Behavioral patterns
- Social situations

Child's message: "${message}"

Respond with a JSON array of topic names only, no explanations:
["topic1", "topic2"]`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are a child psychology expert who can quickly identify the main themes and topics in children's messages. Provide accurate topic categorization.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 100,
      temperature: 0.3,
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error("No response from OpenAI");
    }

    // Parse the JSON response
    const topics = JSON.parse(response);

    // Ensure it's an array and has valid topics
    if (Array.isArray(topics) && topics.length > 0) {
      return topics;
    }

    return ["General conversation"];
  } catch (error) {
    console.error("Error extracting topics with OpenAI:", error);

    // Fallback to basic keyword detection for critical cases
    const lowerMessage = message.toLowerCase();

    // Simple fallback checks for concerning content
    if (
      lowerMessage.includes("suicide") ||
      lowerMessage.includes("kill") ||
      lowerMessage.includes("die")
    ) {
      return ["Crisis intervention"];
    }
    if (lowerMessage.includes("bully") || lowerMessage.includes("hurt me")) {
      return ["Bullying concerns"];
    }
    if (lowerMessage.includes("anxious") || lowerMessage.includes("worried")) {
      return ["Anxiety"];
    }

    return ["General conversation"];
  }
}

// Check for alerts based on mood analysis and message content
function checkForAlert(moodAnalysis: any, message: string): boolean {
  if (!moodAnalysis) return false;

  const { anxiety, sadness, stress } = moodAnalysis;
  const lowerMessage = message.toLowerCase();

  // Check for crisis keywords
  const crisisKeywords = [
    "suicide",
    "kill myself",
    "end it all",
    "want to die",
    "hurt myself",
    "cut myself",
    "hate myself",
    "worthless",
    "hopeless",
  ];

  const hasCrisisKeywords = crisisKeywords.some((keyword) =>
    lowerMessage.includes(keyword)
  );

  // Alert if high emotional distress or crisis keywords
  return hasCrisisKeywords || anxiety >= 8 || sadness >= 8 || stress >= 8;
}

// Determine alert level
function determineAlertLevel(
  moodAnalysis: any,
  message: string
): string | null {
  if (!checkForAlert(moodAnalysis, message)) return null;

  const { anxiety, sadness, stress } = moodAnalysis;
  const lowerMessage = message.toLowerCase();

  // High alert for crisis keywords or extreme scores
  const crisisKeywords = [
    "suicide",
    "kill myself",
    "end it all",
    "want to die",
  ];
  const hasCrisisKeywords = crisisKeywords.some((keyword) =>
    lowerMessage.includes(keyword)
  );

  if (hasCrisisKeywords || anxiety >= 9 || sadness >= 9 || stress >= 9) {
    return "high";
  }

  return "medium";
}

// Generate alert message
function generateAlertMessage(
  moodAnalysis: any,
  message: string,
  alertLevel: "high" | "medium"
): string {
  if (alertLevel === "high") {
    return "HIGH PRIORITY: Child expressing severe emotional distress or concerning thoughts. Immediate intervention recommended.";
  }

  return "MEDIUM PRIORITY: Child showing elevated emotional distress. Monitor closely and consider additional support.";
}

// Calculate session duration from messages
function calculateSessionDuration(messages: Message[]): number {
  if (!messages || messages.length < 2) return 5;

  const firstMessage = new Date(messages[0].timestamp);
  const lastMessage = new Date(messages[messages.length - 1].timestamp);

  const durationMs = lastMessage.getTime() - firstMessage.getTime();
  const durationMinutes = Math.max(1, Math.floor(durationMs / (1000 * 60)));

  return Math.min(120, durationMinutes); // Cap at 2 hours
}

export async function getSessions(
  familyId: string,
  limit: number = 50,
  childId?: string
): Promise<SessionResult> {
  try {
    const supabase = createServerSupabase();

    let query = supabase
      .from("therapy_sessions")
      .select(
        `
        *,
        children!inner(
          id,
          name,
          family_id
        )
      `
      )
      .eq("children.family_id", familyId);

    if (childId) {
      query = query.eq("child_id", childId);
    }

    const { data: sessions, error } = await query
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("Error fetching sessions:", error);
      return {
        success: false,
        error: "Failed to fetch sessions",
        status: 500,
      };
    }

    // Process sessions to ensure mood analysis is available
    const processedSessions = await Promise.all(
      (sessions || []).map(async (session) => {
        let moodAnalysis = session.mood_analysis;

        // Get all child messages from the messages array
        const messages = session.messages || [];
        const childMessages = messages
          .filter((msg: Message) => msg.sender === "child")
          .map((msg: Message) => msg.content)
          .join("\n");

        const aiMessages = messages
          .filter((msg: Message) => msg.sender === "ai")
          .map((msg: Message) => msg.content)
          .join("\n");

        // Re-analyze mood if needed
        if (!moodAnalysis && childMessages) {
          moodAnalysis = await analyzeMoodFromMessage(
            childMessages,
            aiMessages
          );
        }

        // Extract topics from the messages
        const topics = childMessages
          ? await extractTopicsFromMessage(childMessages)
          : ["General conversation"];

        // Check for alerts
        const hasAlert = moodAnalysis
          ? checkForAlert(moodAnalysis, childMessages)
          : false;
        const alertLevel =
          hasAlert && moodAnalysis
            ? determineAlertLevel(moodAnalysis, childMessages)
            : null;
        const alertMessage =
          hasAlert && moodAnalysis
            ? generateAlertMessage(
                moodAnalysis,
                childMessages,
                alertLevel as "high" | "medium"
              )
            : null;

        return {
          ...session,
          mood_analysis: moodAnalysis,
          topics,
          has_alert: hasAlert,
          alert_level: alertLevel,
          alert_message: alertMessage,
        };
      })
    );

    return {
      success: true,
      sessions: processedSessions,
    };
  } catch (error) {
    console.error("Error in getSessions service:", error);
    return {
      success: false,
      error: "Internal server error",
      status: 500,
    };
  }
}

export async function createSession(
  familyId: string,
  childId: string,
  messages: Message[],
  moodAnalysis?: any,
  sessionSummary?: string
): Promise<SessionResult> {
  try {
    const supabase = createServerSupabase();

    // Verify child belongs to this family
    const { data: child, error: childError } = await supabase
      .from("children")
      .select("id")
      .eq("id", childId)
      .eq("family_id", familyId)
      .eq("is_active", true)
      .single();

    if (childError || !child) {
      return {
        success: false,
        error: "Child not found or access denied",
        status: 404,
      };
    }

    // Get all child messages and AI responses
    const childMessages = messages
      .filter((msg: Message) => msg.sender === "child")
      .map((msg: Message) => msg.content)
      .join("\n");

    const aiMessages = messages
      .filter((msg: Message) => msg.sender === "ai")
      .map((msg: Message) => msg.content)
      .join("\n");

    // Analyze mood if not provided
    let finalMoodAnalysis = moodAnalysis;
    if (!finalMoodAnalysis && childMessages) {
      finalMoodAnalysis = await analyzeMoodFromMessage(
        childMessages,
        aiMessages
      );
    }

    // Extract topics
    const topics = childMessages
      ? await extractTopicsFromMessage(childMessages)
      : ["General conversation"];

    // Check for alerts
    const hasAlert = finalMoodAnalysis
      ? checkForAlert(finalMoodAnalysis, childMessages)
      : false;
    const alertLevel =
      hasAlert && finalMoodAnalysis
        ? determineAlertLevel(finalMoodAnalysis, childMessages)
        : null;
    const alertMessage =
      hasAlert && finalMoodAnalysis
        ? generateAlertMessage(
            finalMoodAnalysis,
            childMessages,
            alertLevel as "high" | "medium"
          )
        : null;

    // Create session record
    const { data: session, error: sessionError } = await supabase
      .from("therapy_sessions")
      .insert({
        child_id: childId,
        messages: messages,
        mood_analysis: finalMoodAnalysis,
        session_summary: sessionSummary || null,
        session_duration: calculateSessionDuration(messages),
        topics: topics,
        has_alert: hasAlert,
        alert_level: alertLevel,
        alert_message: alertMessage,
        status: "active",
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (sessionError) {
      console.error("Error creating session:", sessionError);
      return {
        success: false,
        error: "Failed to create session",
        status: 500,
      };
    }

    return {
      success: true,
      session,
    };
  } catch (error) {
    console.error("Error in createSession service:", error);
    return {
      success: false,
      error: "Internal server error",
      status: 500,
    };
  }
}

export async function getSession(
  familyId: string,
  sessionId: string
): Promise<SessionResult> {
  try {
    const supabase = createServerSupabase();

    const { data: session, error } = await supabase
      .from("therapy_sessions")
      .select(
        `
        *,
        children!inner(
          id,
          name,
          family_id
        )
      `
      )
      .eq("id", sessionId)
      .eq("children.family_id", familyId)
      .single();

    if (error || !session) {
      return {
        success: false,
        error: "Session not found or access denied",
        status: 404,
      };
    }

    return {
      success: true,
      session,
    };
  } catch (error) {
    console.error("Error in getSession service:", error);
    return {
      success: false,
      error: "Internal server error",
      status: 500,
    };
  }
}

export async function updateSession(
  familyId: string,
  sessionId: string,
  updates: any
): Promise<SessionResult> {
  try {
    const supabase = createServerSupabase();

    // First verify session belongs to family
    const { data: existingSession, error: fetchError } = await supabase
      .from("therapy_sessions")
      .select(
        `
        id,
        children!inner(
          id,
          family_id
        )
      `
      )
      .eq("id", sessionId)
      .eq("children.family_id", familyId)
      .single();

    if (fetchError || !existingSession) {
      return {
        success: false,
        error: "Session not found or access denied",
        status: 404,
      };
    }

    // Update the session
    const { data: session, error: updateError } = await supabase
      .from("therapy_sessions")
      .update(updates)
      .eq("id", sessionId)
      .select()
      .single();

    if (updateError) {
      console.error("Error updating session:", updateError);
      return {
        success: false,
        error: "Failed to update session",
        status: 500,
      };
    }

    return {
      success: true,
      session,
    };
  } catch (error) {
    console.error("Error in updateSession service:", error);
    return {
      success: false,
      error: "Internal server error",
      status: 500,
    };
  }
}

export async function deleteSession(
  familyId: string,
  sessionId: string
): Promise<SessionResult> {
  try {
    const supabase = createServerSupabase();

    // First verify session belongs to family
    const { data: existingSession, error: fetchError } = await supabase
      .from("therapy_sessions")
      .select(
        `
        id,
        children!inner(
          id,
          family_id
        )
      `
      )
      .eq("id", sessionId)
      .eq("children.family_id", familyId)
      .single();

    if (fetchError || !existingSession) {
      return {
        success: false,
        error: "Session not found or access denied",
        status: 404,
      };
    }

    // Delete the session
    const { error: deleteError } = await supabase
      .from("therapy_sessions")
      .delete()
      .eq("id", sessionId);

    if (deleteError) {
      console.error("Error deleting session:", deleteError);
      return {
        success: false,
        error: "Failed to delete session",
        status: 500,
      };
    }

    return {
      success: true,
    };
  } catch (error) {
    console.error("Error in deleteSession service:", error);
    return {
      success: false,
      error: "Internal server error",
      status: 500,
    };
  }
}
