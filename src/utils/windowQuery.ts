/** Read `sessionId`, optional `connectionId`, and remote `path` from a secondary window URL. */
export function readWindowQuery() {
  const params = new URLSearchParams(window.location.search)
  return {
    sessionId: params.get('sessionId') ?? '',
    connectionId: params.get('connectionId') ?? '',
    remotePath: params.get('path') ?? '',
  }
}
