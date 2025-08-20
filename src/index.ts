import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";
import { errorHandler } from "./middleware/errorHandler";
import { notFoundHandler } from "./middleware/notFoundHandler";
import authRoutes from "./routes/auth";
import analysisRoutes from "./routes/analysis";
import chatRoutes from "./routes/chat";
import childrenRoutes from "./routes/children";
import knowledgeBaseRoutes from "./routes/knowledgeBase";
import moodTrackingRoutes from "./routes/moodTracking";
import profileRoutes from "./routes/profile";
import profileCheckRoutes from "./routes/profileCheck";
import sessionsRoutes from "./routes/sessions";
import stripeRoutes from "./routes/stripe";
import emailRoutes from "./routes/email";
import { startProductionCronJobs } from "./utils/cronScheduler";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());

// CORS configuration for web and mobile apps
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);

      const allowedOrigins = [
        process.env.FRONTEND_URL || "http://localhost:3000",
        process.env.MOBILE_APP_URL || "http://localhost:3000",
      ];

      // Allow all Vercel preview deployments
      const isVercelPreview =
        origin.includes("heartharbour") && origin.includes("vercel.app");

      if (allowedOrigins.includes(origin) || isVercelPreview) {
        callback(null, true);
      } else {
        console.log("CORS blocked origin:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
      "Cache-Control",
      "X-File-Name",
    ],
    credentials: true, // Important for cookies/auth
    optionsSuccessStatus: 200, // Some legacy browsers choke on 204
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: "Too many requests from this IP, please try again later.",
  },
});
app.use("/api/", limiter);

// Logging middleware
app.use(morgan("combined"));

// Body parsing middleware
// Special handling for Stripe webhooks - need raw body for signature verification
app.use("/api/stripe/webhook", express.raw({ type: "application/json" }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Disable ETag for API routes to prevent 304 responses
app.set("etag", false);

// API routes
app.use("/api/auth", authRoutes);
app.use("/api/analysis", analysisRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/children", childrenRoutes);
app.use("/api/knowledge-base", knowledgeBaseRoutes);
app.use("/api/mood-tracking", moodTrackingRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/profile-check", profileCheckRoutes);
app.use("/api/sessions", sessionsRoutes);
app.use("/api/stripe", stripeRoutes);
app.use("/api/email", emailRoutes);

// 404 handler
app.use(notFoundHandler);

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);

  // Start production cron jobs
  startProductionCronJobs();
});

export default app;
