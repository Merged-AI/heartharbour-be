import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface TherapeuticGuidance {
  frameworks: string;
  diagnostics: string;
  emotionalLiteracy: string;
  bestPractices: string;
  crisisIntervention: string;
  ageAppropriate: string;
}

// Global state for the therapeutic knowledge
let knowledge: TherapeuticGuidance | null = null;
let isLoaded = false;

// Load and parse the therapeutic knowledge base
export async function loadKnowledgeBase(): Promise<void> {
  if (isLoaded && knowledge) {
    return; // Already loaded
  }

  try {
    // Try multiple possible paths for the knowledge base file
    const possiblePaths = [
      path.join(
        process.cwd(),
        "Therapeutic Chatbot Knowledge Base for Children.md"
      ),
      path.join(
        process.cwd(),
        "..",
        "Therapeutic Chatbot Knowledge Base for Children.md"
      ),
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "Therapeutic Chatbot Knowledge Base for Children.md"
      ),
    ];

    let filePath = "";
    let fileExists = false;

    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        filePath = possiblePath;
        fileExists = true;
        break;
      }
    }

    if (!fileExists) {
      console.warn(
        "⚠️ Therapeutic knowledge base file not found, using fallback knowledge"
      );
      knowledge = getFallbackKnowledge();
      isLoaded = true;
      return;
    }

    const markdownContent = fs.readFileSync(filePath, "utf-8");
    knowledge = parseKnowledgeContent(markdownContent);
    isLoaded = true;

    console.log(
      "✅ Therapeutic knowledge base loaded and embedded into AI system"
    );
  } catch (error) {
    console.error("Error loading therapeutic knowledge base:", error);
    knowledge = getFallbackKnowledge();
    isLoaded = true;
  }
}

// Parse the markdown content into structured therapeutic guidance
function parseKnowledgeContent(content: string): TherapeuticGuidance {
  const sections = content.split(/^##\s+(.+)$/gm);

  let frameworks = "";
  let diagnostics = "";
  let emotionalLiteracy = "";
  let bestPractices = "";
  let crisisIntervention = "";
  let ageAppropriate = "";

  for (let i = 1; i < sections.length; i += 2) {
    const sectionTitle = sections[i].trim().toLowerCase();
    const sectionContent = sections[i + 1]?.trim() || "";

    if (sectionTitle.includes("therapeutic frameworks")) {
      frameworks = extractKeyGuidance(sectionContent, "frameworks");
    } else if (sectionTitle.includes("diagnostic")) {
      diagnostics = extractKeyGuidance(sectionContent, "diagnostics");
    } else if (sectionTitle.includes("emotional literacy")) {
      emotionalLiteracy = extractKeyGuidance(
        sectionContent,
        "emotional-literacy"
      );
    } else if (sectionTitle.includes("best practices")) {
      bestPractices = extractKeyGuidance(sectionContent, "best-practices");
    }
  }

  // Extract crisis intervention and age-appropriate guidance from multiple sections
  crisisIntervention = extractCrisisGuidance(content);
  ageAppropriate = extractAgeGuidance(content);

  return {
    frameworks,
    diagnostics,
    emotionalLiteracy,
    bestPractices,
    crisisIntervention,
    ageAppropriate,
  };
}

// Extract key therapeutic guidance from content
function extractKeyGuidance(content: string, category: string): string {
  const lines = content.split("\n");
  const keyPoints: string[] = [];

  lines.forEach((line) => {
    const trimmed = line.trim();

    // Extract bullet points and key therapeutic concepts
    if (
      trimmed.startsWith("*") ||
      trimmed.startsWith("-") ||
      trimmed.startsWith("•")
    ) {
      keyPoints.push(trimmed.substring(1).trim());
    }

    // Extract sentences with therapeutic keywords
    if (
      category === "frameworks" &&
      (trimmed.includes("CBT") ||
        trimmed.includes("play therapy") ||
        trimmed.includes("trauma-informed") ||
        trimmed.includes("attachment"))
    ) {
      keyPoints.push(trimmed);
    }

    if (
      category === "diagnostics" &&
      (trimmed.includes("DSM") ||
        trimmed.includes("screening") ||
        trimmed.includes("assessment") ||
        trimmed.includes("checklist"))
    ) {
      keyPoints.push(trimmed);
    }

    if (
      category === "emotional-literacy" &&
      (trimmed.includes("emotion") ||
        trimmed.includes("feeling") ||
        trimmed.includes("vocabulary") ||
        trimmed.includes("regulation"))
    ) {
      keyPoints.push(trimmed);
    }

    if (
      category === "best-practices" &&
      (trimmed.includes("tone") ||
        trimmed.includes("communication") ||
        trimmed.includes("interaction") ||
        trimmed.includes("response"))
    ) {
      keyPoints.push(trimmed);
    }
  });

  return keyPoints.slice(0, 10).join("\n- "); // Limit to top 10 points
}

// Extract crisis intervention guidance
function extractCrisisGuidance(content: string): string {
  const crisisKeywords = [
    "crisis",
    "safety",
    "self-harm",
    "suicide",
    "abuse",
    "trauma",
    "emergency",
    "risk",
    "concerning",
    "intervention",
  ];

  const lines = content.split("\n");
  const crisisGuidance: string[] = [];

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (
      crisisKeywords.some((keyword) => trimmed.toLowerCase().includes(keyword))
    ) {
      if (trimmed.length > 20) {
        // Avoid very short fragments
        crisisGuidance.push(trimmed);
      }
    }
  });

  return `CRISIS RESPONSE PROTOCOLS:
- ${crisisGuidance.slice(0, 8).join("\n- ")}`;
}

