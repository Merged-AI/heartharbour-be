import OpenAI from "openai";
import { createServerSupabase } from "../lib/supabase.js";
import {
  requireSubscriptionAccess,
  FEATURE_LEVELS,
} from "../lib/subscription-access.js";
import {
  loadKnowledgeBase,
  getTherapeuticContext,
} from "../lib/embedded-therapeutic-knowledge.js";
import { Pinecone } from "@pinecone-database/pinecone";
import {
  generateTherapeuticContext,
  storeConversation,
} from "../lib/therapeutic-memory.js";
import {
  CRISIS_KEYWORDS,
  SYSTEM_PROMPT,
  CRISIS_RESPONSE,
  MOOD_ANALYSIS_PROMPT,
  TOPIC_EXTRACTION_PROMPT,
  VOICE_CHAT_GUIDELINES,
  REALTIME_VOICE_GUIDELINES,
  CHILD_CONTEXT_TEMPLATE,
  DEFAULT_CHILD_CONTEXT,
  THERAPEUTIC_MODE_FALLBACK,
} from "../lib/prompts.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize Pinecone for child-specific knowledge base
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});

const INDEX_NAME = process.env.PINECONE_INDEX_NAME || "dremma";

interface ChatResult {
  success: boolean;
  error?: string;
  status?: number;
  response?: string;
  moodAnalysis?: any;
  crisis?: boolean;
  requiresSubscription?: boolean;
  feature?: string;
  requiresProfileCompletion?: boolean;
  childId?: string;
  childContext?: string;
  transcribedText?: string;
  aiResponse?: string;
  audioResponse?: string | null;
  useClientTTS?: boolean;
  sessionId?: string;
  timestamp?: string;
  isEmpty?: boolean;
  details?: any;
  sessions?: any[];
  pagination?: any;
  child?: any;
  message?: string;
  session?: any;
}

function detectCrisis(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  return CRISIS_KEYWORDS.some((keyword) => lowerMessage.includes(keyword));
}

function generateCrisisResponse(): string {
  return CRISIS_RESPONSE;
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
      .eq("is_active", true)
      .single();

    return !error && child !== null;
  } catch (error) {
    return false;
  }
}

// Create embedding for text content using OpenAI
async function createEmbedding(text: string): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: text.substring(0, 8000), // Limit input length
      dimensions: 2048, // Explicitly set to match Pinecone index
    });

    return response.data[0].embedding;
  } catch (error) {
    console.error("Error creating embedding:", error);
    throw new Error("Failed to create embedding");
  }
}

// Get child-specific knowledge base documents from Pinecone
async function getChildKnowledgeBaseContext(
  childId: string,
  currentMessage: string
): Promise<string> {
  try {
    const index = pinecone.index(INDEX_NAME);

    // Create embedding for the current message to find relevant knowledge base documents
    const queryEmbedding = await createEmbedding(currentMessage);

    // Search for knowledge base documents specific to this child
    const results = await index.query({
      vector: queryEmbedding,
      topK: 3, // Get top 3 most relevant documents
      filter: {
        child_id: { $eq: childId },
        type: { $eq: "knowledge_base_document" },
      },
      includeMetadata: true,
    });

    if (!results.matches || results.matches.length === 0) {
      console.log("📚 No child-specific knowledge base documents found");
      return "";
    }

    let knowledgeContext = "CHILD-SPECIFIC KNOWLEDGE BASE CONTEXT:\n\n";

    results.matches.forEach((match, index) => {
      const metadata = match.metadata;
      const filename = metadata?.filename || "Unknown document";
      const contentPreview = metadata?.content_preview || "";
      const similarity = match.score || 0;

      knowledgeContext += `${index + 1}. Document: ${filename} (Relevance: ${(
        similarity * 100
      ).toFixed(1)}%)\n`;
      knowledgeContext += `   Content: ${contentPreview}\n\n`;
    });

    console.log(
      `📚 Found ${results.matches.length} relevant knowledge base documents for child ${childId}`
    );
    return knowledgeContext;
  } catch (error) {
    console.error("Error querying child knowledge base:", error);
    return "";
  }
}

// Get child data for enhanced therapeutic knowledge context
async function getChildDataForKnowledge(
  childId: string
): Promise<{ age?: number; concerns?: string[] } | null> {
  try {
    const supabase = createServerSupabase();
    const { data: child, error } = await supabase
      .from("children")
      .select("age, current_concerns")
      .eq("id", childId)
      .single();

    if (error || !child) {
      console.error("Error fetching child data for knowledge base:", error);
      return null;
    }

    // Parse concerns from string to array
    const concerns = child.current_concerns
      ? child.current_concerns
          .split(",")
          .map((c: string) => c.trim())
          .filter(Boolean)
      : [];

    return {
      age: child.age,
      concerns: concerns,
    };
  } catch (error) {
    console.error("Error in getChildDataForKnowledge:", error);
    return null;
  }
}

