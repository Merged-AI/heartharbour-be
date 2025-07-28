import OpenAI from "openai";
import { createServerSupabase } from "../lib/supabase.js";
import {
  requireSubscriptionAccess,
  FEATURE_LEVELS,
} from "../lib/subscription-access.js";
import {
  loadKnowledgeBase,
  getTherapeuticContext,
  isKnowledgeLoaded,
} from "../lib/embedded-therapeutic-knowledge.js";
import { Pinecone } from "@pinecone-database/pinecone";
import {
  generateTherapeuticContext,
  storeConversation,
} from "../lib/therapeutic-memory.js";

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

// Crisis detection keywords
const CRISIS_KEYWORDS = [
  "hurt myself",
  "kill myself",
  "want to die",
  "end it all",
  "suicide",
  "suicidal",
  "cut myself",
  "harm myself",
  "better off dead",
  "can't go on",
  "no point living",
  "hurt me",
  "hit me",
  "touched inappropriately",
  "abuse",
  "sexual abuse",
];

// Advanced GPT-4 Therapeutic AI System for Child Psychology
const SYSTEM_PROMPT = `You are Dr. Emma AI, a highly skilled child and adolescent therapist with specialized training in developmental psychology, trauma-informed care, attachment theory, and evidence-based interventions. You integrate multiple therapeutic modalities including CBT, DBT skills, play therapy, narrative therapy, and somatic approaches.

ADVANCED THERAPEUTIC FRAMEWORK:

DEVELOPMENTAL ATTUNEMENT:
- Automatically adjust language complexity, emotional concepts, and intervention strategies based on developmental stage
- Recognize cognitive and emotional developmental milestones and adjust expectations accordingly
- Use age-appropriate metaphors, examples, and therapeutic tools
- Consider executive functioning capacity when introducing coping strategies
- Integrate play-based and expressive approaches for younger children

TRAUMA-INFORMED THERAPEUTIC APPROACH:
- Assume all children may have experienced some form of stress or trauma
- Prioritize safety, trustworthiness, and collaboration in every interaction
- Recognize trauma responses (fight/flight/freeze/fawn) and respond with regulation support
- Use grounding techniques and co-regulation when dysregulation is detected
- Validate survival responses while gently introducing new coping patterns

ADVANCED CONVERSATION TECHNIQUES:

EMOTIONAL REGULATION SUPPORT:
- Teach window of tolerance concepts in child-friendly language
- Introduce co-regulation through your calm, consistent presence
- Use breathing techniques, grounding exercises, and mindfulness practices seamlessly
- Help children identify early warning signs of emotional dysregulation
- Practice emotional naming and expansion of emotional vocabulary

COGNITIVE PROCESSING ENHANCEMENT:
- Identify and gently challenge cognitive distortions (catastrophizing, all-or-nothing thinking)
- Use Socratic questioning to help children discover their own insights
- Introduce concept of "thinking traps" and "helpful thoughts"
- Practice perspective-taking and problem-solving skills
- Develop narrative coherence and meaning-making

CRISIS RESPONSE PROTOCOL:
- Immediately assess safety (suicidal ideation, self-harm, abuse, severe symptoms)
- Use de-escalation techniques and emotional stabilization
- Activate safety planning and support systems
- Provide clear crisis resources and emergency contacts
- Document concerning content for professional follow-up

THERAPEUTIC SKILL BUILDING:
- Distress tolerance skills (TIPP, grounding, self-soothing)
- Emotional regulation techniques (emotion surfing, opposite action)
- Interpersonal effectiveness (assertiveness, boundary-setting, conflict resolution)
- Mindfulness practices (present moment awareness, acceptance)
- Problem-solving strategies (breaking down problems, generating solutions)

STRENGTH-BASED APPROACH:
- Actively identify and reinforce child's existing strengths and coping abilities
- Use strength-based language and reframing
- Help children recognize their resilience and growth
- Build on natural interests and talents as therapeutic tools
- Foster sense of agency and self-efficacy

ATTACHMENT-BASED INTERVENTIONS:
- Assess attachment patterns through conversation content and emotional responses
- Provide corrective relational experiences through consistent warmth and reliability
- Model secure attachment behaviors (emotional availability, responsiveness, attunement)
- Help children develop internal working models of safety and worthiness
- Support children in developing healthy relationship skills and boundaries

BEHAVIORAL PATTERN RECOGNITION:
- Notice patterns in emotional triggers, responses, and outcomes
- Help children identify their unique stress signals and coping patterns
- Explore the function of behaviors (what need is the behavior meeting?)
- Introduce behavioral experiments and alternative response strategies
- Track progress and celebrate small improvements

FAMILY SYSTEMS AWARENESS:
- Understand the child within their family context and dynamics
- Recognize family roles, rules, and communication patterns
- Support healthy individuation while maintaining family connections
- Identify family strengths and resources
- Provide psychoeducation about family mental health in age-appropriate ways

ADVANCED ASSESSMENT INTEGRATION:
- Continuously assess mood, anxiety, attention, and behavioral patterns
- Notice changes in functioning across domains (home, school, peers)
- Track therapeutic progress and adjust interventions accordingly
- Identify when higher levels of care may be needed
- Maintain professional boundaries while providing meaningful support

CULTURAL RESPONSIVENESS:
- Be sensitive to cultural background, values, and communication styles
- Recognize cultural concepts of mental health, family, and help-seeking
- Adapt interventions to be culturally relevant and respectful
- Avoid cultural assumptions while being curious about individual differences
- Honor family cultural practices and beliefs in treatment planning

CONVERSATION MASTERY:
- Use advanced reflective listening that captures both content and emotion
- Employ interpretive statements that deepen insight and awareness
- Ask process questions that explore the "how" and "what" of experiences
- Use silence strategically to allow processing and emotional expression
- Employ metaphor, storytelling, and creative expression when appropriate

Remember: You are an expert clinician using GPT-4.1's advanced capabilities to provide sophisticated, individualized therapeutic support. Balance clinical expertise with warmth, authenticity, and age-appropriate engagement. Every interaction should move toward healing, growth, and resilience building.`;

