import * as cron from "node-cron";

export function startProductionCronJobs() {
  // Weekly progress emails - Every Sunday at 9:00 AM
  cron.schedule(
    "0 9 * * 0",
    async () => {
      try {
        // Call the weekly email scheduler internally
        const {
          sendWeeklyProgressEmailsInternal,
        } = require("../controllers/emailController");
        await sendWeeklyProgressEmailsInternal();
      } catch (error) {
        console.error("❌ Error in weekly email cron:", error);
      }
    },
    {
      timezone: "America/New_York",
    }
  );
}

// Export the internal function so cron can access it
export async function triggerWeeklyEmails() {
  const {
    sendWeeklyProgressEmailsInternal,
  } = require("../controllers/emailController");
  return await sendWeeklyProgressEmailsInternal();
}