async function verifyChildProfileComplete(childId: string): Promise<boolean> {
  try {
    const supabase = createServerSupabase();
    const { data: child, error } = await supabase
      .from("children")
      .select(
        "name, current_concerns, parent_goals, reason_for_adding, profile_completed"
      )
      .eq("id", childId)
      .single();

    if (error || !child) {
      return false;
    }

    const hasRequiredFields = !!(
      child.name?.trim() &&
      child.current_concerns?.trim() &&
      child.parent_goals?.trim() &&
      child.reason_for_adding?.trim()
    );

    const isMarkedComplete = child.profile_completed === true;

    return hasRequiredFields && isMarkedComplete;
  } catch (error) {
    return false;
  }
}

async function getChildContextData(childId: string): Promise<string> {
  try {
    const supabase = createServerSupabase();
    const { data: child, error } = await supabase
      .from("children")
      .select(
        "name, age, gender, current_concerns, triggers, parent_goals, reason_for_adding, background, family_dynamics, social_situation, school_info, coping_strategies, previous_therapy, interests, emergency_contacts"
      )
      .eq("id", childId)
      .single();

    if (error || !child) {
      console.log("🔍 DEBUG - No child data found or error:", error);
      return DEFAULT_CHILD_CONTEXT;
    }

    return generateChildContext({
      name: child.name,
      age: child.age,
      gender: child.gender,
      currentConcerns: child.current_concerns,
      triggers: child.triggers,
      parentGoals: child.parent_goals,
      reasonForAdding: child.reason_for_adding,
      background: child.background,
      familyDynamics: child.family_dynamics,
      socialSituation: child.social_situation,
      schoolInfo: child.school_info,
      copingStrategies: child.coping_strategies,
      previousTherapy: child.previous_therapy,
      interests: child.interests,
      emergencyContacts: child.emergency_contacts,
    });
  } catch (error) {
    console.error("Error in getChildContextData:", error);
    return "";
  }
}

function generateChildContext(child: any): string {
  return CHILD_CONTEXT_TEMPLATE(child);
}

async function analyzeMoodFromMessage(
  userMessage: string,
  aiResponse: string
): Promise<any> {
  try {
    const moodAnalysisPrompt = MOOD_ANALYSIS_PROMPT(userMessage);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an expert child psychologist analyzing emotional states.",
        },
        { role: "user", content: moodAnalysisPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const moodAnalysis = JSON.parse(
      completion.choices[0]?.message?.content || "{}"
    );

    const defaultScore = 5;
    return {
      happiness: Number(moodAnalysis.happiness) || defaultScore,
      anxiety: Number(moodAnalysis.anxiety) || defaultScore,
      sadness: Number(moodAnalysis.sadness) || defaultScore,
      stress: Number(moodAnalysis.stress) || defaultScore,
      confidence: Number(moodAnalysis.confidence) || defaultScore,
      insights:
        moodAnalysis.insights ||
        "Child engaging in therapeutic conversation with normal emotional range",
    };
  } catch (error) {
    console.error("Error in mood analysis:", error);
    return {
      happiness: 5,
      anxiety: 5,
      sadness: 5,
      stress: 5,
      confidence: 5,
      insights:
        "Child engaging in therapeutic conversation with normal emotional range",
    };
  }
}

async function extractTopicsFromMessage(message: string): Promise<string[]> {
  if (!message) return ["General conversation"];

  try {
    const topicExtractionPrompt = TOPIC_EXTRACTION_PROMPT(message);

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You are an expert child psychologist identifying therapeutic discussion topics.",
        },
        { role: "user", content: topicExtractionPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const result = JSON.parse(completion.choices[0]?.message?.content || "{}");
    const topics = result.topics || [];

    return topics.length > 0 ? topics : ["General conversation"];
  } catch (error) {
    console.error("Error in topic extraction:", error);
    return ["General conversation"];
  }
}

