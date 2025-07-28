import OpenAI from 'openai';
import { createServerSupabase } from '../lib/supabase.js';
import { requireSubscriptionAccess, FEATURE_LEVELS } from '../lib/subscription-access.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Simple in-memory cache for mood analysis (clears every 5 minutes)
const moodAnalysisCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

interface MoodScores {
  happiness: number;
  anxiety: number;
  sadness: number;
  stress: number;
  confidence: number;
}

interface MoodResult {
  success: boolean;
  error?: string;
  status?: number;
  data?: any;
  moodEntry?: any;
  moodAnalysis?: any;
  aiAnalysis?: any;
  has_alert?: boolean;
  alert_level?: string | null;
  alert_message?: string | null;
  message?: string;
  details?: string;
  child?: any;
  results?: any[];
  totalEntries?: number;
  reanalyzedCount?: number;
}

interface Message {
  sender: 'child' | 'ai';
  content: string;
  timestamp: string;
}

function getCachedMoodAnalysis(input: string, childAge?: number): any | null {
  const cacheKey = `${input.substring(0, 100)}_${childAge || 'unknown'}`;
  const cached = moodAnalysisCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.analysis;
  }
  
  return null;
}

function setCachedMoodAnalysis(input: string, childAge: number | undefined, analysis: any): void {
  const cacheKey = `${input.substring(0, 100)}_${childAge || 'unknown'}`;
  moodAnalysisCache.set(cacheKey, {
    analysis,
    timestamp: Date.now()
  });
  
  // Clean up old entries
  if (moodAnalysisCache.size > 100) {
    const now = Date.now();
    const entries = Array.from(moodAnalysisCache.entries());
    for (const [key, value] of entries) {
      if (now - value.timestamp > CACHE_DURATION) {
        moodAnalysisCache.delete(key);
      }
    }
  }
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

async function analyzeMoodFromInput(input: string, childAge?: number): Promise<any> {
  try {
    // Check cache first
    const cached = getCachedMoodAnalysis(input, childAge);
    if (cached) {
      return cached;
    }

    const prompt = `Analyze the emotional state from this message: "${input}"
${childAge ? `Child's age: ${childAge} years` : ""}

Provide scores (1-10) for: happiness, anxiety, sadness, stress, confidence.
Watch for concerning content (harm, suicide, extreme distress).

Respond with JSON only:
{
  "happiness": number,
  "anxiety": number,
  "sadness": number,
  "stress": number,
  "confidence": number,
  "insights": "Brief observation"
}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a child psychologist. Provide accurate mood analysis in JSON format only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 150,
      temperature: 0.2,
    });

    const response = completion.choices[0]?.message?.content;
    if (!response) {
      throw new Error("No response from OpenAI");
    }

    const moodAnalysis = JSON.parse(response);

    // Ensure all scores are within 1-10 range
    moodAnalysis.happiness = Math.max(1, Math.min(10, moodAnalysis.happiness || 5));
    moodAnalysis.anxiety = Math.max(1, Math.min(10, moodAnalysis.anxiety || 5));
    moodAnalysis.sadness = Math.max(1, Math.min(10, moodAnalysis.sadness || 5));
    moodAnalysis.stress = Math.max(1, Math.min(10, moodAnalysis.stress || 5));
    moodAnalysis.confidence = Math.max(1, Math.min(10, moodAnalysis.confidence || 5));

    // Cache the result
    setCachedMoodAnalysis(input, childAge, moodAnalysis);

    return moodAnalysis;
  } catch (error) {
    console.error("Error analyzing mood with OpenAI:", error);
    
    return {
      happiness: 5,
      anxiety: 5,
      sadness: 5,
      stress: 5,
      confidence: 5,
      insights: "Unable to analyze mood - using neutral baseline scores",
    };
  }
}

function checkForAlert(mood: any, message: string): boolean {
  if (mood.anxiety >= 7 || mood.stress >= 7 || mood.sadness >= 7) {
    return true;
  }
  
  if (mood.happiness <= 2 && mood.confidence <= 2) {
    return true;
  }

  return false;
}

function determineAlertLevel(mood: any, message: string): 'high' | 'medium' {
  if (mood.anxiety >= 8 || mood.sadness >= 8 || mood.stress >= 8) {
    return 'high';
  }
  
  if (mood.happiness <= 1 || mood.confidence <= 1) {
    return 'high';
  }

  return 'medium';
}

