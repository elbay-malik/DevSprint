import { describe, expect, it } from 'vitest'
import { buttonVariants } from '.'

describe('buttonVariants', () => {
  it('sets the 28px size on the 12px Label step, not shadcn’s off-scale 0.8rem', () => {
    // 12.8px sat between Caption and Body; DESIGN.md has no such step.
    const sm = buttonVariants({ size: 'sm' })
    expect(sm).toContain('h-7')
    expect(sm).toContain('text-xs')
    expect(sm).not.toContain('0.8rem')
  })
})