async function transcribeAudio(audioData: string): Promise<string> {
  try {
    const audioBuffer = Buffer.from(audioData, "base64");

    if (audioBuffer.length < 2048) {
      return "";
    }

    const fs = require("fs");
    const path = require("path");
    const os = require("os");

    const tempDir = os.tmpdir();
    const tempFile = path.join(tempDir, `audio_${Date.now()}.webm`);

    fs.writeFileSync(tempFile, audioBuffer);

    const fileStream = fs.createReadStream(tempFile);

    const transcription = await openai.audio.transcriptions.create({
      file: fileStream,
      model: "whisper-1",
      language: "en",
      response_format: "text",
      temperature: 0.0,
    });

    fs.unlinkSync(tempFile);

    const cleanedTranscription =
      typeof transcription === "string" ? transcription.trim() : "";

    if (cleanedTranscription.length < 3) {
      return "";
    }

    return cleanedTranscription;
  } catch (error) {
    console.error("Error transcribing audio:", error);
    return "";
  }
}

async function textToSpeech(text: string): Promise<string | null> {
  try {
    const speech = await openai.audio.speech.create({
      model: "tts-1",
      voice: "alloy",
      input: text,
    });

    const arrayBuffer = await speech.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString("base64");

    return base64Audio;
  } catch (error) {
    console.error("Error converting text to speech:", error);
    return null;
  }
}

