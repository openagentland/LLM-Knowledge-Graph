export function parseToolTextPayload<T>(result: {
  content?: Array<{ text?: string; type: string }>;
}): T {
  const content = result.content ?? [];
  return JSON.parse(content[0]?.text ?? "{}") as T;
}
