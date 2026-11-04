import { readFile } from 'node:fs/promises'
import { dialog, nativeImage, type BrowserWindow } from 'electron'
import { UserError } from './repo'

const SIZE = 512
const MAX_FILE_BYTES = 25 * 1024 * 1024

/**
 * Crops to a centred square, shrinks to 512×512 and re-encodes as JPEG.
 * Re-encoding also guarantees that whatever is stored really is an image.
 */
export function toStudentJpeg(input: Buffer): Buffer {
  const img = nativeImage.createFromBuffer(input)
  if (img.isEmpty()) throw new UserError('That file is not a photo Little Hands can read. Please choose a JPEG or PNG.')
  const { width, height } = img.getSize()
  const side = Math.min(width, height)
  const square = img.crop({ x: Math.floor((width - side) / 2), y: Math.floor((height - side) / 2), width: side, height: side })
  const sized = side > SIZE ? square.resize({ width: SIZE, height: SIZE, quality: 'best' }) : square
  return sized.toJPEG(85)
}

export function jpegFromDataUrl(dataUrl: string): Buffer {
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!m) throw new UserError('The photo could not be read. Please choose it again.')
  return toStudentJpeg(Buffer.from(m[1]!, 'base64'))
}

export const toDataUrl = (jpeg: Buffer) => `data:image/jpeg;base64,${jpeg.toString('base64')}`

/** Opens the file picker. Returns the prepared JPEG, or null if the owner cancelled. */
export async function pickPhoto(win: BrowserWindow | null): Promise<Buffer | null> {
  const options = {
    title: 'Choose a photo',
    properties: ['openFile' as const],
    filters: [{ name: 'Photos', extensions: ['jpg', 'jpeg', 'png'] }]
  }
  const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
  const file = res.filePaths[0]
  if (res.canceled || !file) return null
  const data = await readFile(file)
  if (data.length > MAX_FILE_BYTES) throw new UserError('That photo is too large. Please choose one under 25 MB.')
  return toStudentJpeg(data)
}