// Extract age-appropriate guidance
function extractAgeGuidance(content: string): string {
  const ageKeywords = [
    "age",
    "developmental",
    "young",
    "older",
    "child",
    "teen",
    "years old",
    "preschool",
    "elementary",
    "adolescent",
  ];

  const lines = content.split("\n");
  const ageGuidance: string[] = [];

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (
      ageKeywords.some((keyword) => trimmed.toLowerCase().includes(keyword))
    ) {
      if (trimmed.length > 20) {
        ageGuidance.push(trimmed);
      }
    }
  });

  return `AGE-APPROPRIATE INTERVENTIONS:
- ${ageGuidance.slice(0, 8).join("\n- ")}`;
}

// Fallback knowledge when file is not available
function getFallbackKnowledge(): TherapeuticGuidance {
  return {
    frameworks: `CORE THERAPEUTIC FRAMEWORKS:
- Cognitive Behavioral Therapy (CBT): Help identify thought patterns and coping strategies
- Play Therapy: Use age-appropriate, playful interactions for younger children
- Trauma-Informed Care: Prioritize safety, trust, and collaboration
- Attachment Theory: Build secure, reliable therapeutic relationships
- Strengths-Based Approach: Focus on child's existing abilities and resilience`,

    diagnostics: `CLINICAL AWARENESS:
- Monitor for signs of anxiety, depression, attention difficulties
- Use age-appropriate screening questions from validated tools
- Observe behavioral patterns and emotional regulation
- Track functioning across home, school, and peer domains
- Recognize when professional referral may be needed`,

    emotionalLiteracy: `EMOTIONAL LITERACY DEVELOPMENT:
- Expand emotional vocabulary appropriate to child's age
- Teach feeling identification and expression techniques
- Use emotion wheels, charts, and visual aids
- Practice emotional regulation and coping skills
- Help children understand mind-body connection`,

    bestPractices: `COMMUNICATION BEST PRACTICES:
- Use simple, clear language appropriate for child's developmental level
- Employ reflective listening and validation techniques
- Ask open-ended questions with "I wonder" statements
- Maintain warm, non-judgmental tone consistently
- Balance playfulness with respect for child's maturity`,

    crisisIntervention: `CRISIS RESPONSE PROTOCOLS:
- Immediately assess safety for suicidal ideation, self-harm, or abuse
- Use de-escalation and emotional stabilization techniques
- Provide crisis resources and emergency contacts
- Document concerning content for professional follow-up
- Never attempt to replace professional crisis intervention`,

    ageAppropriate: `AGE-APPROPRIATE INTERVENTIONS:
- Ages 4-8: Simple language, concrete concepts, play-based approaches
- Ages 9-12: Expanded vocabulary, emotion regulation skills, peer focus
- Ages 13+: Respectful communication, identity development, future planning
- Adjust complexity of therapeutic concepts to developmental stage
- Balance independence encouragement with appropriate support`,
  };
}

