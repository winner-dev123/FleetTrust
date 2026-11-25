/**
 * Fills `{name}` placeholders in a catalog message. Every placeholder must have a value and every
 * value must be used, so a typo shows up in tests instead of on a screen.
 */
export function fill(message: string, values: Readonly<Record<string, string | number>>): string {
  const used = new Set<string>();
  const text = message.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`missing value for {${name}} in "${message}"`);
    used.add(name);
    return String(value);
  });
  const unused = Object.keys(values).filter((name) => !used.has(name));
  if (unused.length > 0) throw new Error(`unused value(s) ${unused.join(", ")} for "${message}"`);
  return text;
}

/** Picks the singular or plural message by count (English rules), then fills `{count}`. */
export function plural(
  count: number,
  messages: { one: string; other: string },
  values: Readonly<Record<string, string | number>> = {},
): string {
  return fill(count === 1 ? messages.one : messages.other, { ...values, count });
}
