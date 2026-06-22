export function formatLocalTime(utcStr: string): string {
  const d = new Date(utcStr.endsWith('Z') ? utcStr : utcStr + 'Z')
  if (isNaN(d.getTime())) return utcStr
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
