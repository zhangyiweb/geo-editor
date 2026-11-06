import type { Page } from '@playwright/test'

/** 降低 DEM / 贴图精度，加快生成与网络请求。 */
export async function setFastTerrainSettings(page: Page): Promise<void> {
  await page.evaluate(() => {
    const setRange = (id: string, value: string) => {
      const el = document.querySelector(`#${id}`) as HTMLInputElement | null
      if (!el) return
      el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }
    setRange('dem-zoom', '10')
    setRange('tex-zoom', '12')
    setRange('max-edge', '64')
  })
}

export async function waitForStatus(
  page: Page,
  pattern: RegExp,
  timeout = 60_000,
): Promise<void> {
  await page.waitForFunction(
    (reSource) => {
      const text = document.querySelector('#status')?.textContent ?? ''
      return new RegExp(reSource).test(text)
    },
    pattern.source,
    { timeout },
  )
}

export async function getStatus(page: Page): Promise<string> {
  return (await page.locator('#status').textContent())?.trim() ?? ''
}