export async function processMessage(
  familyId: string,
  childId: string,
  message: string,
  history: any[] = []
): Promise<ChatResult> {
  try {
    // Check subscription access for chat sessions
    try {
      await requireSubscriptionAccess(familyId, FEATURE_LEVELS.CHAT_SESSIONS);
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        status: 403,
        requiresSubscription: true,
        feature: "chat_sessions",
      };
    }

    // Crisis detection
    if (detectCrisis(message)) {
      const crisisResponse = generateCrisisResponse();

      // Store crisis session
      try {
        const supabase = createServerSupabase();
        const crisisMessages = [
          {
            sender: "child",
            content: message,
            timestamp: new Date().toISOString(),
          },
          {
            sender: "ai",
            content: crisisResponse,
            timestamp: new Date().toISOString(),
          },
        ];

        const moodAnalysis = await analyzeMoodFromMessage(
          message,
          crisisResponse
        );
        const topics = await extractTopicsFromMessage(message);

        const { error: sessionError } = await supabase
          .from("therapy_sessions")
          .insert({
            child_id: childId,
            messages: crisisMessages,
            session_duration: Math.floor(Math.random() * 30) + 15,
            mood_analysis: moodAnalysis,
            topics: topics,
            status: "active",
            crisis_detected: true,
            created_at: new Date().toISOString(),
          });

        if (sessionError) {
          console.error("Error saving crisis session:", sessionError);
        }

        await supabase
          .from("children")
          .update({ last_session_at: new Date().toISOString() })
          .eq("id", childId);
      } catch (error) {
        console.error("Error logging crisis session:", error);
      }

      return {
        success: true,
        response: crisisResponse,
        crisis: true,
      };
    }

    // Validate child access
    const hasAccess = await validateChildAccess(familyId, childId);
    if (!hasAccess) {
      return {
        success: false,
        error: "Child not found or access denied",
        status: 403,
      };
    }

    // Verify child profile is complete
    const isProfileComplete = await verifyChildProfileComplete(childId);
    if (!isProfileComplete) {
      return {
        success: false,
        error:
          "Child profile incomplete. Please complete the therapeutic questionnaire before starting therapy sessions.",
        status: 422,
        requiresProfileCompletion: true,
        childId: childId,
      };
    }

    const childContext = await getChildContextData(childId);

    // Get child data for enhanced therapeutic knowledge context
    const childData = await getChildDataForKnowledge(childId);

    // Get child-specific knowledge base documents
    let childKnowledgeContext = "";
    try {
      childKnowledgeContext = await getChildKnowledgeBaseContext(
        childId,
        message
      );
    } catch (error) {
      console.error("Error accessing child knowledge base:", error);
      childKnowledgeContext = "";
    }

    // Get therapeutic memory context
    let therapeuticContext = "";
    try {
      therapeuticContext = await generateTherapeuticContext(childId, message);
    } catch (error) {
      console.error("Error accessing therapeutic memory:", error);
      therapeuticContext = THERAPEUTIC_MODE_FALLBACK;
    }

    // Get embedded therapeutic guidance
    let knowledgeGuidance = "";
    try {
      await loadKnowledgeBase();
      knowledgeGuidance = getTherapeuticContext(
        childData?.age,
        childData?.concerns,
        message
      );
    } catch (error) {
      console.error("Error accessing embedded therapeutic knowledge:", error);
    }

    // Create personalized system prompt with all knowledge sources
    const personalizedSystemPrompt = `${SYSTEM_PROMPT}

CHILD-SPECIFIC CONTEXT:
${childContext}

${therapeuticContext}

${childKnowledgeContext}

${knowledgeGuidance}`;

    // Build conversation context
    const conversationHistory =
      history?.slice(-8).map((msg: any) => ({
        role: msg.sender === "child" ? "user" : "assistant",
        content: msg.content,
      })) || [];

    const messages = [
      { role: "system", content: personalizedSystemPrompt },
      ...conversationHistory,
      { role: "user", content: message },
    ];

    // Get AI response using advanced GPT-4 model
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages as any,
      max_tokens: 500,
      temperature: 0.7,
      presence_penalty: 0.6,
      frequency_penalty: 0.3,
    });

    const aiResponse = completion.choices[0]?.message?.content;

    if (!aiResponse) {
      throw new Error("No response from OpenAI");
    }

    const moodAnalysis = await analyzeMoodFromMessage(message, aiResponse);

    // Save therapy session
    try {
      const supabase = createServerSupabase();

      const { data: activeSession, error: activeSessionError } = await supabase
        .from("therapy_sessions")
        .select("*")
        .eq("child_id", childId)
        .eq("status", "active")
        .maybeSingle();

      if (activeSessionError) {
        console.error("Error checking active session:", activeSessionError);
      }

      if (activeSession) {
        // Update existing session
        const currentMessages = activeSession.messages || [];
        const updatedMessages = [
          ...currentMessages,
          {
            sender: "child",
            content: message,
            timestamp: new Date().toISOString(),
          },
          {
            sender: "ai",
            content: aiResponse,
            timestamp: new Date().toISOString(),
          },
        ];

        const topics = await extractTopicsFromMessage(message);

        await supabase
          .from("therapy_sessions")
          .update({
            messages: updatedMessages,
            mood_analysis: moodAnalysis,
            topics: topics,
            status: "active",
          })
          .eq("id", activeSession.id);

        // Store conversation in therapeutic memory for future context
        try {
          await storeConversation({
            id: activeSession.id,
            child_id: childId,
            messages: updatedMessages,
            mood_analysis: moodAnalysis,
            topics: topics,
            session_date: new Date().toISOString(),
            therapeutic_insights: `Session update: Child expressed ${
              message.length > 50 ? "detailed concerns" : "brief thoughts"
            } about ${topics.join(", ")}. Mood analysis shows anxiety: ${
              moodAnalysis.anxiety
            }/10, happiness: ${moodAnalysis.happiness}/10.`,
          });
        } catch (error) {
          console.error("Error storing therapeutic memory:", error);
        }
      } else {
        // Create new session
        const initialMessages = [
          {
            sender: "child" as "child",
            content: message,
            timestamp: new Date().toISOString(),
          },
          {
            sender: "ai" as "ai",
            content: aiResponse,
            timestamp: new Date().toISOString(),
          },
        ];

        const topics = await extractTopicsFromMessage(message);

        const { data: newSession } = await supabase
          .from("therapy_sessions")
          .insert({
            child_id: childId,
            messages: initialMessages,
            session_duration: Math.floor(Math.random() * 30) + 15,
            mood_analysis: moodAnalysis,
            topics: topics,
            status: "active",
            created_at: new Date().toISOString(),
          })
          .select()
          .single();

        // Store new conversation in therapeutic memory
        if (newSession) {
          try {
            await storeConversation({
              id: newSession.id,
              child_id: childId,
              messages: initialMessages,
              mood_analysis: moodAnalysis,
              topics: topics,
              session_date: new Date().toISOString(),
              therapeutic_insights: `New session started: Child initiated conversation about ${topics.join(
                ", "
              )}. Initial mood assessment shows anxiety: ${
                moodAnalysis.anxiety
              }/10, happiness: ${moodAnalysis.happiness}/10.`,
            });
          } catch (error) {
            console.error(
              "Error storing therapeutic memory for new session:",
              error
            );
          }
        }
      }

      await supabase
        .from("children")
        .update({
          last_session_at: new Date().toISOString(),
          last_session_had_conversation: true, // Mark that this session had conversation
        })
        .eq("id", childId);
    } catch (error) {
      console.error("Error logging session:", error);
    }

    return {
      success: true,
      response: aiResponse,
      moodAnalysis,
    };
  } catch (error) {
    console.error("Error in processMessage:", error);
    return {
      success: false,
      error: "Failed to process chat",
      status: 500,
    };
  }
}

