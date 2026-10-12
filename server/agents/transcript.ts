import type { MessageOption, TranscriptEntry } from '../types.js'

const SPEAKER: Record<TranscriptEntry['side'], string> = {
  customer: 'CUSTOMER',
  ordoor: 'ORDOOR',
  store: 'ORDOOR → STORE',
  store_agent: 'STORE',
  system: 'NOTE',
}

export function formatOptions(options: MessageOption[] | null | undefined): string {
  if (!options?.length) return ''
  return options.map((o) => `    [${o.position}] id="${o.id}" title="${o.title}"${o.description ? ` — ${o.description}` : ''}`).join('\n')
}

/** The conversation as a model reads it — who said what, and what each message let you tap. */
export function formatTranscript(entries: TranscriptEntry[], opts: { you?: TranscriptEntry['side'] } = {}): string {
  if (!entries.length) return '(no messages yet)'
  return entries
    .map((e) => {
      const who = opts.you === e.side ? 'YOU' : SPEAKER[e.side]
      const kind = e.type === 'text' ? '' : ` (${e.type})`
      const options = formatOptions(e.options)
      return `${who}${kind}: ${e.text}${options ? `\n  options you can tap:\n${options}` : ''}`
    })
    .join('\n')
}

/** The options of the newest message that offered any, searched backwards. */
export function latestOptions(entries: TranscriptEntry[], sides: TranscriptEntry['side'][]): MessageOption[] {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!
    if (sides.includes(e.side) && e.options?.length) return e.options
  }
  return []
}

/** Find a tapped option by id, else by title, among the given options. */
export function resolveOption(options: MessageOption[], idOrTitle: string | undefined): MessageOption | undefined {
  if (!idOrTitle) return undefined
  return options.find((o) => o.id === idOrTitle) ?? options.find((o) => o.title.trim() === idOrTitle.trim())
}
