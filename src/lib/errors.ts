import { AiError } from './ai'
import type { MessageKey, Translate } from './i18n'

export function errorMessage(error: unknown, t: Translate): string {
  if (error instanceof AiError) return t(`error.${error.code}` as MessageKey, { message: error.message })
  return t('error.other', { message: error instanceof Error ? error.message : String(error) })
}
