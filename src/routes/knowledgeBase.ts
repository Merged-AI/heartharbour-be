import { Router } from "express";
import * as knowledgeBaseController from "../controllers/knowledgeBaseController.js";
import { authenticateUser } from "../lib/auth";
import multer from "multer";

const router = Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// POST /api/knowledge-base/upload - Upload new knowledge base files
router.post(
  "/upload",
  authenticateUser,
  upload.array("files"),
  knowledgeBaseController.uploadFiles
);

// GET /api/knowledge-base/upload/:fileId - Get upload status
router.get(
  "/upload/:fileId",
  authenticateUser,
  knowledgeBaseController.getUploadStatus
);

// PUT /api/knowledge-base/upload/:fileId - Update uploaded file
router.put(
  "/upload/:fileId",
  authenticateUser,
  knowledgeBaseController.updateUploadedFile
);

// DELETE /api/knowledge-base/upload/:fileId - Delete uploaded file
router.delete(
  "/upload/:fileId",
  authenticateUser,
  knowledgeBaseController.deleteUploadedFile
);

export default router;
