import { Request, Response } from "express";
import * as knowledgeBaseService from "../services/knowledgeBaseService.js";

export const uploadFiles = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // Handle multipart form data
    const files = req.files as Express.Multer.File[] | undefined;
    const childId = req.body.childId;

    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files provided" });
    }

    if (!childId) {
      return res.status(400).json({ error: "Child ID is required" });
    }

    const result = await knowledgeBaseService.uploadFiles(
      childId,
      files,
      family.id
    );

    if (!result.success) {
      return res.status(result.status || 500).json({
        error: result.error,
        details: result.details,
        receivedFiles: result.receivedFiles,
      });
    }

    res.json({
      success: true,
      message: result.message,
      documents: result.documents,
    });
  } catch (error) {
    console.error("Upload files error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getUploadStatus = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;
    const { fileId } = req.params;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const result = await knowledgeBaseService.getUploadStatus(fileId);

    if (!result.success) {
      return res.status(result.status || 404).json({ error: result.error });
    }

    res.json({
      success: true,
      document: result.document,
    });
  } catch (error) {
    console.error("Get upload status error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const updateUploadedFile = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;
    const { fileId } = req.params;
    const updateData = req.body;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const result = await knowledgeBaseService.updateUploadedFile(
      fileId,
      updateData,
      family.id
    );

    if (!result.success) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    res.json({
      success: true,
      message: "File updated successfully",
      document: result.document,
    });
  } catch (error) {
    console.error("Update uploaded file error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const deleteUploadedFile = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;
    const { fileId } = req.params;
    const { childId } = req.query;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!childId) {
      return res.status(400).json({ error: "Child ID is required" });
    }

    const result = await knowledgeBaseService.deleteUploadedFile(
      fileId,
      childId as string,
      family.id
    );

    if (!result.success) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    res.json({
      success: true,
      message: result.message,
      deletedFileId: fileId,
    });
  } catch (error) {
    console.error("Delete uploaded file error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
