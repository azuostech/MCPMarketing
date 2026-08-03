import { z } from 'zod';

type JsonSchema = {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  additionalProperties?: boolean;
};

function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return unwrapSchema(schema.unwrap());
  }
  if (schema instanceof z.ZodDefault) {
    return unwrapSchema(schema.removeDefault());
  }
  return schema;
}

function convertSchema(schema: z.ZodTypeAny): JsonSchema {
  const value = unwrapSchema(schema);
  const description = schema.description ?? value.description;

  if (value instanceof z.ZodString) {
    return { type: 'string', ...(description ? { description } : {}) };
  }
  if (value instanceof z.ZodNumber) {
    return { type: 'number', ...(description ? { description } : {}) };
  }
  if (value instanceof z.ZodBoolean) {
    return { type: 'boolean', ...(description ? { description } : {}) };
  }
  if (value instanceof z.ZodArray) {
    return {
      type: 'array',
      items: convertSchema(value.element),
      ...(description ? { description } : {})
    };
  }
  if (value instanceof z.ZodObject) {
    const shape = value.shape;
    return {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(shape).map(([key, child]) => [key, convertSchema(child as z.ZodTypeAny)])
      ),
      required: Object.entries(shape)
        .filter(([, child]) => !(child instanceof z.ZodOptional) && !(child instanceof z.ZodDefault))
        .map(([key]) => key),
      additionalProperties: false,
      ...(description ? { description } : {})
    };
  }

  return { type: 'object', ...(description ? { description } : {}) };
}

export function toMcpInputSchema(schema: z.ZodTypeAny) {
  return convertSchema(schema) as JsonSchema & { type: 'object' };
}
