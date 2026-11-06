import { test, expect } from '@playwright/test'
import { getStatus, waitForStatus } from './helpers'

test.describe('定位与搜索', () => {
  test('经纬度定位更新状态', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: '经纬度查询' }).click()
    await page.locator('#lat').fill('31.8206')
    await page.locator('#lng').fill('117.2272')
    await page.getByRole('button', { name: '定位' }).click()

    await waitForStatus(page, /已定位|定位中/)
    // 最终应落到「已定位」或保持有效坐标相关提示
    await expect
      .poll(async () => getStatus(page), { timeout: 20_000 })
      .toMatch(/已定位/)
  })

  test('无效经纬度给出提示', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: '经纬度查询' }).click()
    await page.locator('#lat').fill('999')
    await page.locator('#lng').fill('117')
    await page.getByRole('button', { name: '定位' }).click()

    await expect(page.locator('#status')).toHaveText(
      /纬度需在|请输入有效/,
    )
  })

  test('地名搜索列出结果并可选用', async ({ page }) => {
    await page.goto('/')

    await page.locator('#query').fill('黄山')
    await page.getByRole('button', { name: '搜索' }).click()

    await waitForStatus(page, /找到 \d+ 条结果/)
    const results = page.locator('#search-results li')
    await expect(results.first()).toBeVisible()
    await expect(results).not.toHaveCount(0)

    await results.first().click()
    await expect
      .poll(async () => getStatus(page), { timeout: 15_000 })
      .toMatch(/已定位/)
  })
})
