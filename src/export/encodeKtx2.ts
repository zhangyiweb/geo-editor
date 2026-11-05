import { encodeToKTX2 } from 'ktx2-encoder'
import { canvasToBlob } from '../terrain/TextureAtlas'

/** Basis Universal WASM 对源图像素有约 12M 上限（4096²=16M 会失败） */
const MAX_SOURCE_TEXELS = 12 * 1024 * 1024

function scaleCanvasToTexelLimit(source: HTMLCanvasElement): HTMLCanvasElement {
  const texels = source.width * source.height
  if (texels <= MAX_SOURCE_TEXELS) return source
  const scale = Math.sqrt(MAX_SOURCE_TEXELS / texels)
  const w = Math.max(1, Math.floor(source.width * scale))
  const h = Math.max(1, Math.floor(source.height * scale))
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
  const canvas = scaleCanvasToTexelLimit(source)
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
