import { BadRequestException, Injectable } from "@nestjs/common";
import type { PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? "validation failed";
      throw new BadRequestException({ error: message, code: "validation_error" });
    }
    return result.data;
  }
}

export function zodBody(schema: ZodSchema): ZodValidationPipe {
  return new ZodValidationPipe(schema);
}