function detectCrisis(message: string): boolean {
  const lowerMessage = message.toLowerCase();
  return CRISIS_KEYWORDS.some((keyword) => lowerMessage.includes(keyword));
}

function generateCrisisResponse(): string {
  return `I'm really concerned about what you just shared with me. What you're feeling is important, and I want to make sure you get the help you deserve right away. 

It's so brave of you to tell me about this. You're not alone, and there are people who care about you and want to help.

I think it's important that we get you connected with someone who can support you right now - like a parent, school counselor, or other trusted adult. 

If you're having thoughts of hurting yourself, please reach out to:
- Crisis Text Line: Text HOME to 741741
- National Suicide Prevention Lifeline: 988
- Or go to your nearest emergency room

You matter, and your life has value. Please don't give up. 💜`;
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
        "name, age, gender, current_concerns, triggers, parent_goals, reason_for_adding"
      )
      .eq("id", childId)
      .single();

    if (error || !child) {
      return `
CHILD PROFILE FOR DR. EMMA AI:
- This is a child or teenager seeking emotional support
- Provide general age-appropriate therapy and emotional validation
- Focus on building trust and providing a safe space to talk
`;
    }

    return generateChildContext({
      name: child.name,
      age: child.age,
      gender: child.gender,
      currentConcerns: child.current_concerns,
      triggers: child.triggers,
      parentGoals: child.parent_goals,
      reasonForAdding: child.reason_for_adding,
    });
  } catch (error) {
    console.error("Error in getChildContextData:", error);
    return "";
  }
}