export async function getChildContext(
  familyId: string,
  childId: string
): Promise<ChatResult> {
  try {
    // Validate child access
    const hasAccess = await validateChildAccess(familyId, childId);
    if (!hasAccess) {
      return {
        success: false,
        error: "Child not found or access denied",
        status: 403,
      };
    }

    const childContext = await getChildContextData(childId);

    return {
      success: true,
      childContext,
    };
  } catch (error) {
    console.error("Error in getChildContext:", error);
    return {
      success: false,
      error: "Failed to get child context",
      status: 500,
    };
  }
}

export async function processVoiceMessage(
  familyId: string,
  childId: string,
  audioData: string,
  sessionId?: string,
  messageHistory: any[] = []
): Promise<ChatResult> {
  try {
    // Check subscription access for voice chat
    try {
      await requireSubscriptionAccess(familyId, FEATURE_LEVELS.VOICE_CHAT);
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        status: 403,
        requiresSubscription: true,
        feature: "voice_chat",
      };
    }

    // Validate child access
    const hasAccess = await validateChildAccess(familyId, childId);
    if (!hasAccess) {
      return {
        success: false,
        error: "Child not found or access denied",
        status: 403,
      };
    }

    // Verify child profile is complete
    const isProfileComplete = await verifyChildProfileComplete(childId);
    if (!isProfileComplete) {
      return {
        success: false,
        error:
          "Child profile incomplete. Please complete the therapeutic questionnaire before starting voice therapy sessions.",
        status: 422,
        requiresProfileCompletion: true,
        childId: childId,
      };
    }

    const transcribedText = await transcribeAudio(audioData);

    if (!transcribedText || transcribedText.trim().length === 0) {
      return {
        success: true,
        transcribedText: "",
        aiResponse: "",
        audioResponse: null,
        useClientTTS: false,
        sessionId: sessionId || `voice-${Date.now()}`,
        timestamp: new Date().toISOString(),
        isEmpty: true,
      };
    }

    // Crisis detection
    if (detectCrisis(transcribedText)) {
      const crisisResponse = generateCrisisResponse();
      return {
        success: true,
        transcribedText: transcribedText,
        aiResponse: crisisResponse,
        audioResponse: null,
        useClientTTS: true,
        sessionId: sessionId || `voice-${Date.now()}`,
        timestamp: new Date().toISOString(),
        crisis: true,
      };
    }

    const childContext = await getChildContextData(childId);

    // Get child data for enhanced knowledge context
    const childData = await getChildDataForKnowledge(childId);

    // Get child-specific knowledge base documents
    let childKnowledgeContext = "";
    try {
      childKnowledgeContext = await getChildKnowledgeBaseContext(
        childId,
        transcribedText
      );
    } catch (error) {
      console.error("Error accessing child knowledge base:", error);
      childKnowledgeContext = "";
    }

    // Get therapeutic memory context
    let therapeuticContext = "";
    try {
      therapeuticContext = await generateTherapeuticContext(
        childId,
        transcribedText
      );
    } catch (error) {
      console.error("Error accessing therapeutic memory:", error);
      therapeuticContext = THERAPEUTIC_MODE_FALLBACK;
    }

    // Get embedded therapeutic guidance
    let knowledgeGuidance = "";
    try {
      await loadKnowledgeBase();
      knowledgeGuidance = getTherapeuticContext(
        childData?.age,
        childData?.concerns,
        transcribedText
      );
    } catch (error) {
      console.error("Error accessing embedded therapeutic knowledge:", error);
    }

    const personalizedSystemPrompt = `${SYSTEM_PROMPT}

CHILD-SPECIFIC CONTEXT:
${childContext}

${therapeuticContext}

${childKnowledgeContext}

${knowledgeGuidance}

${VOICE_CHAT_GUIDELINES}`;

    const conversationHistory =
      messageHistory?.slice(-8).map((msg: any) => ({
        role: msg.role as "user" | "assistant",
        content: msg.content,
      })) || [];

    const messages = [
      { role: "system", content: personalizedSystemPrompt },
      ...conversationHistory,
      { role: "user", content: transcribedText },
    ];

    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: messages as any,
      max_tokens: 200,
      temperature: 0.7,
      presence_penalty: 0.6,
      frequency_penalty: 0.3,
    });

    const aiResponseText = aiResponse.choices[0]?.message?.content || "";

    const moodAnalysis = await analyzeMoodFromMessage(
      transcribedText,
      aiResponseText
    );

    // Save voice session
    try {
      const supabase = createServerSupabase();
      await supabase.from("therapy_sessions").insert({
        child_id: childId,
        messages: [
          {
            sender: "child",
            content: transcribedText,
            timestamp: new Date().toISOString(),
          },
          {
            sender: "ai",
            content: aiResponseText,
            timestamp: new Date().toISOString(),
          },
        ],
        session_duration: Math.floor(Math.random() * 30) + 15,
        mood_analysis: moodAnalysis,
        status: "active",
      });

      await supabase
        .from("children")
        .update({
          last_session_at: new Date().toISOString(),
          last_session_had_conversation: true, // Mark that this voice session had conversation
        })
        .eq("id", childId);
    } catch (error) {
      console.error("Error logging voice session:", error);
    }

    const audioResponse = await textToSpeech(aiResponseText);

    return {
      success: true,
      transcribedText,
      aiResponse: aiResponseText,
      audioResponse,
      useClientTTS: !audioResponse,
      sessionId: sessionId || `voice-${Date.now()}`,
      timestamp: new Date().toISOString(),
      isEmpty: false,
    };
  } catch (error) {
    console.error("Error in processVoiceMessage:", error);
    return {
      success: false,
      error: "Failed to process voice chat request",
      status: 500,
    };
  }
}

