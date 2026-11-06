import { encodeToKTX2 } from 'ktx2-encoder'
import { canvasToBlob } from '../terrain/TextureAtlas'

/** Basis Universal WASM 对源图像素有约 12M 上限（4096²=16M 会失败） */
const MAX_SOURCE_TEXELS = 12 * 1024 * 1024

/** ETC1S / GPU 块压缩要求宽高为 4 的倍数，否则上传失败、看起来像没贴图 */
function alignBlock4(n: number): number {
  return Math.max(4, Math.ceil(n / 4) * 4)
}

/**
 * 限制像素总量，并把宽高对齐到 4 的倍数。
 * 例如选区贴图 146×126 → 148×128，避免 KTX2 在 GPU 上无法上传。
 */
function prepareCanvasForKtx2(source: HTMLCanvasElement): HTMLCanvasElement {
  let w = source.width
  let h = source.height
  const texels = w * h
  if (texels > MAX_SOURCE_TEXELS) {
    const scale = Math.sqrt(MAX_SOURCE_TEXELS / texels)
    w = Math.max(1, Math.floor(w * scale))
    h = Math.max(1, Math.floor(h * scale))
  }
  w = alignBlock4(w)
  h = alignBlock4(h)

  if (w === source.width && h === source.height) return source

  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, w, h)
  return out
}

/**
 * Encode canvas to KTX2 (ETC1S) for Three.js KTX2Loader.
 * Satellite albedo → ETC1S is much smaller than JPG at similar look;
 * GPU uploads faster than decoding JPG at runtime.
 */
export async function canvasToKtx2(source: HTMLCanvasElement): Promise<Uint8Array> {
  const canvas = prepareCanvasForKtx2(source)
  // PNG bytes → encoder imageDecoder (browser decodeImageBitmap)
  const pngBlob = await canvasToBlob(canvas, 'image/png')
  const pngBytes = new Uint8Array(await pngBlob.arrayBuffer())

  return encodeToKTX2(pngBytes, {
    isUASTC: false,
    // ETC1S quality 1–255；卫星影像 160 左右体积小、观感够用
    qualityLevel: 160,
    generateMipmap: true,
    isPerceptual: true,
    isSetKTX2SRGBTransferFunc: true,
    isKTX2File: true,
  })
}