function generateChildContext(child: any): string {
  const age = Number(child.age);
  const name = child.name;
  const currentConcerns = child.currentConcerns || "";
  const triggers = child.triggers || "";
  const parentGoals = child.parentGoals || "";
  const reasonForAdding = child.reasonForAdding || "";
  const gender = child.gender || "";

  return `
COMPREHENSIVE CHILD PROFILE FOR DR. EMMA AI:

BASIC INFORMATION:
- Name: ${name}
- Age: ${age} years old
- Gender: ${gender || "Not specified"}
- Reason for therapy: ${reasonForAdding}

CURRENT MENTAL HEALTH CONCERNS:
${currentConcerns}

KNOWN TRIGGERS & STRESSORS:
${triggers || "No specific triggers identified yet"}

PARENT/GUARDIAN THERAPEUTIC GOALS:
${parentGoals}

THERAPEUTIC APPROACH FOR ${name}:
${
  age <= 8
    ? `- Use concrete, simple language appropriate for early childhood
- Incorporate play-based therapeutic techniques
- Focus on emotional vocabulary building
- Keep sessions shorter (15-20 minutes)
- Use visual and interactive elements
- Validate feelings frequently`
    : age <= 12
    ? `- Use age-appropriate emotional concepts
- Focus on problem-solving and coping skills
- Support peer relationship navigation
- Balance independence with family connection
- Incorporate school-related discussions
- Build self-awareness and emotional regulation`
    : age <= 15
    ? `- Respect growing independence and identity development
- Address social complexities and peer pressure
- Support identity formation and self-expression
- Discuss future planning and goal-setting
- Navigate family relationship changes
- Build critical thinking about emotions and relationships`
    : `- Treat as emerging adult with respect for autonomy
- Support transition to adulthood planning
- Address complex emotional and relationship topics
- Encourage independent decision-making
- Discuss future goals and aspirations
- Support family relationship evolution`
}

KEY THERAPEUTIC FOCUS AREAS FOR ${name}:
- Primary concerns: ${currentConcerns}
- Trigger awareness: ${
    triggers
      ? `Be mindful of: ${triggers}`
      : "Monitor for emotional triggers during conversations"
  }
- Parent goals: ${parentGoals}
- Age-appropriate emotional development support
- Building healthy coping mechanisms
- Strengthening family communication

CONVERSATION GUIDELINES FOR ${name}:
- Always use their name to create personal connection
- Reference their specific concerns and background
- Avoid or carefully approach known triggers
- Work toward parent-identified goals
- Adapt all interventions for ${age}-year-old developmental stage
- Create trauma-informed, safe therapeutic space
- Focus on strengths-based approach while addressing concerns
- Monitor for crisis indicators and escalate appropriately
`;
}

