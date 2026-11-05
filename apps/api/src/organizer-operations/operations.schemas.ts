import { z } from "zod";
export const StaffCreateSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email()
      .max(255)
      .transform((s) => s.toLowerCase()),
    fullName: z.string().trim().min(1).max(150),
    password: z.string().min(12).max(128),
    phone: z.string().trim().max(20).optional(),
  })
  .strict();
export const StaffUpdateSchema = z
  .object({
    fullName: z.string().trim().min(1).max(150).optional(),
    phone: z.string().trim().max(20).optional(),
    status: z.enum(["ACTIVE", "LOCKED"]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
export const PageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const GateSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    locationDesc: z.string().trim().max(255).optional(),
  })
  .strict();
export const AssignmentSchema = z
  .object({ userId: z.string().uuid(), gateId: z.string().uuid() })
  .strict();
export const ExportSchema = z
  .object({ format: z.enum(["csv", "xlsx"]) })
  .strict();
export type StaffCreate = z.infer<typeof StaffCreateSchema>;
export type StaffUpdate = z.infer<typeof StaffUpdateSchema>;
export type Page = z.infer<typeof PageSchema>;