function generateAlertMessage(mood: any, message: string, level: 'high' | 'medium'): string {
  const concerns = [];
  
  if (mood.anxiety >= 7) concerns.push('elevated anxiety');
  if (mood.sadness >= 7) concerns.push('significant sadness');
  if (mood.stress >= 7) concerns.push('high stress levels');
  if (mood.confidence <= 3) concerns.push('low self-confidence');

  const concernsText = concerns.length > 0 ? concerns.join(', ') : 'emotional distress';

  if (level === 'high') {
    return `Your child is experiencing ${concernsText} and may need immediate support. Consider scheduling a check-in conversation or contacting a mental health professional. Recent message indicated significant emotional distress.`;
  } else {
    return `Your child is showing signs of ${concernsText}. This might be a good time to check in with them about how they're feeling and offer some extra support.`;
  }
}

function analyzeMoodStatus(moodEntries: any[]) {
  if (moodEntries.length === 0) {
    return {
      status: "No Data",
      level: "neutral",
      trend: "stable",
      insights: "No mood data available yet",
      recommendations: [
        "Start tracking daily mood",
        "Encourage regular check-ins",
      ],
      currentAverages: {
        happiness: 5,
        anxiety: 5,
        sadness: 5,
        stress: 5,
        confidence: 5,
      },
    };
  }

  const recentEntries = moodEntries.slice(-3);

  const currentAverages = {
    happiness: Math.round(
      recentEntries.reduce((sum, entry) => sum + entry.happiness, 0) / recentEntries.length
    ),
    anxiety: Math.round(
      recentEntries.reduce((sum, entry) => sum + entry.anxiety, 0) / recentEntries.length
    ),
    sadness: Math.round(
      recentEntries.reduce((sum, entry) => sum + entry.sadness, 0) / recentEntries.length
    ),
    stress: Math.round(
      recentEntries.reduce((sum, entry) => sum + entry.stress, 0) / recentEntries.length
    ),
    confidence: Math.round(
      recentEntries.reduce((sum, entry) => sum + entry.confidence, 0) / recentEntries.length
    ),
  };

  let status = "Stable";
  let level = "neutral";
  let insights = "Mood appears to be within normal range";
  let recommendations = [
    "Continue regular check-ins",
    "Maintain supportive environment",
  ];

  const highStress = currentAverages.anxiety >= 6 || currentAverages.sadness >= 6 || currentAverages.stress >= 6;
  const lowConfidence = currentAverages.confidence <= 4;
  const highHappiness = currentAverages.happiness >= 8;
  const veryHighStress = currentAverages.anxiety >= 8 || currentAverages.sadness >= 8 || currentAverages.stress >= 8;

  if (veryHighStress) {
    status = "Needs Immediate Attention";
    level = "critical";
    insights = "Significantly elevated levels of anxiety, sadness, or stress detected - immediate support recommended";
    recommendations = [
      "Schedule immediate quality time together",
      "Practice relaxation techniques",
      "Consider professional support",
      "Monitor for concerning behaviors",
    ];
  } else if (highStress) {
    status = "Needs Attention";
    level = "concerning";
    insights = "Elevated levels of anxiety, sadness, or stress detected";
    recommendations = [
      "Schedule quality time together",
      "Practice relaxation techniques",
      "Consider professional support if needed",
      "Monitor emotional patterns",
    ];
  } else if (lowConfidence) {
    status = "Confidence Building Needed";
    level = "moderate";
    insights = "Low confidence levels may need support and encouragement";
    recommendations = [
      "Focus on building self-esteem",
      "Celebrate small achievements",
      "Encourage positive self-talk",
      "Provide reassurance and support",
    ];
  } else if (highHappiness) {
    status = "Positive";
    level = "positive";
    insights = "Child is showing positive emotional well-being";
    recommendations = [
      "Maintain supportive environment",
      "Continue positive reinforcement",
      "Encourage continued engagement",
    ];
  }

  let trend = "stable";
  if (moodEntries.length >= 2) {
    const previousEntries = moodEntries.slice(-4, -1);
    if (previousEntries.length > 0) {
      const previousAverages = {
        anxiety: Math.round(
          previousEntries.reduce((sum, entry) => sum + entry.anxiety, 0) / previousEntries.length
        ),
        sadness: Math.round(
          previousEntries.reduce((sum, entry) => sum + entry.sadness, 0) / previousEntries.length
        ),
        stress: Math.round(
          previousEntries.reduce((sum, entry) => sum + entry.stress, 0) / previousEntries.length
        ),
      };

      const currentStress = (currentAverages.anxiety + currentAverages.sadness + currentAverages.stress) / 3;
      const previousStress = (previousAverages.anxiety + previousAverages.sadness + previousAverages.stress) / 3;

      if (currentStress < previousStress - 0.5) {
        trend = "improving";
      } else if (currentStress > previousStress + 0.5) {
        trend = "declining";
      }
    }
  }

  return {
    status,
    level,
    trend,
    insights,
    recommendations,
    currentAverages,
  };
}

