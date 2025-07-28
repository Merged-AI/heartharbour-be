import { Request, Response } from "express";
import * as authService from "../services/authService.js";

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const result = await authService.login(email, password);

    if (!result.success) {
      return res.status(result.status || 401).json({ error: result.error });
    }

    // Set authentication cookie
    res.cookie("auth_token", result.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    res.json({
      success: true,
      family: result.family,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const logout = async (req: Request, res: Response) => {
  try {
    // Clear the custom auth token cookie
    res.cookie("auth_token", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 0,
      path: "/",
    });

    // Sign out from Supabase (if needed)
    await authService.logout();

    res.json({ success: true });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const autoLogin = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const result = await authService.autoLogin(email, password);

    if (!result.success) {
      return res.status(result.status || 401).json({ error: result.error });
    }

    // Set authentication cookie
    res.cookie("auth_token", result.sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      path: "/",
    });

    res.json({
      success: true,
      user: result.user,
      family: result.family,
      message: "Authentication successful",
    });
  } catch (error) {
    console.error("Auto-login error:", error);
    res.status(500).json({ error: "Failed to authenticate" });
  }
};

export const checkUser = async (req: Request, res: Response) => {
  try {
    const { email, password, familyData } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const result = await authService.checkUser(email, password, familyData);

    res.status(result.success ? 200 : 404).json(result);
  } catch (error) {
    console.error("Check user error:", error);
    res.status(500).json({ error: "Failed to check user status" });
  }
};

export const getCurrentUser = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const userData = await authService.getUserWithChildren(family.id);
    res.json(userData);
  } catch (error) {
    console.error("Auth check error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const setPin = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;
    const { pin } = req.body;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: "PIN must be exactly 4 digits" });
    }

    const result = await authService.setPin(family.id, pin);

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json({ success: true, message: "PIN saved successfully" });
  } catch (error) {
    console.error("PIN save error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const validatePin = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;
    const { pin } = req.body;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!pin || pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      return res.status(400).json({ error: "Invalid PIN format" });
    }

    const result = await authService.validatePin(family.id, pin);

    if (!result.success) {
      return res.status(result.status || 401).json({ error: result.error });
    }

    res.json({ success: true, message: "PIN validated successfully" });
  } catch (error) {
    console.error("PIN validation error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const testPin = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const result = await authService.checkPinExists(family.id);

    if (!result.success) {
      return res.status(result.status || 404).json({ error: result.error });
    }

    res.json({ success: true, hasPin: true });
  } catch (error) {
    console.error("PIN check error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const updatePin = async (req: Request, res: Response) => {
  try {
    const family = (req as any).family;
    const { currentPin, newPin } = req.body;

    if (!family) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!currentPin || !newPin) {
      return res
        .status(400)
        .json({ error: "Current PIN and new PIN are required" });
    }

    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
      return res
        .status(400)
        .json({ error: "New PIN must be exactly 4 digits" });
    }

    const result = await authService.updatePin(family.id, currentPin, newPin);

    if (!result.success) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    res.json({ success: true, message: "PIN updated successfully" });
  } catch (error) {
    console.error("PIN update error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
