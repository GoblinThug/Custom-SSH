function videoBaseName(name: string): string {
  const trimmed = name.trim().replace(/\\/g, '/')
  return trimmed.split('/').filter(Boolean).pop() || trimmed
}

const VIDEO_EXT =
  /\.(3g2|3gp|amv|asf|avi|bik|divx|dv|f4v|flv|hevc|m2p|m2ts|m2v|m4v|mkv|mod|mov|mp2v|mp4|mpe|mpeg|mpg|mts|mxf|nsv|ogv|qt|rm|rmvb|tod|ts|vob|webm|wmv|xvid|yuv)$/i

export function isVideoFile(name: string): boolean {
  return VIDEO_EXT.test(videoBaseName(name))
}
