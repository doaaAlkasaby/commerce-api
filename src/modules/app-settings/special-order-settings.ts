export function readSpecialOrderSettings(value: unknown) {
  const settings =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const instruction = (input: unknown) =>
    typeof input === 'string' ? input.trim().slice(0, 2000) || null : null;
  return {
    enabled: settings.enabled === true,
    instructionsAr: instruction(settings.instructionsAr),
    instructionsEn: instruction(settings.instructionsEn),
  };
}
