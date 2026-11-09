// Money is kept as whole paise (₹1 = 100 paise) everywhere; never as a floating-point number.

/** 150000 → "₹1,500"; 150050 → "₹1,500.50"; negative amounts get a real minus sign. */
export function formatRupees(paise: number): string {
  const abs = Math.abs(paise)
  const rupees = Math.floor(abs / 100)
  const rest = abs % 100
  const s = '₹' + rupees.toLocaleString('en-IN') + (rest ? '.' + String(rest).padStart(2, '0') : '')
  return paise < 0 ? '−' + s : s
}

/** What the owner typed ("1500", "1,500", "₹ 1500.5") → paise, or null if it isn't an amount. */
export function parseRupees(input: string): number | null {
  const t = input.replace(/[\s,₹]/g, '')
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(t)
  if (!m) return null
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
}

/** Paise → the text to put back in an input box: 150000 → "1500", 150050 → "1500.50". */
export function rupeesInput(paise: number): string {
  const rest = paise % 100
  return String(Math.floor(paise / 100)) + (rest ? '.' + String(rest).padStart(2, '0') : '')
}
