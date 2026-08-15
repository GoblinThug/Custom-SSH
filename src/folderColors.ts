export const FOLDER_COLORS = [
  { id: 'blue', label: 'Blue', value: '#0a84ff' },
  { id: 'green', label: 'Green', value: '#30d158' },
  { id: 'orange', label: 'Orange', value: '#ff9f0a' },
  { id: 'red', label: 'Red', value: '#ff453a' },
  { id: 'purple', label: 'Purple', value: '#bf5af2' },
  { id: 'teal', label: 'Teal', value: '#64d2ff' },
  { id: 'pink', label: 'Pink', value: '#ff375f' },
  { id: 'gray', label: 'Gray', value: '#8e8e93' },
] as const

export type FolderColorId = (typeof FOLDER_COLORS)[number]['id']

export function folderColorValue(id: FolderColorId | string | undefined): string {
  return FOLDER_COLORS.find((item) => item.id === id)?.value ?? FOLDER_COLORS[0].value
}