export async function handleRealtimeEvent(
  familyId: string,
  childId: string,
  event: string,
  data: any
): Promise<ChatResult> {
  try {
    // Validate child access
    const hasAccess = await validateChildAccess(familyId, childId);
    if (!hasAccess) {
      return {
        success: false,
        error: "Child not found or access denied",
        status: 403,
      };
    }

    // Check subscription access for voice chat
    try {
      await requireSubscriptionAccess(familyId, FEATURE_LEVELS.VOICE_CHAT);
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Voice chat requires an active subscription",
        status: 403,
        requiresSubscription: true,
        feature: "voice_chat",
      };
    }

    const supabase = createServerSupabase();

    switch (event) {
      case "create_session":
        // Get comprehensive child context for realtime session (same as text chat)
        const realtimeChildContext = await getChildContextData(childId);

        // Get child data for enhanced therapeutic knowledge context
        const childData = await getChildDataForKnowledge(childId);

        // Get child-specific knowledge base documents
        let childKnowledgeContext = "";
        try {
          childKnowledgeContext = await getChildKnowledgeBaseContext(
            childId,
            "realtime voice session initialization"
          );
        } catch (error) {
          console.error(
            "Error accessing child knowledge base for realtime:",
            error
          );
          childKnowledgeContext = "";
        }

        // Get therapeutic memory context
        let therapeuticContext = "";
        try {
          therapeuticContext = await generateTherapeuticContext(
            childId,
            "realtime voice session initialization"
          );
        } catch (error) {
          console.error(
            "Error accessing therapeutic memory for realtime:",
            error
          );
          therapeuticContext =
            "THERAPEUTIC MODE: Using child-specific background without historical memory context.";
        }

        // Get embedded therapeutic guidance
        let knowledgeGuidance = "";
        try {
          await loadKnowledgeBase();
          knowledgeGuidance = getTherapeuticContext(
            childData?.age,
            childData?.concerns,
            "realtime voice session initialization"
          );
        } catch (error) {
          console.error(
            "Error accessing embedded therapeutic knowledge for realtime:",
            error
          );
        }

        // Create comprehensive instructions using the SAME system prompt as text chat
        const realtimeInstructions = `${SYSTEM_PROMPT}

CHILD-SPECIFIC CONTEXT:
${realtimeChildContext}

${therapeuticContext}

${childKnowledgeContext}

${knowledgeGuidance}

${REALTIME_VOICE_GUIDELINES}`;

        // Create OpenAI realtime session with comprehensive context
        const session = await openai.beta.realtime.sessions.create({
          model: "gpt-4o-realtime-preview-2024-12-17",
          voice: "alloy",
          instructions: realtimeInstructions,
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          input_audio_transcription: {
            model: "whisper-1",
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.3,
            prefix_padding_ms: 500,
            silence_duration_ms: 800,
            create_response: true,
            interrupt_response: true,
          },
          temperature: 0.7,
          max_response_output_tokens: 1000,
        });

        // Extract session ID from response
        const sessionId = (session as any).id || `realtime-${Date.now()}`;

        return {
          success: true,
          response: session as any,
          sessionId: sessionId,
          timestamp: new Date().toISOString(),
        };

      case "send_sdp_offer":
        if (!data.sdp || !data.ephemeralKey) {
          return {
            success: false,
            error: "SDP and ephemeral key are required",
            status: 400,
          };
        }

        // Forward SDP offer to OpenAI realtime API
        const response = await fetch("https://api.openai.com/v1/realtime", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${data.ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
          body: data.sdp,
        });

        if (!response.ok) {
          console.error(
            "Failed to send SDP offer to OpenAI:",
            response.statusText
          );
          return {
            success: false,
            error: "Failed to establish realtime connection",
            status: 500,
          };
        }

        const answerSdp = await response.text();

        return {
          success: true,
          response: answerSdp,
          timestamp: new Date().toISOString(),
        };

      case "store_user_message":
        if (!data.content) {
          return {
            success: false,
            error: "Message content is required",
            status: 400,
          };
        }

        // Analyze mood and extract topics from user message
        const moodAnalysis = await analyzeMoodFromMessage(data.content, "");
        const topics = await extractTopicsFromMessage(data.content);

        // Check for active session first (same as Next.js API)
        const { data: activeSession, error: activeSessionError } =
          await supabase
            .from("therapy_sessions")
            .select("*")
            .eq("child_id", childId)
            .eq("status", "active")
            .maybeSingle();

        if (activeSessionError) {
          console.error("Error checking active session:", activeSessionError);
        }

        let finalSessionId;

        if (activeSession) {
          // Update existing active session (same as Next.js API)
          finalSessionId = activeSession.id;
          const currentMessages = activeSession.messages || [];
          const updatedMessages = [
            ...currentMessages,
            {
              sender: "child",
              content: data.content,
              timestamp: new Date().toISOString(),
            },
          ];

          const { error: updateError } = await supabase
            .from("therapy_sessions")
            .update({
              messages: updatedMessages,
              mood_analysis: moodAnalysis,
              topics: topics,
              status: "active",
            })
            .eq("id", finalSessionId)
            .eq("status", "active");

          if (updateError) {
            console.error("Error updating therapy session:", updateError);
            return {
              success: false,
              error: "Failed to update session",
              status: 500,
            };
          }
        } else {
          // Create new session only if no active session exists
          const { data: sessionData, error: sessionError } = await supabase
            .from("therapy_sessions")
            .insert({
              child_id: childId,
              messages: [
                {
                  sender: "child",
                  content: data.content,
                  timestamp: new Date().toISOString(),
                },
              ],
              session_duration: Math.floor(Math.random() * 30) + 15,
              mood_analysis: moodAnalysis,
              topics: topics,
              status: "active",
            })
            .select()
            .single();

          if (sessionError) {
            console.error("Error creating therapy session:", sessionError);
            return {
              success: false,
              error: "Failed to create therapy session",
              status: 500,
            };
          }

          finalSessionId = sessionData.id;
        }

        return {
          success: true,
          response: "User message stored",
          sessionId: finalSessionId,
          timestamp: new Date().toISOString(),
        };

      case "store_ai_response":
        console.log("Storing AI response for session:", data.sessionId);

        if (!data.sessionId || !data.content || !data.userMessage) {
          return {
            success: false,
            error: "Session ID, content, and user message are required",
            status: 400,
          };
        }

        // Analyze mood with full context (user message + AI response)
        const aiMoodAnalysis = await analyzeMoodFromMessage(
          data.userMessage,
          data.content
        );
        const aiTopics = await extractTopicsFromMessage(data.userMessage);

        // Get the existing session by ID and append AI response
        const { data: existingSession, error: fetchError } = await supabase
          .from("therapy_sessions")
          .select("*")
          .eq("id", data.sessionId)
          .eq("status", "active")
          .single();

        if (fetchError || !existingSession) {
          console.error("Error fetching existing session:", fetchError);
          return {
            success: false,
            error: "Active session not found",
            status: 404,
          };
        }

        // Append AI response to existing messages
        const currentMessages = existingSession.messages || [];
        const updatedMessages = [
          ...currentMessages,
          {
            sender: "ai",
            content: data.content,
            timestamp: new Date().toISOString(),
          },
        ];

        // Update the session with AI response and latest analytics
        const { error: updateError } = await supabase
          .from("therapy_sessions")
          .update({
            messages: updatedMessages,
            mood_analysis: aiMoodAnalysis,
            topics: aiTopics,
            status: "active", // Keep as active until session ends
          })
          .eq("id", data.sessionId)
          .eq("status", "active");

        if (updateError) {
          console.error("Error updating therapy session:", updateError);
          return {
            success: false,
            error: "Failed to update session",
            status: 500,
          };
        }

        // Update child's last session time and mark conversation occurred
        const { error: updateChildError } = await supabase
          .from("children")
          .update({
            last_session_at: new Date().toISOString(),
            last_session_had_conversation: true, // Mark that this realtime voice session had conversation
          })
          .eq("id", childId);

        if (updateChildError) {
          console.error("Error updating last session time:", updateChildError);
        }

        return {
          success: true,
          response: "AI response stored",
          sessionId: data.sessionId,
          timestamp: new Date().toISOString(),
        };

      case "get_child_context":
        // Use the same comprehensive child context as text chat
        const comprehensiveChildContext = await getChildContextData(childId);

        return {
          success: true,
          response: comprehensiveChildContext,
          timestamp: new Date().toISOString(),
        };

      default:
        return {
          success: false,
          error: `Unknown event type: ${event}`,
          status: 400,
        };
    }
  } catch (error) {
    console.error("Error in handleRealtimeEvent:", error);
    return {
      success: false,
      error: "Failed to handle realtime event",
      status: 500,
    };
  }
}

