/** Generate a unique id (renderer-safe). */
export function newId(): string {
  return crypto.randomUUID()
}
