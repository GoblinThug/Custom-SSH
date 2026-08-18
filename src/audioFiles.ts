function audioBaseName(name: string): string {
  const trimmed = name.trim().replace(/\\/g, '/')
  return trimmed.split('/').filter(Boolean).pop() || trimmed
}

const AUDIO_EXT =
  /\.(3ga|aac|ac3|aif|aifc|aiff|alac|amr|ape|au|caf|dff|dsf|flac|gsm|m4a|m4b|m4r|mid|midi|mka|mp2|mp3|mpga|mpc|oga|ogg|opus|pcm|ra|snd|spx|tta|voc|wav|wave|weba|wma|wv)$/i

export function isAudioFile(name: string): boolean {
  return AUDIO_EXT.test(audioBaseName(name))
}
