import { readFile } from 'node:fs/promises';

function validate(schema, data, path = '') {
  const errors = [];

  if (schema.type) {
    const validType = schema.type === 'array' ? Array.isArray(data) : typeof data === schema.type;
    if (!validType) {
      errors.push(`${path || 'root'} expected ${schema.type}, got ${Array.isArray(data) ? 'array' : typeof data}`);
      return errors;
    }
  }

  if (schema.type === 'object' && data) {
    if (schema.required) {
      for (const key of schema.required) {
        if (!(key in data)) errors.push(`${path || 'root'} missing required field ${key}`);
      }
    }

    const props = schema.properties || {};
    for (const [key, prop] of Object.entries(props)) {
      if (!(key in data)) continue;
      const subPath = path ? `${path}.${key}` : key;
      errors.push(...validate(prop, data[key], subPath));
    }

    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(props));
      for (const key of Object.keys(data)) {
        if (!allowed.has(key)) errors.push(`${path || 'root'} unexpected field ${key}`);
      }
    }
  }

  if (schema.type === 'array' && Array.isArray(data)) {
    if (schema.items) {
      for (let i = 0; i < data.length; i++) {
        errors.push(...validate(schema.items, data[i], `${path}[${i}]`));
      }
    }
  }

  if (schema.enum && !schema.enum.includes(data)) {
    errors.push(`${path || 'root'} must be one of ${schema.enum.join(', ')}`);
  }

  if (schema.pattern && typeof data === 'string' && !new RegExp(schema.pattern).test(data)) {
    errors.push(`${path || 'root'} does not match pattern ${schema.pattern}`);
  }

  if (schema.maxLength && typeof data === 'string' && data.length > schema.maxLength) {
    errors.push(`${path || 'root'} exceeds maxLength ${schema.maxLength}`);
  }

  return errors;
}

async function main() {
  const [schemaPath, dataPath] = process.argv.slice(2);
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
  const data = JSON.parse(await readFile(dataPath, 'utf8'));
  const errors = validate(schema, data);
  if (errors.length) {
    for (const e of errors) console.error(e);
    process.exit(1);
  }
}

main();
