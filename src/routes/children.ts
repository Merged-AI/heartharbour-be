import { Router } from "express";
import * as childrenController from "../controllers/childrenController.js";
import { authenticateUser } from "../lib/auth";

const router = Router();

// GET /api/children - Get all children for the family
router.get("/", authenticateUser, childrenController.getChildren);

// POST /api/children - Add a new child
router.post("/", authenticateUser, childrenController.addChild);

// GET /api/children/:childId - Get specific child data
router.get("/:childId", authenticateUser, childrenController.getChild);

// PUT /api/children/:childId - Update child data
router.put("/:childId", authenticateUser, childrenController.updateChild);

// DELETE /api/children/:childId - Delete a child
router.delete("/:childId", authenticateUser, childrenController.deleteChild);

export default router;
