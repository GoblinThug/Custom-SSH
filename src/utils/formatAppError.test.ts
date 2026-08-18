import { describe, expect, it } from 'vitest'
import type { MessageKey } from '../i18n/messages'
import { formatAppError, unwrapErrorMessage } from './formatAppError'

const t = (key: MessageKey) => `T:${key}`

describe('unwrapErrorMessage', () => {
  it('unwraps Electron IPC error prefixes', () => {
    expect(
      unwrapErrorMessage(
        "Error invoking remote method 'ssh:connect': Error: ECONNREFUSED",
      ),
    ).toBe('ECONNREFUSED')
  })

  it('reads Error.message', () => {
    expect(unwrapErrorMessage(new Error('boom'))).toBe('boom')
  })
})

describe('formatAppError', () => {
  it('maps Node error codes', () => {
    expect(formatAppError({ code: 'ECONNREFUSED' }, t)).toBe('T:errConnectRefused')
    expect(formatAppError({ code: 'ENOTFOUND' }, t)).toBe('T:errHostNotFound')
  })

  it('maps message patterns', () => {
    expect(formatAppError('All configured authentication methods failed', t)).toBe(
      'T:errAuthFailed',
    )
    expect(formatAppError('FTP is not supported yet', t)).toBe(
      'T:errFtpNotSupported',
    )
    expect(formatAppError('Timed out while waiting for handshake', t)).toBe(
      'T:errConnectTimeout',
    )
    expect(formatAppError('archive_too_large', t)).toBe('T:archiveTooLarge')
  })

  it('uses fallback when nothing matches', () => {
    expect(formatAppError('weird-unknown', t, 'errUnknown')).toBe('T:errUnknown')
  })

  it('returns cleaned message when there is no fallback', () => {
    expect(formatAppError('weird-unknown', t)).toBe('weird-unknown')
  })
})