// Get comprehensive therapeutic context for AI system
export function getTherapeuticContext(
  childAge?: number,
  concerns?: string[],
  messageContent?: string
): string {
  if (!knowledge) {
    return "";
  }

  let context = `INTEGRATED THERAPEUTIC KNOWLEDGE BASE:

CORE THERAPEUTIC FRAMEWORKS:
${knowledge.frameworks}

CLINICAL AWARENESS:
${knowledge.diagnostics}

EMOTIONAL LITERACY GUIDANCE:
${knowledge.emotionalLiteracy}

COMMUNICATION BEST PRACTICES:
${knowledge.bestPractices}

${knowledge.crisisIntervention}

${knowledge.ageAppropriate}

CONTEXTUAL GUIDANCE FOR THIS INTERACTION:`;

  // Add age-specific guidance
  if (childAge) {
    if (childAge <= 8) {
      context += `
- Child is 4-8 years old: Use simple language, play-based approaches, basic emotions, concrete suggestions
- Employ storytelling, metaphors, and playful interactions
- Keep explanations short and use visual/experiential learning`;
    } else if (childAge <= 12) {
      context += `
- Child is 9-12 years old: Expand emotional vocabulary, use emotion wheels/charts
- Balance respect with age-appropriate guidance
- Introduce more complex emotional concepts gradually`;
    } else {
      context += `
- Child is 13+ years old: Use respectful, mature communication
- Focus on independence, identity, and future-oriented thinking
- Avoid overly childish language while maintaining warmth`;
    }
  }

  // Add concern-specific guidance
  if (concerns && concerns.length > 0) {
    context += `
- Known concerns: ${concerns.join(", ")}
- Tailor responses to address these specific areas
- Monitor for patterns related to these concerns`;
  }

  // Add message-specific guidance
  if (messageContent) {
    const lowerContent = messageContent.toLowerCase();
    if (
      lowerContent.includes("anxious") ||
      lowerContent.includes("worried") ||
      lowerContent.includes("scared")
    ) {
      context += `
- Child expressing anxiety: Use grounding techniques, validate fears, teach breathing exercises
- Focus on safety and present-moment awareness`;
    }
    if (
      lowerContent.includes("sad") ||
      lowerContent.includes("upset") ||
      lowerContent.includes("cry")
    ) {
      context += `
- Child expressing sadness: Provide emotional validation, explore underlying causes gently
- Normalize sad feelings and offer comfort strategies`;
    }
    if (
      lowerContent.includes("angry") ||
      lowerContent.includes("mad") ||
      lowerContent.includes("frustrat")
    ) {
      context += `
- Child expressing anger: Help identify triggers, teach anger regulation techniques
- Explore feelings underneath the anger (hurt, fear, disappointment)`;
    }
  }

  context += `

INTEGRATION DIRECTIVE:
Seamlessly weave this therapeutic knowledge into your responses. Don't reference this guidance directly, but let it inform your therapeutic approach, language choices, and intervention strategies. Be Dr. Emma - warm, professional, and therapeutically informed.`;

  return context;
}

// Check if knowledge base is loaded
export function isKnowledgeLoaded(): boolean {
  return isLoaded;
}

// Get specific guidance section
export function getGuidanceSection(section: keyof TherapeuticGuidance): string {
  return knowledge?.[section] || "";
}

// Auto-load knowledge base when module is imported
loadKnowledgeBase().catch((error) => {
  console.error("Failed to auto-load therapeutic knowledge base:", error);
});
