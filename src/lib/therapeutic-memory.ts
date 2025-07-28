import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";

// Initialize Pinecone and OpenAI
const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const INDEX_NAME = process.env.PINECONE_INDEX_NAME || "dremma";

interface ConversationContext {
  id: string;
  child_id: string;
  messages: {
    sender: "child" | "ai";
    content: string;
    timestamp: string;
  }[];
  mood_analysis: any;
  topics: string[];
  session_date: string;
  therapeutic_insights: string;
}

// Helper function to create embeddings
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
    throw error;
  }
}

// Store a conversation in Pinecone for future reference
export async function storeConversation(
  context: ConversationContext
): Promise<void> {
  try {
    const index = pinecone.index(INDEX_NAME);

    // Create embedding of the conversation for semantic search
    const childMessages = context.messages
      .filter((msg) => msg.sender === "child")
      .map((msg) => msg.content)
      .join("\n");

    const aiMessages = context.messages
      .filter((msg) => msg.sender === "ai")
      .map((msg) => msg.content)
      .join("\n");

    const conversationText = `
      Child Messages: ${childMessages}
      Dr. Emma Responses: ${aiMessages}
      Topics: ${context.topics.join(", ")}
      Therapeutic Insights: ${context.therapeutic_insights}
    `.trim();

    const embedding = await createEmbedding(conversationText);

    // Store in Pinecone with rich metadata for filtering and analysis
    await index.upsert([
      {
        id: `therapy_memory_${context.id}`,
        values: embedding,
        metadata: {
          child_id: context.child_id,
          child_messages: childMessages.substring(0, 500), // Truncate for metadata limits
          ai_messages: aiMessages.substring(0, 500),
          session_date: context.session_date,
          session_timestamp: Math.floor(
            new Date(context.session_date).getTime() / 1000
          ),
          topics: context.topics,
          mood_happiness: context.mood_analysis?.happiness || 5,
          mood_anxiety: context.mood_analysis?.anxiety || 5,
          mood_sadness: context.mood_analysis?.sadness || 5,
          mood_stress: context.mood_analysis?.stress || 5,
          mood_confidence: context.mood_analysis?.confidence || 5,
          therapeutic_insights: context.therapeutic_insights,
          conversation_length: childMessages.length + aiMessages.length,
          type: "therapeutic_memory",
        },
      },
    ]);

    console.log(`💭 Stored therapeutic memory for child ${context.child_id}`);
  } catch (error) {
    console.error("Error storing conversation in Pinecone:", error);
  }
}

// Retrieve relevant past conversations for therapeutic context
export async function getRelevantMemories(
  childId: string,
  currentMessage: string,
  limit: number = 5
): Promise<any[]> {
  try {
    const index = pinecone.index(INDEX_NAME);

    // Create embedding for the current message to find similar past conversations
    const queryEmbedding = await createEmbedding(currentMessage);

    // Search for similar conversations from this child
    const results = await index.query({
      vector: queryEmbedding,
      topK: limit,
      filter: {
        child_id: { $eq: childId },
        type: { $eq: "therapeutic_memory" },
      },
      includeMetadata: true,
    });

    // Return relevant memories with therapeutic context
    return (
      results.matches?.map((match) => ({
        similarity: match.score,
        conversation: {
          messages: [
            {
              sender: "child",
              content: match.metadata?.child_messages || "",
              timestamp: match.metadata?.session_date,
            },
            {
              sender: "ai",
              content: match.metadata?.ai_messages || "",
              timestamp: match.metadata?.session_date,
            },
          ],
          session_date: match.metadata?.session_date,
          topics: match.metadata?.topics,
          mood: {
            happiness: match.metadata?.mood_happiness,
            anxiety: match.metadata?.mood_anxiety,
            sadness: match.metadata?.mood_sadness,
            stress: match.metadata?.mood_stress,
            confidence: match.metadata?.mood_confidence,
          },
          therapeutic_insights: match.metadata?.therapeutic_insights,
        },
      })) || []
    );
  } catch (error) {
    console.error("Error retrieving memories from Pinecone:", error);
    return [];
  }
}

// Helper function to calculate averages
function calculateAverage(conversations: any[], field: string): number {
  const values = conversations
    .map((conv) => conv?.[field])
    .filter((val) => val !== undefined);
  return values.length > 0
    ? values.reduce((sum, val) => sum + val, 0) / values.length
    : 5;
}

