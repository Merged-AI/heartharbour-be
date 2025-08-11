import nodemailer from "nodemailer";
import {
  generateWeeklyProgressHTML,
  WeeklyProgressTemplateData,
} from "../lib/emailTemplates";

export interface WeeklyProgressEmailData {
  parentName: string;
  parentEmail: string;
  childName: string;
  sessionCount: number;
  weeklyInsight: {
    story: string;
    what_happened: string;
    good_news: string;
  };
  moodImprovement: {
    status: "improving" | "declining" | "stable";
    summary: string;
  };
  actionPlan: {
    steps: Array<{
      timeframe: string;
      action: string;
      description: string;
    }>;
    quick_win: string;
  };
  wins?: string[];
}

// Create transporter with email service configuration
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_PORT === "465", // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // Additional options for better reliability
    pool: true, // use pooled connection
    maxConnections: 5, // limit connections
    maxMessages: 100, // limit messages per connection
  });
};

export async function sendWeeklyProgressEmail(data: WeeklyProgressEmailData) {
  try {
    const transporter = createTransporter();
    const emailHtml = generateEmailTemplate(data);

    const mailOptions = {
      from:
        process.env.SMTP_FROM || `"Lily Heart AI" <${process.env.SMTP_USER}>`,
      to: data.parentEmail,
      subject: `Weekly Progress Update: ${data.childName} completed ${data.sessionCount} sessions`,
      html: emailHtml,
      text: generateEmailText(data),
      // Add headers for better deliverability
      headers: {
        "X-Mailer": "Lily Heart AI Weekly Progress System",
        "X-Priority": "3",
      },
    };

    const info = await transporter.sendMail(mailOptions);

    return { success: true, emailId: info.messageId, response: info.response };
  } catch (error) {
    console.error("Error in sendWeeklyProgressEmail:", error);
    throw error;
  }
}

export async function sendTestEmail(
  testEmail: string,
  familyId?: string,
  childId?: string
) {
  // If specific family/child provided, use real data
  if (familyId && childId) {
    const { getDashboardAnalytics } = require("./analysisService");

    try {
      const analyticsResult = await getDashboardAnalytics(familyId, childId);

      if (analyticsResult.success && analyticsResult.data) {
        const analytics = analyticsResult.data;

        // Get child name from database
        const { createServerSupabase } = require("../lib/supabase");
        const supabase = createServerSupabase();

        const { data: child } = await supabase
          .from("children")
          .select("name")
          .eq("id", childId)
          .single();

        const { data: family } = await supabase
          .from("families")
          .select("name")
          .eq("id", familyId)
          .single();

        // Get session count for this week
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

        const { data: sessions } = await supabase
          .from("therapy_sessions")
          .select("id")
          .eq("child_id", childId)
          .gte("created_at", oneWeekAgo.toISOString())
          .eq("status", "completed");

        const realData: WeeklyProgressEmailData = {
          parentName: extractFirstName(family?.name || "Parent"),
          parentEmail: testEmail,
          childName: child?.name || "Child",
          sessionCount: sessions?.length || 0,
          weeklyInsight: analytics.weekly_insight || {
            story: "is continuing their emotional development journey",
            what_happened:
              "This week brought new learning opportunities and growth",
            good_news: "Showing consistent progress in emotional awareness",
          },
          moodImprovement: {
            status: analytics.emotional_trend?.status || "stable",
            summary:
              analytics.emotional_trend?.key_factors?.join(", ") ||
              "Continuing to build emotional awareness and communication skills.",
          },
          actionPlan: analytics.action_plan || {
            steps: [
              {
                timeframe: "This Week",
                action: "Continue regular conversations",
                description:
                  "Encourage your child to share their thoughts and feelings openly.",
              },
            ],
            quick_win:
              "Take 10 minutes today to ask about their day and listen actively.",
          },
        };

        return sendWeeklyProgressEmail(realData);
      }
    } catch (error) {
      console.error("Error getting real analytics data for test email:", error);
    }
  }

  // No real data available - test emails should only be sent with actual family data
  throw new Error(
    "Cannot send test email: No family/child data provided or analytics data unavailable"
  );
}

function extractFirstName(fullName: string): string {
  return fullName.split(" ")[0] || fullName;
}

function generateEmailTemplate(data: WeeklyProgressEmailData): string {
  const moodIcon =
    data.moodImprovement.status === "improving"
      ? "📈"
      : data.moodImprovement.status === "declining"
      ? "📉"
      : "📊";

  const templateData: WeeklyProgressTemplateData = {
    childName: data.childName,
    sessionCount: data.sessionCount,
    moodIcon,
    moodStatus:
      data.moodImprovement.status.charAt(0).toUpperCase() +
      data.moodImprovement.status.slice(1),
    moodSummary: data.moodImprovement.summary,
    wins: data.wins,
    weeklyInsight: data.weeklyInsight,
    actionPlan: data.actionPlan,
  };

  return generateWeeklyProgressHTML(templateData);
}

function generateEmailText(data: WeeklyProgressEmailData): string {
  return `
Weekly Progress Update: ${data.childName}

${data.childName} completed ${data.sessionCount} sessions this week.

MOOD TREND: ${data.moodImprovement.status.toUpperCase()}
${data.moodImprovement.summary}

THIS WEEK'S INSIGHTS:

What ${data.childName} is working through:
${data.childName} ${data.weeklyInsight.story}

What happened this week:
${data.weeklyInsight.what_happened}

The good news:
${data.weeklyInsight.good_news}

RECOMMENDED ACTIONS:

${data.actionPlan.steps
  .map(
    (step) => `
${step.timeframe.toUpperCase()}:
${step.action}
${step.description}
`
  )
  .join("\n")}

QUICK WIN FOR TODAY:
${data.actionPlan.quick_win}

---
Keep supporting ${data.childName}'s emotional growth.
View full dashboard: http://lilyheart.ai/dashboard

You're receiving this because you have an active Lily Heart AI subscription.
  `.trim();
}

// Test email configuration
export async function testEmailConnection() {
  try {
    const transporter = createTransporter();
    await transporter.verify();
    console.log("Email server connection verified successfully");
    return { success: true, message: "Email server connection verified" };
  } catch (error) {
    console.error("Email server connection failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
