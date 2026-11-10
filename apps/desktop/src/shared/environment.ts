export const MAX_ENVIRONMENT_VARIABLES = 32;
export interface EnvironmentVariable {
  name: string;
  value: string;
}
/** Configuration values only: these travel as SSH env requests, never shell source. */
export function validateEnvironment(value: unknown): EnvironmentVariable[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ENVIRONMENT_VARIABLES)
    throw new Error(
      'Environment variables must contain at most 32 entries, including inherited values.',
    );
  const names = new Set<string>();
  return Array.from(value).map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new Error('Environment entries require a name and a text value.');
    const item = entry as Record<string, unknown>;
    if (
      Object.keys(item).length !== 2 ||
      typeof item.name !== 'string' ||
      typeof item.value !== 'string' ||
      !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(item.name) ||
      item.name === 'TERM' ||
      names.has(item.name)
    )
      throw new Error(
        'Environment names must be unique identifiers of 1–64 letters, digits or underscores, starting with a letter or underscore. TERM is managed by the terminal.',
      );
    if (
      item.value.length > 1024 ||
      Array.from(item.value).some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || (code >= 127 && code <= 159) || code === 0x2028 || code === 0x2029;
      })
    )
      throw new Error(
        'Environment values must be single-line text of at most 1,024 characters without control characters.',
      );
    names.add(item.name);
    return { name: item.name, value: item.value };
  });
}