export async function getChatSessions(
  familyId: string,
  childId: string,
  page: number = 1,
  pageSize: number = 5
): Promise<ChatResult> {
  try {
    // Validate child access
    const hasAccess = await validateChildAccess(familyId, childId);
    if (!hasAccess) {
      return {
        success: false,
        error: "Child not found or access denied",
        status: 403,
      };
    }

    const supabase = createServerSupabase();
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data: sessions, error: sessionsError } = await supabase
      .from("therapy_sessions")
      .select("*")
      .eq("child_id", childId)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (sessionsError) {
      throw sessionsError;
    }

    const { count, error: countError } = await supabase
      .from("therapy_sessions")
      .select("*", { count: "exact", head: true })
      .eq("child_id", childId);

    if (countError) {
      throw countError;
    }

    const { data: child, error: childError } = await supabase
      .from("children")
      .select("id, name")
      .eq("id", childId)
      .single();

    if (childError) {
      throw childError;
    }

    return {
      success: true,
      sessions: sessions || [],
      pagination: {
        page,
        pageSize,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / pageSize),
      },
      child,
    };
  } catch (error) {
    console.error("Error in getChatSessions:", error);
    return {
      success: false,
      error: "Failed to fetch chat sessions",
      status: 500,
    };
  }
}

export async function completeSession(
  familyId: string,
  childId: string,
  sessionId: string
): Promise<ChatResult> {
  try {
    // Validate child access
    const hasAccess = await validateChildAccess(familyId, childId);
    if (!hasAccess) {
      return {
        success: false,
        error: "Child not found or access denied",
        status: 403,
      };
    }

    const supabase = createServerSupabase();

    const { data: session, error } = await supabase
      .from("therapy_sessions")
      .update({ status: "completed" })
      .eq("id", sessionId)
      .eq("child_id", childId)
      .select()
      .single();

    if (error) {
      throw error;
    }

    return {
      success: true,
      message: "Session completed successfully",
      session,
    };
  } catch (error) {
    console.error("Error in completeSession:", error);
    return {
      success: false,
      error: "Failed to complete session",
      status: 500,
    };
  }
}