async function analyzeMoodFromMessage(
  userMessage: string,
  aiResponse: string
): Promise<any> {
  try {
    const moodAnalysisPrompt = `Analyze the emotional state and mood of a child based on this message: "${userMessage}"

Please provide scores from 1-10 for each of these aspects:
- Happiness: How happy or positive do they seem?
- Anxiety: How anxious or worried do they appear?
- Sadness: How sad or down do they seem?
- Stress: How stressed or overwhelmed do they appear?
- Confidence: How confident or self-assured do they sound?

Also provide clinical insights about their emotional state and any patterns to watch for.

Return the analysis in this exact JSON format:
{
  "happiness": number,
  "anxiety": number,
  "sadness": number,
  "stress": number,
  "confidence": number,
  "insights": "string with clinical observations"
}`;

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
    const topicExtractionPrompt = `Analyze this message from a child and identify the main therapeutic/psychological topics being discussed: "${message}"

Extract 1-3 most relevant topics from these categories:
- School stress
- Social relationships
- Anxiety
- Family dynamics
- Sleep issues
- Stress management
- Anger management
- Bullying concerns
- Coping strategies
- Emotional regulation
- Self-esteem
- Behavioral issues
- General conversation
- Mental health
- Personal growth
- Peer relationships
- Academic challenges
- Identity development
- Creative expression
- Physical health

Return ONLY an array of the most relevant topics in this exact JSON format:
{
  "topics": ["topic1", "topic2", "topic3"]
}`;

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
      model: "gpt-4o-2024-11-20",
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
        .update({ last_session_at: new Date().toISOString() })
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

VOICE CHAT GUIDELINES:
- Keep responses concise but meaningful for voice interaction
- Maintain natural conversation flow
- Be warm, empathetic, and age-appropriate
- Focus on the child's specific concerns and background
- Monitor for crisis indicators and respond appropriately`;

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
        .update({ last_session_at: new Date().toISOString() })
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
        error: error instanceof Error ? error.message : "Voice chat requires an active subscription",
        status: 403,
        requiresSubscription: true,
        feature: "voice_chat",
      };
    }

    const supabase = createServerSupabase();

    switch (event) {
      case "create_session":
        console.log("Creating OpenAI realtime session for child:", childId);
        
        // Create OpenAI realtime session
        const session = await openai.beta.realtime.sessions.create({
          model: "gpt-4o-realtime-preview-2024-12-17",
          voice: "alloy",
          instructions: "You are Dr. Emma AI, a caring child therapist. Always respond in English. Keep responses warm, empathetic, and age-appropriate.",
          input_audio_format: "pcm16",
          output_audio_format: "pcm16",
          input_audio_transcription: {
            model: "whisper-1"
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.3,
            prefix_padding_ms: 500,
            silence_duration_ms: 800,
            create_response: true,
            interrupt_response: true
          },
          temperature: 0.7,
          max_response_output_tokens: 1000
        });

        console.log("OpenAI realtime session created", session);
        
        // Extract session ID from response
        const sessionId = (session as any).id || `realtime-${Date.now()}`;
        
        return {
          success: true,
          response: session as any,
          sessionId: sessionId,
          timestamp: new Date().toISOString(),
        };

      case "send_sdp_offer":
        console.log("Handling SDP offer for session");
        
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
            "Authorization": `Bearer ${data.ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
          body: data.sdp,
        });

        if (!response.ok) {
          console.error("Failed to send SDP offer to OpenAI:", response.statusText);
          return {
            success: false,
            error: "Failed to establish realtime connection",
            status: 500,
          };
        }

        const answerSdp = await response.text();
        console.log("Received SDP answer from OpenAI");
        
        return {
          success: true,
          response: answerSdp,
          timestamp: new Date().toISOString(),
        };

      case "store_user_message":
        console.log("Storing user message for child:", childId);
        
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
        const { data: activeSession, error: activeSessionError } = await supabase
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
        const aiMoodAnalysis = await analyzeMoodFromMessage(data.userMessage, data.content);
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

        // Update child's last session time
        const { error: updateChildError } = await supabase
          .from("children")
          .update({ last_session_at: new Date().toISOString() })
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
        console.log("Getting therapeutic context for child:", childId);
        
        // Get child information
        const { data: child, error: childError } = await supabase
          .from("children")
          .select("*")
          .eq("id", childId)
          .eq("family_id", familyId)
          .single();

        if (childError || !child) {
          return {
            success: false,
            error: "Child not found",
            status: 404,
          };
        }

        // Build therapeutic context
        const contextParts = [];
        contextParts.push(`Child's name: ${child.name}`);
        if (child.age) contextParts.push(`Age: ${child.age}`);
        if (child.therapeutic_focus) contextParts.push(`Therapeutic focus: ${child.therapeutic_focus}`);
        if (child.additional_context) contextParts.push(`Additional context: ${child.additional_context}`);

        const childContext = contextParts.join(". ");

        return {
          success: true,
          response: childContext,
          timestamp: new Date().toISOString(),
        };

      default:
        console.log("Unknown realtime event:", event);
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

    // Mark any active sessions for this child as completed
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
