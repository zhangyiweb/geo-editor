import { test, expect } from '@playwright/test'
import {
  getStatus,
  setFastTerrainSettings,
  waitForStatus,
} from './helpers'

test.describe('面积、生成与导出', () => {
  test('应用目标面积更新状态与瓦片预估', async ({ page }) => {
    await page.goto('/')

    await page.locator('#target-area').fill('5')
    await page.getByRole('button', { name: '应用' }).click()

    await expect(page.locator('#status')).toContainText(/已将主区域设为约 5/)
    await expect(page.locator('#map-stats-tiles')).toContainText(/5(\.\d+)?\s*km/)
  })

  test('Mapbox 源无 Token 时阻止生成', async ({ page }) => {
    await page.goto('/')
    await setFastTerrainSettings(page)

    await page.locator('#provider').selectOption('mapbox')
    await page.getByRole('button', { name: '生成地形' }).click()

    await expect(page.locator('#status')).toHaveText('该贴图源需要 Mapbox Token')
    await expect(page.getByRole('button', { name: '导出' })).toBeDisabled()
  })

  test('生成地形后启用导出并打开格式弹窗', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/')

    // 缩小选区 + 降低精度，减少瓦片请求
    await page.locator('#target-area').fill('3')
    await page.getByRole('button', { name: '应用' }).click()
    await setFastTerrainSettings(page)
    await page.locator('#provider').selectOption('esri')

    await page.getByRole('button', { name: '生成地形' }).click()

    await waitForStatus(page, /完成 · 高程|生成失败|拉取/, 90_000)
    await expect
      .poll(async () => getStatus(page), { timeout: 90_000 })
      .toMatch(/完成 · 高程/)

    await expect(page.getByRole('button', { name: '导出' })).toBeEnabled()

    await page.getByRole('button', { name: '导出' }).click()
    const dialog = page.locator('#export-dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: '选择导出' })).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: /GLB 一体/ }),
    ).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: /GLB 几何 \+ KTX2/ }),
    ).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: /STL 网格/ }),
    ).toBeVisible()
    await expect(
      dialog.getByRole('button', { name: /仅贴图/ }),
    ).toBeVisible()

    await dialog.getByRole('button', { name: '关闭' }).click()
    await expect(dialog).toBeHidden()
  })
})