export async function completeSessionsForChild(
  familyId: string,
  childId: string,
  sessionDuration?: number
): Promise<ChatResult> {
  try {
    const supabase = createServerSupabase();

    // First verify that this child belongs to the family
    const { data: child, error: childError } = await supabase
      .from("children")
      .select("id")
      .eq("id", childId)
      .eq("family_id", familyId)
      .single();

    if (childError || !child) {
      return {
        success: false,
        error: "Child not found or access denied",
        status: 403,
      };
    }

    // Check if there are any active sessions to complete
    const { data: activeSessions, error: checkError } = await supabase
      .from("therapy_sessions")
      .select("id")
      .eq("child_id", childId)
      .eq("status", "active");

    if (checkError) {
      console.error("Error checking active sessions:", checkError);
      return {
        success: false,
        error: "Failed to check active sessions",
        status: 500,
      };
    }

    if (activeSessions && activeSessions.length > 0) {
      // Mark existing active sessions as completed
      const { error: updateError } = await supabase
        .from("therapy_sessions")
        .update({
          status: "completed",
          session_duration: sessionDuration,
        })
        .eq("child_id", childId)
        .eq("status", "active");

      if (updateError) {
        console.error("Error completing sessions:", updateError);
        return {
          success: false,
          error: "Failed to complete sessions",
          status: 500,
        };
      }
    } else {
      // No active sessions found - update child's last_session_at to track session end without creating empty records
      await supabase
        .from("children")
        .update({
          last_session_at: new Date().toISOString(),
          last_session_had_conversation: false, // Track if last session had conversation
        })
        .eq("id", childId);
    }

    return {
      success: true,
    };
  } catch (error) {
    console.error("Error in completeSessionsForChild:", error);
    return {
      success: false,
      error: "Failed to complete sessions",
      status: 500,
    };
  }
}
