import { createServerSupabase } from "../lib/supabase.js";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function generateCompletionInsights(
  childId: string,
  familyId: string
) {
  try {
    const supabase = createServerSupabase();

    // Verify child belongs to family and get session info
    const { data: child, error: childError } = await supabase
      .from("children")
      .select("id, name, age, last_session_at, last_session_had_conversation")
      .eq("id", childId)
      .eq("family_id", familyId)
      .single();

    if (childError || !child) {
      throw new Error("Child not found or access denied");
    }

    // Check if the last session had no conversation
    if (child.last_session_had_conversation === false) {
      throw new Error("Latest session has no conversation data");
    }

    // Get the most recent completed session for this child
    const { data: session, error: sessionError } = await supabase
      .from("therapy_sessions")
      .select("*")
      .eq("child_id", childId)
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (sessionError || !session) {
      throw new Error("No completed session found");
    }

    // Validate that the session has meaningful content
    const messages = session.messages || [];
    const hasConversation =
      messages.length > 0 &&
      messages.some((msg: any) => msg.content && msg.content.trim().length > 0);

    // if (!hasConversation) {
    //   throw new Error("Latest session has no conversation data");
    // }

    // Generate AI completion insights based on the session
    const completionInsights = await generateAIInsights(session, child);

    return {
      insights: completionInsights,
      childName: child.name,
    };
  } catch (error) {
    console.error("❌ Error in generateCompletionInsights:", error);
    throw error;
  }
}

async function generateAIInsights(session: any, child: any) {
  try {
    // Extract relevant session data
    const messages = session.messages || [];
    const moodAnalysis = session.mood_analysis;
    const topics = session.topics || [];
    const sessionSummary = session.session_summary;

    // Prepare the conversation context for analysis
    const conversationText = messages
      .map((msg: any) => `${msg.sender}: ${msg.content}`)
      .join("\n");

    const prompt = `
You are a child therapist AI analyzing THIS SPECIFIC therapy session to create positive, personalized insights for parents.

IMPORTANT: Base your response on the ACTUAL conversation below. Be specific about what ${
      child.name
    } discussed, learned, and accomplished in THIS session.

Child Info:
- Name: ${child.name}
- Age: ${child.age}

Session Data:
- Duration: ${session.session_duration || "N/A"} minutes
- Topics Discussed: ${topics.join(", ") || "General emotional support"}
- Mood Analysis: ${JSON.stringify(moodAnalysis) || "Not available"}
- Session Summary: ${sessionSummary || "Not available"}

ACTUAL SESSION CONVERSATION:
${conversationText.slice(-2000)} // Last 2000 chars for better context

INSTRUCTIONS:
1. Read the ACTUAL conversation above carefully
2. Look for DEEPER PATTERNS and core conflicts such as:
   - Independence vs comfort/security needs
   - Wanting to be brave vs needing safety
   - Desire for control vs fear of responsibility  
   - Social belonging vs individual identity
   - Growing up vs staying little
3. Identify any developmental struggles or internal conflicts ${
      child.name
    } revealed
4. Notice how ${
      child.name
    } navigated these conflicts or tensions during the session
5. Focus on psychological insights, not just surface behaviors
6. Address the ROOT CONFLICT, not just symptoms (e.g., don't just suggest "night lights" for fear - address the independence vs comfort struggle)

Generate insights based on DEEPER ANALYSIS of what happened:
1. "main_achievement" - What core conflict or developmental challenge ${
      child.name
    } worked through (name the real psychological pattern)
2. "key_insights" - Array of 2-3 DEEPER observations about ${
      child.name
    }'s internal world and emotional patterns from this session
3. "coping_strategies" - Array of 1-2 MEANINGFUL approaches that address the root conflict, not just surface symptoms
4. "parent_note" - Insight about the deeper developmental work ${
      child.name
    } is doing and how parents can support this growth
5. "emotional_highlights" - Array of 2 moments where ${
      child.name
    } showed psychological growth or self-awareness about their conflicts

TONE: Warm and celebratory, but SPECIFIC to this session
FOCUS: What ACTUALLY happened in their conversation today
AVOID: Generic statements, clinical language, anything not based on the real conversation

Make it personal to ${child.name}'s actual session experience!

Return only a valid JSON object.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content:
            "You are a skilled child therapist with deep psychological insight. Analyze this session for CORE CONFLICTS and developmental patterns. Look beyond surface issues to identify internal struggles like independence vs security, wanting to be brave vs needing comfort, etc. Name these deeper patterns and show how the child is working through them. Avoid generic advice - focus on the real psychological work happening. Be positive but psychologically sophisticated.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 800,
    });

    const insightsText = response.choices[0]?.message?.content;
    if (!insightsText) {
      throw new Error("No insights generated from OpenAI");
    }

    // Parse the JSON response
    const insights = JSON.parse(insightsText);

    return insights;
  } catch (error) {
    console.error("❌ Error generating AI insights:", error);

    // Fallback insights if AI fails
    return {
      main_achievement: `${child.name} worked through the natural developmental tension between wanting independence and needing comfort - a sign of healthy emotional growth.`,
      key_insights: [
        `${child.name} is navigating the normal conflict between wanting to be brave and needing security`,
        "Shows awareness of their own internal struggles and mixed feelings",
        "Demonstrates psychological insight by recognizing that having conflicting emotions is okay",
      ],
      coping_strategies: [
        "Learning to honor both parts of themselves - the brave part AND the part that needs comfort",
        "Developing self-compassion for having mixed feelings about growing up",
      ],
      parent_note: `${child.name} is doing important developmental work by acknowledging their internal conflicts - this self-awareness is a huge strength!`,
      emotional_highlights: [
        `${child.name} showed courage by expressing conflicting feelings honestly`,
        "Demonstrated emotional maturity by recognizing that growth involves internal tensions",
      ],
    };
  }
}