export async function getMoodData(
  familyId: string, 
  childId: string, 
  days: number = 7, 
  forceRefresh: boolean = false, 
  forceAll: boolean = false
): Promise<MoodResult> {
  try {
    // Check subscription access for mood tracking
    try {
      await requireSubscriptionAccess(familyId, FEATURE_LEVELS.MOOD_TRACKING);
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

    // Get child information
    const { data: child, error: childError } = await supabase
      .from("children")
      .select("id, name, age, current_mood")
      .eq("id", childId)
      .single();

    if (childError || !child) {
      return {
        success: false,
        error: 'Child not found',
        status: 404
      };
    }

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - days);

    // Fetch therapy sessions with mood analysis
    const { data: sessions, error: sessionsError } = await supabase
      .from("therapy_sessions")
      .select("id, created_at, mood_analysis, messages")
      .eq("child_id", childId)
      .gte("created_at", startDate.toISOString())
      .lte("created_at", endDate.toISOString())
      .order("created_at", { ascending: true });

    if (sessionsError) {
      console.error("Error fetching therapy sessions:", sessionsError);
      return {
        success: false,
        error: 'Failed to fetch therapy sessions',
        status: 500
      };
    }

    // Transform therapy sessions into mood tracking entries
    const moodEntries = [];
    const dailySessions = new Map();

    // Group sessions by date and process
    for (const session of sessions || []) {
      const sessionDate = session.created_at.split("T")[0];
      
      if (!dailySessions.has(sessionDate)) {
        dailySessions.set(sessionDate, []);
      }
      dailySessions.get(sessionDate).push(session);
    }

    // Process each day's sessions
    for (const [date, daySessions] of Array.from(dailySessions.entries())) {
      const dayMoodScores = [];
      const dayNotes = [];
      let latestSessionId = null;
      let latestSessionTime = null;

      for (const session of daySessions) {
        latestSessionId = session.id;
        latestSessionTime = session.created_at;

        if (session.mood_analysis && !forceRefresh) {
          dayMoodScores.push({
            happiness: session.mood_analysis.happiness || 5,
            anxiety: session.mood_analysis.anxiety || 5,
            sadness: session.mood_analysis.sadness || 5,
            stress: session.mood_analysis.stress || 5,
            confidence: session.mood_analysis.confidence || 5,
            insights: session.mood_analysis.insights || "Existing analysis",
          });
          dayNotes.push(`[Session ${session.id}: ${session.mood_analysis.insights || 'Existing'}]`);
        } else if (session.messages?.some((msg: Message) => msg.sender === 'child')) {
          try {
            const childMessage = session.messages.find((msg: Message) => msg.sender === 'child')?.content || '';
            const aiMoodAnalysis = await analyzeMoodFromInput(childMessage, child.age);

            dayMoodScores.push(aiMoodAnalysis);
            dayNotes.push(`[Session ${session.id}: ${aiMoodAnalysis.insights}]`);

            // Cache the analysis
            if (!session.mood_analysis || forceRefresh) {
              await supabase
                .from("therapy_sessions")
                .update({ mood_analysis: aiMoodAnalysis })
                .eq("id", session.id);
            }
          } catch (error) {
            console.error(`Error analyzing session ${session.id}:`, error);
            dayMoodScores.push({
              happiness: 5, anxiety: 5, sadness: 5, stress: 5, confidence: 5,
              insights: "No analysis available",
            });
          }
        }
      }

      // Calculate averaged mood scores for the day
      if (dayMoodScores.length > 0) {
        const averagedMood = {
          happiness: Math.round(dayMoodScores.reduce((sum, score) => sum + score.happiness, 0) / dayMoodScores.length),
          anxiety: Math.round(dayMoodScores.reduce((sum, score) => sum + score.anxiety, 0) / dayMoodScores.length),
          sadness: Math.round(dayMoodScores.reduce((sum, score) => sum + score.sadness, 0) / dayMoodScores.length),
          stress: Math.round(dayMoodScores.reduce((sum, score) => sum + score.stress, 0) / dayMoodScores.length),
          confidence: Math.round(dayMoodScores.reduce((sum, score) => sum + score.confidence, 0) / dayMoodScores.length),
        };

        const moodEntry = {
          id: latestSessionId,
          child_id: childId,
          ...averagedMood,
          notes: dayNotes.join(" | "),
          recorded_at: latestSessionTime,
          session_id: latestSessionId,
          session_count: daySessions.length,
        };

        moodEntries.push(moodEntry);
      }
    }

    // Transform data for chart display
    const moodData = moodEntries.map((entry) => {
      const hasAlert = checkForAlert(entry, entry.notes || "");
      const alertLevel = hasAlert ? determineAlertLevel(entry, entry.notes || "") : null;
      const alertMessage = hasAlert ? generateAlertMessage(entry, entry.notes || "", alertLevel as 'high' | 'medium') : null;

      return {
        date: entry.recorded_at.split("T")[0],
        happiness: entry.happiness,
        anxiety: entry.anxiety,
        sadness: entry.sadness,
        stress: entry.stress,
        confidence: entry.confidence,
        notes: entry.notes || "",
        session_id: entry.session_id,
        session_count: entry.session_count || 1,
        has_alert: hasAlert,
        alert_level: alertLevel,
        alert_message: alertMessage,
      };
    });

    const moodAnalysis = analyzeMoodStatus(moodEntries);
    
    // Check if we have real mood data
    const hasRealMoodData = moodEntries.some(entry => {
      const hasNonNeutralScores = 
        (entry.happiness !== 5 && entry.happiness !== null) ||
        (entry.anxiety !== 5 && entry.anxiety !== null) ||
        (entry.sadness !== 5 && entry.sadness !== null) ||
        (entry.stress !== 5 && entry.stress !== null) ||
        (entry.confidence !== 5 && entry.confidence !== null);
      
      const hasMeaningfulNotes = entry.notes && 
        entry.notes.trim().length > 0 && 
        !entry.notes.includes('Unable to analyze mood');
      
      return hasNonNeutralScores || hasMeaningfulNotes;
    });

    // Generate baseline data if no real mood data
    if (!hasRealMoodData) {
      const baselineData = [];
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        baselineData.push({
          date: date.toISOString().split("T")[0],
          happiness: 5, anxiety: 5, sadness: 5, stress: 5, confidence: 5,
          notes: "",
        });
      }

      return {
        success: true,
        data: {
          child: { id: child.id, name: child.name, age: child.age },
          moodData: baselineData,
          moodAnalysis: {
            status: "No Data", level: "neutral", trend: "stable",
            insights: "No mood data available yet",
            recommendations: ["Start tracking daily mood", "Encourage regular check-ins"],
            currentAverages: { happiness: 5, anxiety: 5, sadness: 5, stress: 5, confidence: 5 },
          },
          totalEntries: 0,
          dateRange: {
            start: startDate.toISOString().split("T")[0],
            end: endDate.toISOString().split("T")[0],
          },
          message: "No mood data yet - showing baseline",
        }
      };
    }

    return {
      success: true,
      data: {
        child: { id: child.id, name: child.name, age: child.age },
        moodData,
        moodAnalysis,
        totalEntries: moodEntries.length,
        dateRange: {
          start: startDate.toISOString().split("T")[0],
          end: endDate.toISOString().split("T")[0],
        },
        lastUpdated: moodEntries[moodEntries.length - 1]?.recorded_at,
        source: "therapy_sessions",
      }
    };

  } catch (error) {
    console.error('Error in mood tracking service:', error);
    return {
      success: false,
      error: 'Failed to process mood tracking request',
      status: 500
    };
  }
}

