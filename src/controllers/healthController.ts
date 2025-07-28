import { Request, Response } from "express";
import { HealthService } from "../services/healthService";

export class HealthController {
  private healthService: HealthService;

  constructor() {
    this.healthService = new HealthService();
  }

  getBasicHealth = (req: Request, res: Response) => {
    const health = this.healthService.getBasicHealth();
    res.status(200).json(health);
  };

  getDetailedHealth = async (req: Request, res: Response) => {
    try {
      const health = await this.healthService.getDetailedHealth();
      res.json(health);
    } catch (error) {
      console.error("Health check error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