// Helper function to get topic frequency
function getTopicFrequency(
  topics: string[]
): Array<{ topic: string; count: number }> {
  const frequency: Record<string, number> = {};
  topics.forEach((topic) => {
    if (topic) frequency[topic] = (frequency[topic] || 0) + 1;
  });

  return Object.entries(frequency)
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

// Helper function to analyze therapeutic progress
function analyzeProgress(conversations: any[]): string {
  // Simple progress analysis - can be enhanced
  const recent = conversations.slice(-5);
  const older = conversations.slice(0, -5);

  if (older.length === 0) return "Establishing baseline";

  const recentAvgAnxiety = calculateAverage(recent, "mood_anxiety");
  const olderAvgAnxiety = calculateAverage(older, "mood_anxiety");

  if (recentAvgAnxiety < olderAvgAnxiety - 1) {
    return "Anxiety levels appear to be improving";
  } else if (recentAvgAnxiety > olderAvgAnxiety + 1) {
    return "Anxiety levels may be increasing - monitor closely";
  } else {
    return "Emotional state appears stable";
  }
}

// Get child's emotional patterns over time
export async function getEmotionalPatterns(
  childId: string,
  days: number = 30
): Promise<any> {
  try {
    const index = pinecone.index(INDEX_NAME);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    // Convert to Unix timestamp (number) for Pinecone filtering
    const cutoffTimestamp = Math.floor(cutoffDate.getTime() / 1000);

    // Query all conversations for this child in the time period
    const results = await index.query({
      vector: new Array(2048).fill(0), // Dummy vector for metadata-only search
      topK: 100,
      filter: {
        child_id: { $eq: childId },
        type: { $eq: "therapeutic_memory" },
        session_timestamp: { $gte: cutoffTimestamp },
      },
      includeMetadata: true,
    });

    if (!results.matches || results.matches.length === 0) {
      return null;
    }

    // Analyze patterns
    const conversations = results.matches.map((match) => match.metadata);

    // Calculate average mood scores
    const avgMood = {
      happiness: calculateAverage(conversations, "mood_happiness"),
      anxiety: calculateAverage(conversations, "mood_anxiety"),
      sadness: calculateAverage(conversations, "mood_sadness"),
      stress: calculateAverage(conversations, "mood_stress"),
      confidence: calculateAverage(conversations, "mood_confidence"),
    };

    // Extract common topics and triggers
    const allTopics = conversations.flatMap((conv) => {
      const topics = conv?.topics || [];
      return Array.isArray(topics)
        ? topics.filter((t) => typeof t === "string")
        : [];
    });
    const topicFrequency = getTopicFrequency(allTopics);

    return {
      totalConversations: conversations.length,
      timeRange: days,
      averageMood: avgMood,
      commonTopics: topicFrequency,
      therapeuticProgress: analyzeProgress(conversations),
    };
  } catch (error) {
    console.error("Error analyzing emotional patterns:", error);
    return null;
  }
}

// Generate therapeutic context for Dr. Emma based on past conversations
export async function generateTherapeuticContext(
  childId: string,
  currentMessage: string
): Promise<string> {
  try {
    const relevantMemories = await getRelevantMemories(
      childId,
      currentMessage,
      3
    );
    const emotionalPatterns = await getEmotionalPatterns(childId, 14); // Last 2 weeks

    if (relevantMemories.length === 0) {
      return "THERAPEUTIC MEMORY: This appears to be a new conversation topic for this child.";
    }

    let context = "THERAPEUTIC MEMORY CONTEXT:\n\n";

    // Add relevant past conversations
    context += "SIMILAR PAST CONVERSATIONS:\n";
    relevantMemories.forEach((memory, index) => {
      context += `${index + 1}. Previous discussion (${
        memory.conversation.session_date
      }):\n`;
      const childMessages = memory.conversation.messages
        .filter((msg: { sender: string }) => msg.sender === "child")
        .map((msg: { content: string }) => msg.content)
        .join("\n   ");
      context += `   Child said: "${childMessages}"\n`;
      context += `   Topics: ${memory.conversation.topics?.join(", ")}\n`;
      context += `   Mood then: Anxiety ${memory.conversation.mood.anxiety}/10, Stress ${memory.conversation.mood.stress}/10\n`;
      context += `   Insights: ${memory.conversation.therapeutic_insights}\n\n`;
    });

    // Add emotional patterns if available
    if (emotionalPatterns) {
      context += "RECENT EMOTIONAL PATTERNS (2 weeks):\n";
      context += `- Average Anxiety: ${emotionalPatterns.averageMood.anxiety.toFixed(
        1
      )}/10\n`;
      context += `- Average Stress: ${emotionalPatterns.averageMood.stress.toFixed(
        1
      )}/10\n`;
      context += `- Common Topics: ${emotionalPatterns.commonTopics
        .slice(0, 3)
        .map((t: any) => t.topic)
        .join(", ")}\n\n`;
    }

    context += "USE THIS CONTEXT TO:\n";
    context += "- Reference past conversations when relevant\n";
    context += "- Check in on previously discussed coping strategies\n";
    context += "- Notice patterns and help the child recognize them too\n";
    context += "- Build therapeutic continuity and trust\n";

    return context;
  } catch (error) {
    console.error("Error generating therapeutic context:", error);
    return "THERAPEUTIC MODE: Using current session context without historical memory.";
  }
}
