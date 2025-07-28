import { Request, Response } from "express";
import * as childrenService from "../services/childrenService.js";

export const getChildren = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const children = await childrenService.getChildren(family.id);
    res.json({ children });
  } catch (error) {
    console.error("Get children error:", error);
    res.status(500).json({ error: "Failed to fetch children" });
  }
};

export const getChild = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;
    const { childId } = req.params;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const child = await childrenService.getChild(childId, family.id);

    if (!child) {
      return res.status(404).json({ error: "Child not found" });
    }

    res.json({ child });
  } catch (error) {
    console.error("Get child error:", error);
    res.status(500).json({ error: "Failed to fetch child" });
  }
};

export const addChild = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;
    const childData = req.body;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const result = await childrenService.createChild(family.id, childData);

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json({
      success: true,
      child: result.child,
      message: "Child added successfully",
    });
  } catch (error) {
    console.error("Add child error:", error);
    res.status(500).json({ error: "Failed to save child" });
  }
};

export const updateChild = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;
    const { childId } = req.params;
    const childData = req.body;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const result = await childrenService.updateChild(
      childId,
      family.id,
      childData
    );

    if (!result.success) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    res.json({
      success: true,
      child: result.child,
      message: "Child updated successfully",
    });
  } catch (error) {
    console.error("Update child error:", error);
    res.status(500).json({ error: "Failed to update child" });
  }
};

export const deleteChild = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;
    const { childId } = req.params;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const result = await childrenService.deleteChild(childId, family.id);

    if (!result.success) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    res.json({ message: "Child deleted successfully" });
  } catch (error) {
    console.error("Delete child error:", error);
    res.status(500).json({ error: "Failed to delete child" });
  }
};
