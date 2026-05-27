import { z } from "zod";

export const signupSchema = z.object({
  first_name: z.string().min(1, "First name is required"),
  last_name: z.string().min(1, "Last name is required"),
  email: z.string().email("Invalid email address"),
  mobile: z
    .string()
    .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number"),
  pan: z
    .string()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, "PAN must be in format: ABCDE1234F"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export const uploadSchema = z.object({
  assessment_year: z
    .string()
    .regex(/^\d{4}-\d{2}$/, "Format: 2024-25"),
  doc_type: z.enum(["form16", "form26as", "other"]),
});
