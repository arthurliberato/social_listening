/** Split text into searchable lowercase tokens (letters and digits, any script). */
export function tokens(s: string): string[] {
  return s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}
