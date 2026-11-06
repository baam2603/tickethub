import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException({
      code: "VALIDATION_ERROR",
      details: result.error.flatten(),
    });
  return result.data;
}
