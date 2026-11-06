import { test, expect } from '@playwright/test'

test.describe('页面与面板冒烟', () => {
  test('首屏加载：标题、默认选区、导出禁用', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveTitle(/地理编辑器/)
    await expect(page.getByRole('heading', { name: '地理编辑器' })).toBeVisible()
    await expect(page.getByRole('button', { name: '生成地形' })).toBeVisible()
    await expect(page.getByRole('button', { name: '导出' })).toBeDisabled()
    await expect(page.locator('#status')).toHaveText('就绪')

    // 默认黄山附近主区域 + 瓦片预估
    await expect(page.locator('#map-stats-tiles')).toContainText('瓦片预估')
    await expect(page.locator('#map-stats-tiles')).toContainText('km²')
    await expect(page.locator('#map2d')).toBeVisible()
    await expect(page.locator('#view3d')).toBeVisible()
  })

  test('查询方式切换：地名 / 经纬度', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: '经纬度查询' }).click()
    await expect(page.getByRole('button', { name: '定位' })).toBeVisible()
    await expect(page.locator('#lat')).toBeVisible()
    await expect(page.locator('#lng')).toBeVisible()
    await expect(page.locator('#place-fields')).toBeHidden()

    await page.getByRole('button', { name: '地名查询' }).click()
    await expect(page.getByRole('button', { name: '搜索' })).toBeVisible()
    await expect(page.locator('#query')).toBeVisible()
    await expect(page.locator('#coords-fields')).toBeHidden()
  })

  test('框选模式与形状切换', async ({ page }) => {
    await page.goto('/')

    await page.getByRole('button', { name: '局部精度' }).click()
    await expect(page.locator('#precision-section-label')).toHaveText(
      '局部精度参数',
    )
    await expect(page.locator('#area-label')).toHaveText('局部精度面积')
    await expect(page.locator('#patch-precision-fields')).toBeVisible()
    await expect(page.locator('#main-precision-fields')).toBeHidden()

    await page.getByRole('button', { name: '圆形' }).click()
    await expect(page.locator('#area-square-btn')).toHaveText('正圆')

    await page.getByRole('button', { name: '主区域' }).click()
    await page.getByRole('button', { name: '矩形' }).click()
    await expect(page.locator('#precision-section-label')).toHaveText(
      '主区域参数',
    )
    await expect(page.locator('#area-square-btn')).toHaveText('正方形')
  })

  test('三维小窗可收起与展开', async ({ page }) => {
    await page.goto('/')

    const viewPane = page.locator('#view-pane')
    await expect(viewPane).not.toHaveClass(/is-collapsed/)

    await page.getByRole('button', { name: '收起三维预览' }).click()
    await expect(viewPane).toHaveClass(/is-collapsed/)

    await page.getByRole('button', { name: '展开三维预览' }).click()
    await expect(viewPane).not.toHaveClass(/is-collapsed/)
  })
})
