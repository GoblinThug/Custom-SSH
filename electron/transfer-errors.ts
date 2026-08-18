export class TransferCancelledError extends Error {
  readonly fileKey: string

  constructor(fileKey: string) {
    super('Transfer cancelled')
    this.name = 'TransferCancelledError'
    this.fileKey = fileKey
  }
}

export function isTransferCancelledError(err: unknown): boolean {
  return (
    err instanceof TransferCancelledError ||
    (err instanceof Error && err.name === 'TransferCancelledError')
  )
}
