import type { JsonSchema } from './types';

/**
 * Validates the JSON Schema subset actions use: object/array/string/number/
 * integer/boolean/null types (or a list of them), required, properties,
 * additionalProperties:false, enum, items, minLength/maxLength, minimum/maximum.
 * Returns problems as `path: message`, empty when valid.
 */
export function validate(value: unknown, schema: JsonSchema, path = 'input'): string[] {
  const errors: string[] = [];
  const types = schema.type === undefined ? null : (Array.isArray(schema.type) ? schema.type : [schema.type]) as string[];

  if (types && !types.some((t) => matchesType(value, t))) {
    return [`${path}: must be ${types.join(' or ')}`];
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => e === value)) {
    errors.push(`${path}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  }
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) errors.push(`${path}: must be at least ${schema.minLength} characters`);
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) errors.push(`${path}: must be at most ${schema.maxLength} characters`);
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${path}: must be >= ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${path}: must be <= ${schema.maximum}`);
  }
  if (Array.isArray(value) && schema.items && typeof schema.items === 'object') {
    value.forEach((item, i) => errors.push(...validate(item, schema.items as JsonSchema, `${path}[${i}]`)));
  }
  if (isObject(value)) {
    const properties = (isObject(schema.properties) ? schema.properties : {}) as Record<string, JsonSchema>;
    for (const name of Array.isArray(schema.required) ? (schema.required as string[]) : []) {
      if (value[name] === undefined) errors.push(`${path}.${name}: is required`);
    }
    for (const [name, child] of Object.entries(value)) {
      if (properties[name]) {
        errors.push(...validate(child, properties[name], `${path}.${name}`));
      } else if (schema.additionalProperties === false) {
        errors.push(`${path}.${name}: is not allowed`);
      }
    }
  }

  return errors;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object': return isObject(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return true;
  }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