export async function recordMood(
  familyId: string,
  childId: string,
  moodScores: Partial<MoodScores>,
  notes?: string,
  moodDescription?: string
): Promise<MoodResult> {
  try {
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

    // Get child information
    const { data: child, error: childError } = await supabase
      .from("children")
      .select("id, name, age")
      .eq("id", childId)
      .single();

    if (childError || !child) {
      return {
        success: false,
        error: 'Child not found',
        status: 404
      };
    }

    let finalMood = {
      happiness: moodScores.happiness || 5,
      anxiety: moodScores.anxiety || 5,
      sadness: moodScores.sadness || 5,
      stress: moodScores.stress || 5,
      confidence: moodScores.confidence || 5,
    };

    let aiMoodAnalysis = null;

    // Use AI analysis if mood description provided
    if (moodDescription && moodDescription.trim()) {
      try {
        aiMoodAnalysis = await analyzeMoodFromInput(moodDescription, child.age);
        finalMood = {
          happiness: aiMoodAnalysis.happiness,
          anxiety: aiMoodAnalysis.anxiety,
          sadness: aiMoodAnalysis.sadness,
          stress: aiMoodAnalysis.stress,
          confidence: aiMoodAnalysis.confidence,
        };

        const updatedNotes = notes
          ? `${notes}\n\nAI Analysis: ${aiMoodAnalysis.insights}`
          : `AI Analysis: ${aiMoodAnalysis.insights}`;

        // Check for duplicate entry today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const { data: existingEntry } = await supabase
          .from("mood_tracking")
          .select("id")
          .eq("child_id", childId)
          .gte("recorded_at", today.toISOString())
          .lt("recorded_at", tomorrow.toISOString())
          .single();

        if (existingEntry) {
          return {
            success: false,
            error: "Mood entry already exists for today. Use PUT to update.",
            status: 409
          };
        }

        // Insert mood entry
        const { data: moodEntry, error } = await supabase
          .from("mood_tracking")
          .insert({
            child_id: childId,
            happiness: finalMood.happiness,
            anxiety: finalMood.anxiety,
            sadness: finalMood.sadness,
            stress: finalMood.stress,
            confidence: finalMood.confidence,
            notes: updatedNotes,
            recorded_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (error) {
          console.error("Error creating mood entry:", error);
          return {
            success: false,
            error: 'Failed to save mood data',
            status: 500
          };
        }

        // Update child's current mood
        await supabase
          .from("children")
          .update({ current_mood: finalMood })
          .eq("id", childId);

        const moodAnalysis = analyzeMoodStatus([moodEntry]);
        const hasAlert = checkForAlert(finalMood, moodDescription || "");
        const alertLevel = hasAlert ? determineAlertLevel(finalMood, moodDescription || "") : null;
        const alertMessage = hasAlert ? generateAlertMessage(finalMood, moodDescription || "", alertLevel as 'high' | 'medium') : null;

        return {
          success: true,
          moodEntry,
          moodAnalysis,
          aiAnalysis: aiMoodAnalysis,
          has_alert: hasAlert,
          alert_level: alertLevel,
          alert_message: alertMessage,
          message: "Mood entry saved successfully with AI analysis",
        };

      } catch (aiError) {
        console.error("Error with AI mood analysis:", aiError);
        // Fall back to manual input
      }
    }

    // Validate manual input
    const validateMoodValue = (value: number, name: string) => {
      if (typeof value !== "number" || value < 1 || value > 10) {
        throw new Error(`${name} must be a number between 1 and 10`);
      }
      return value;
    };

    const validatedMood = {
      happiness: validateMoodValue(finalMood.happiness, "Happiness"),
      anxiety: validateMoodValue(finalMood.anxiety, "Anxiety"),
      sadness: validateMoodValue(finalMood.sadness, "Sadness"),
      stress: validateMoodValue(finalMood.stress, "Stress"),
      confidence: validateMoodValue(finalMood.confidence, "Confidence"),
    };

    // Check for duplicate entry today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const { data: existingEntry } = await supabase
      .from("mood_tracking")
      .select("id")
      .eq("child_id", childId)
      .gte("recorded_at", today.toISOString())
      .lt("recorded_at", tomorrow.toISOString())
      .single();

    if (existingEntry) {
      return {
        success: false,
        error: "Mood entry already exists for today. Use PUT to update.",
        status: 409
      };
    }

    // Insert mood entry
    const { data: moodEntry, error } = await supabase
      .from("mood_tracking")
      .insert({
        child_id: childId,
        happiness: validatedMood.happiness,
        anxiety: validatedMood.anxiety,
        sadness: validatedMood.sadness,
        stress: validatedMood.stress,
        confidence: validatedMood.confidence,
        notes: notes || "",
        recorded_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      console.error("Error creating mood entry:", error);
      return {
        success: false,
        error: 'Failed to save mood data',
        status: 500
      };
    }

    // Update child's current mood
    await supabase
      .from("children")
      .update({ current_mood: validatedMood })
      .eq("id", childId);

    const moodAnalysis = analyzeMoodStatus([moodEntry]);
    const hasAlert = checkForAlert(validatedMood, notes || "");
    const alertLevel = hasAlert ? determineAlertLevel(validatedMood, notes || "") : null;
    const alertMessage = hasAlert ? generateAlertMessage(validatedMood, notes || "", alertLevel as 'high' | 'medium') : null;

    return {
      success: true,
      moodEntry,
      moodAnalysis,
      has_alert: hasAlert,
      alert_level: alertLevel,
      alert_message: alertMessage,
      message: "Mood entry saved successfully",
    };

  } catch (error) {
    console.error('Error in mood recording service:', error);
    if (error instanceof Error) {
      return {
        success: false,
        error: error.message,
        status: 400
      };
    }
    return {
      success: false,
      error: 'Failed to process mood tracking entry',
      status: 500
    };
  }
}

export async function updateMood(
  familyId: string,
  childId: string,
  moodId: string,
  moodScores: Partial<MoodScores>,
  notes?: string,
  moodDescription?: string
): Promise<MoodResult> {
  try {
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

    // Get child information
    const { data: child, error: childError } = await supabase
      .from("children")
      .select("id, name, age")
      .eq("id", childId)
      .single();

    if (childError || !child) {
      return {
        success: false,
        error: 'Child not found',
        status: 404
      };
    }

    let finalMood = {
      happiness: moodScores.happiness || 5,
      anxiety: moodScores.anxiety || 5,
      sadness: moodScores.sadness || 5,
      stress: moodScores.stress || 5,
      confidence: moodScores.confidence || 5,
    };

    let aiMoodAnalysis = null;

    // Use AI analysis if mood description provided
    if (moodDescription && moodDescription.trim()) {
      try {
        aiMoodAnalysis = await analyzeMoodFromInput(moodDescription, child.age);
        finalMood = {
          happiness: aiMoodAnalysis.happiness,
          anxiety: aiMoodAnalysis.anxiety,
          sadness: aiMoodAnalysis.sadness,
          stress: aiMoodAnalysis.stress,
          confidence: aiMoodAnalysis.confidence,
        };

        const updatedNotes = notes
          ? `${notes}\n\nAI Analysis: ${aiMoodAnalysis.insights}`
          : `AI Analysis: ${aiMoodAnalysis.insights}`;

        // Find today's entry
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const { data: existingEntry, error: findError } = await supabase
          .from("mood_tracking")
          .select("id")
          .eq("child_id", childId)
          .gte("recorded_at", today.toISOString())
          .lt("recorded_at", tomorrow.toISOString())
          .single();

        if (findError || !existingEntry) {
          return {
            success: false,
            error: "No mood entry found for today. Use POST to create a new entry.",
            status: 404
          };
        }

        // Update mood entry
        const { data: moodEntry, error } = await supabase
          .from("mood_tracking")
          .update({
            happiness: finalMood.happiness,
            anxiety: finalMood.anxiety,
            sadness: finalMood.sadness,
            stress: finalMood.stress,
            confidence: finalMood.confidence,
            notes: updatedNotes,
            recorded_at: new Date().toISOString(),
          })
          .eq("id", existingEntry.id)
          .select()
          .single();

        if (error) {
          console.error("Error updating mood entry:", error);
          return {
            success: false,
            error: 'Failed to update mood data',
            status: 500
          };
        }

        // Update child's current mood
        await supabase
          .from("children")
          .update({ current_mood: finalMood })
          .eq("id", childId);

        const moodAnalysis = analyzeMoodStatus([moodEntry]);
        const hasAlert = checkForAlert(finalMood, moodDescription || "");
        const alertLevel = hasAlert ? determineAlertLevel(finalMood, moodDescription || "") : null;
        const alertMessage = hasAlert ? generateAlertMessage(finalMood, moodDescription || "", alertLevel as 'high' | 'medium') : null;

        return {
          success: true,
          moodEntry,
          moodAnalysis,
          aiAnalysis: aiMoodAnalysis,
          has_alert: hasAlert,
          alert_level: alertLevel,
          alert_message: alertMessage,
          message: "Mood entry updated successfully with AI analysis",
        };

      } catch (aiError) {
        console.error("Error with AI mood analysis:", aiError);
        // Fall back to manual input
      }
    }

    // Handle manual mood update (similar logic as above for validation and update)
    const validateMoodValue = (value: number, name: string) => {
      if (typeof value !== "number" || value < 1 || value > 10) {
        throw new Error(`${name} must be a number between 1 and 10`);
      }
      return value;
    };

    const validatedMood = {
      happiness: validateMoodValue(finalMood.happiness, "Happiness"),
      anxiety: validateMoodValue(finalMood.anxiety, "Anxiety"),
      sadness: validateMoodValue(finalMood.sadness, "Sadness"),
      stress: validateMoodValue(finalMood.stress, "Stress"),
      confidence: validateMoodValue(finalMood.confidence, "Confidence"),
    };

    // Update mood entry by moodId
    const { data: moodEntry, error } = await supabase
      .from("mood_tracking")
      .update({
        happiness: validatedMood.happiness,
        anxiety: validatedMood.anxiety,
        sadness: validatedMood.sadness,
        stress: validatedMood.stress,
        confidence: validatedMood.confidence,
        notes: notes || "",
        recorded_at: new Date().toISOString(),
      })
      .eq("id", moodId)
      .eq("child_id", childId)
      .select()
      .single();

    if (error) {
      console.error("Error updating mood entry:", error);
      return {
        success: false,
        error: 'Failed to update mood data',
        status: 500
      };
    }

    // Update child's current mood
    await supabase
      .from("children")
      .update({ current_mood: validatedMood })
      .eq("id", childId);

    const moodAnalysis = analyzeMoodStatus([moodEntry]);
    const hasAlert = checkForAlert(validatedMood, notes || "");
    const alertLevel = hasAlert ? determineAlertLevel(validatedMood, notes || "") : null;
    const alertMessage = hasAlert ? generateAlertMessage(validatedMood, notes || "", alertLevel as 'high' | 'medium') : null;

    return {
      success: true,
      moodEntry,
      moodAnalysis,
      has_alert: hasAlert,
      alert_level: alertLevel,
      alert_message: alertMessage,
      message: "Mood entry updated successfully",
    };

  } catch (error) {
    console.error('Error in mood update service:', error);
    if (error instanceof Error) {
      return {
        success: false,
        error: error.message,
        status: 400
      };
    }
    return {
      success: false,
      error: 'Failed to update mood tracking entry',
      status: 500
    };
  }
}

export async function deleteMood(
  familyId: string,
  childId: string,
  moodId: string
): Promise<MoodResult> {
  try {
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

    // Delete mood entry
    const { error } = await supabase
      .from("mood_tracking")
      .delete()
      .eq("id", moodId)
      .eq("child_id", childId);

    if (error) {
      console.error("Error deleting mood entry:", error);
      return {
        success: false,
        error: 'Failed to delete mood entry',
        status: 500
      };
    }

    return {
      success: true,
      message: 'Mood entry deleted successfully'
    };

  } catch (error) {
    console.error('Error in mood deletion service:', error);
    return {
      success: false,
      error: 'Failed to delete mood entry',
      status: 500
    };
  }
}

export async function analyzeMoodQuick(
  familyId: string,
  childId: string,
  moodDescription: string
): Promise<MoodResult> {
  try {
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

    // Get child information
    const { data: child, error: childError } = await supabase
      .from("children")
      .select("id, name, age")
      .eq("id", childId)
      .single();

    if (childError || !child) {
      return {
        success: false,
        error: 'Child not found',
        status: 404
      };
    }

    // Analyze mood using OpenAI
    const aiMoodAnalysis = await analyzeMoodFromInput(moodDescription, child.age);

    // Check for alerts
    const hasAlert = checkForAlert(aiMoodAnalysis, moodDescription);
    const alertLevel = hasAlert ? determineAlertLevel(aiMoodAnalysis, moodDescription) : null;
    const alertMessage = hasAlert ? generateAlertMessage(aiMoodAnalysis, moodDescription, alertLevel as 'high' | 'medium') : null;

    return {
      success: true,
      child: { id: child.id, name: child.name, age: child.age },
      moodAnalysis: aiMoodAnalysis,
      has_alert: hasAlert,
      alert_level: alertLevel,
      alert_message: alertMessage,
      message: "Mood analysis completed successfully",
    };

  } catch (error) {
    console.error('Error in quick mood analysis service:', error);
    if (error instanceof Error) {
      return {
        success: false,
        error: error.message,
        status: 400
      };
    }
    return {
      success: false,
      error: 'Failed to analyze mood',
      status: 500
    };
  }
}

export async function reanalyzeMoodEntries(
  familyId: string,
  childId: string
): Promise<MoodResult> {
  try {
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

    // Get child information
    const { data: child, error: childError } = await supabase
      .from("children")
      .select("id, name, age")
      .eq("id", childId)
      .single();

    if (childError || !child) {
      return {
        success: false,
        error: 'Child not found',
        status: 404
      };
    }

    // Fetch all mood entries
    const { data: moodEntries, error } = await supabase
      .from("mood_tracking")
      .select("*")
      .eq("child_id", childId)
      .order("recorded_at", { ascending: true });

    if (error) {
      console.error("Error fetching mood data:", error);
      return {
        success: false,
        error: 'Failed to fetch mood data',
        status: 500
      };
    }

    let reanalyzedCount = 0;
    const results = [];

    for (const entry of moodEntries) {
      try {
        let analysisInput = entry.notes || "";

        if (!entry.notes || entry.notes.trim().length === 0) {
          const entryDate = new Date(entry.recorded_at);
          const isWeekend = entryDate.getDay() === 0 || entryDate.getDay() === 6;
          const isRecent = Date.now() - entryDate.getTime() < 7 * 24 * 60 * 60 * 1000;

          analysisInput = `Child mood entry from ${entryDate.toLocaleDateString()}${
            isWeekend ? " (weekend)" : " (weekday)"
          }${
            isRecent ? " - recent entry" : " - older entry"
          }. No specific notes provided, analyzing for baseline emotional state and potential patterns.`;
        }

        const aiMoodAnalysis = await analyzeMoodFromInput(analysisInput, child.age);

        // Add some randomization for empty notes
        if (!entry.notes || entry.notes.trim().length === 0) {
          const randomVariation = Math.random() * 0.4 - 0.2;
          aiMoodAnalysis.happiness = Math.max(1, Math.min(10, aiMoodAnalysis.happiness + randomVariation));
          aiMoodAnalysis.anxiety = Math.max(1, Math.min(10, aiMoodAnalysis.anxiety + randomVariation));
          aiMoodAnalysis.sadness = Math.max(1, Math.min(10, aiMoodAnalysis.sadness + randomVariation));
          aiMoodAnalysis.stress = Math.max(1, Math.min(10, aiMoodAnalysis.stress + randomVariation));
          aiMoodAnalysis.confidence = Math.max(1, Math.min(10, aiMoodAnalysis.confidence + randomVariation));
        }

        // Update the entry
        const { data: updatedMoodEntry, error: updateError } = await supabase
          .from("mood_tracking")
          .update({
            happiness: Math.round(aiMoodAnalysis.happiness),
            anxiety: Math.round(aiMoodAnalysis.anxiety),
            sadness: Math.round(aiMoodAnalysis.sadness),
            stress: Math.round(aiMoodAnalysis.stress),
            confidence: Math.round(aiMoodAnalysis.confidence),
            notes: !entry.notes || entry.notes.trim().length === 0
              ? `[AI Re-analyzed: ${aiMoodAnalysis.insights}]`
              : `${entry.notes}\n\n[AI Re-analyzed: ${aiMoodAnalysis.insights}]`,
          })
          .eq("id", entry.id)
          .select()
          .single();

        if (!updateError && updatedMoodEntry) {
          reanalyzedCount++;
          results.push({
            id: entry.id,
            date: entry.recorded_at,
            oldScores: {
              happiness: entry.happiness,
              anxiety: entry.anxiety,
              sadness: entry.sadness,
              stress: entry.stress,
              confidence: entry.confidence,
            },
            newScores: {
              happiness: updatedMoodEntry.happiness,
              anxiety: updatedMoodEntry.anxiety,
              sadness: updatedMoodEntry.sadness,
              stress: updatedMoodEntry.stress,
              confidence: updatedMoodEntry.confidence,
            },
            success: true,
          });
        } else {
          results.push({
            id: entry.id,
            date: entry.recorded_at,
            error: updateError,
            success: false,
          });
        }
      } catch (aiError) {
        console.error(`Error force re-analyzing mood entry ${entry.id}:`, aiError);
        results.push({
          id: entry.id,
          date: entry.recorded_at,
          error: aiError instanceof Error ? aiError.message : "Unknown error",
          success: false,
        });
      }
    }

    return {
      success: true,
      message: `Force re-analyzed ${reanalyzedCount} out of ${moodEntries.length} mood entries`,
      results,
      totalEntries: moodEntries.length,
      reanalyzedCount,
    };

  } catch (error) {
    console.error('Error in reanalyze mood entries service:', error);
    return {
      success: false,
      error: 'Failed to force re-analyze mood entries',
      status: 500
    };
  }
} 