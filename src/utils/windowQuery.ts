/** Read `sessionId` and remote `path` from a secondary window URL. */
export function readWindowQuery() {
  const params = new URLSearchParams(window.location.search)
  return {
    sessionId: params.get('sessionId') ?? '',
    remotePath: params.get('path') ?? '',
  }
}
