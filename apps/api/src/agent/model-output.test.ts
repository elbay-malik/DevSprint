import { describe, expect, it } from 'vitest'
import { compactIssueListForModel, MODEL_ISSUE_LIST_CHARS } from './model-output'
import { createLocalWorkspaceApi, createWorkspaceStore } from '../workspace/store'

const LONGEST_TITLE = 'x'.repeat(200)
const LONGEST_LABELS = Array.from({ length: 10 }, (_, i) => `${i}${'y'.repeat(39)}`)

/** The largest row a real board can hold: the longest value of every field. */
function worstRow(n: number, title = LONGEST_TITLE, labels = LONGEST_LABELS) {
  return {
    key: `DS-${n}`,
    title,
    status: 'in_progress',
    priority: 'critical',
    points: 13,
    assigneeId: 'user-1',
    sprintId: 'sprint-12',
    labels,
  }
}

function listOf(count: number, row: (n: number) => unknown = worstRow) {
  return {
    ok: true,
    data: { issues: Array.from({ length: count }, (_, n) => row(n + 1)) },
  }
}

function modelSees(output: unknown) {
  const result = compactIssueListForModel({ output })
  if (result.type !== 'json') throw new Error(`expected json, got ${result.type}`)
  return result.value as unknown as {
    ok: boolean
    data: { issues: Array<ReturnType<typeof worstRow>>; truncated?: boolean }
  }
}

describe('compactIssueListForModel', () => {
  it('passes the seed board through unchanged, so nothing shifts for an ordinary board', async () => {
    const workspace = createLocalWorkspaceApi(createWorkspaceStore())
    for (const output of [
      await workspace.listIssues({ limit: 200 }),
      await workspace.searchIssues({ query: 'billing', limit: 200 }),
    ]) {
      expect(compactIssueListForModel({ output })).toEqual({ type: 'json', value: output })
    }
  })

  it('leaves a list just under the limit alone, and clips one just over it', () => {
    const under = listOf(1, () => ({
      key: 'DS-1',
      title: 'x'.repeat(MODEL_ISSUE_LIST_CHARS - 100),
    }))
    expect(modelSees(under)).toEqual(under)

    const over = listOf(1, () => ({ key: 'DS-1', title: 'x'.repeat(MODEL_ISSUE_LIST_CHARS + 100) }))
    expect(modelSees(over).data.truncated).toBe(true)
  })

  it('clips titles and labels first, and keeps every other field of every issue', () => {
    const output = listOf(25)
    expect(JSON.stringify(output).length).toBeGreaterThan(MODEL_ISSUE_LIST_CHARS)

    const seen = modelSees(output)
    expect(seen.ok).toBe(true)
    expect(seen.data.truncated).toBe(true)
    expect(seen.data.issues).toHaveLength(25)
    expect(seen.data.issues[24]).toEqual({
      ...worstRow(25),
      title: `${'x'.repeat(80)}…`,
      labels: LONGEST_LABELS.slice(0, 3),
    })
    expect(JSON.stringify(seen).length).toBeLessThanOrEqual(MODEL_ISSUE_LIST_CHARS)
  })

  it('fits the fullest board the workspace can hold, however the text escapes', () => {
    // 13 seed issues + 40 created (ADR-0024), every title made of a character
    // that JSON doubles. The 30 KB this starts from is the point of the bound.
    const escapes = '"'.repeat(200)
    const output = listOf(53, (n) =>
      worstRow(
        n,
        escapes,
        LONGEST_LABELS.map(() => '"'.repeat(40)),
      ),
    )
    expect(JSON.stringify(output).length).toBeGreaterThan(30_000)

    const seen = modelSees(output)
    expect(JSON.stringify(seen).length).toBeLessThanOrEqual(MODEL_ISSUE_LIST_CHARS)
    // The keys are what the model acts on, so none may go.
    expect(seen.data.issues.map((issue) => issue.key)).toEqual(
      Array.from({ length: 53 }, (_, n) => `DS-${n + 1}`),
    )
    expect(seen.data.issues[0]?.labels).toEqual([])
  })

  it('compacts search matches too, which have no labels', () => {
    const output = {
      ok: true,
      data: {
        matches: Array.from({ length: 53 }, (_, n) => ({
          key: `DS-${n + 1}`,
          title: LONGEST_TITLE,
          status: 'todo',
          score: 1,
        })),
      },
    }
    const seen = compactIssueListForModel({ output }).value as {
      data: { matches: Array<{ title: string; score: number }>; truncated: boolean }
    }
    expect(seen.data.truncated).toBe(true)
    expect(seen.data.matches[0]).toMatchObject({ title: `${'x'.repeat(80)}…`, score: 1 })
    expect(seen.data).not.toHaveProperty('issues')
  })

  it('does not change the object the cards read', () => {
    const output = listOf(53)
    const before = JSON.stringify(output)
    compactIssueListForModel({ output })
    expect(JSON.stringify(output)).toBe(before)
  })

  it('does not leave half a surrogate pair where it cuts', () => {
    // An emoji straddles the cut at both steps' lengths, 40 and 80.
    const title = `${'x'.repeat(39)}${'\u{1F600}'.repeat(60)}`
    for (const count of [25, 53]) {
      const seen = JSON.stringify(modelSees(listOf(count, (n) => worstRow(n, title))))
      expect(seen).toContain('"truncated":true')
      // JSON keeps a whole emoji literal and writes a lone half as an escape.
      expect(seen).not.toContain('\\ud83d')
    }
  })

  it('takes whatever a client put in its history without throwing', () => {
    expect(compactIssueListForModel({ output: undefined })).toEqual({ type: 'json', value: null })
    expect(compactIssueListForModel({ output: 'plain' })).toEqual({ type: 'text', value: 'plain' })

    const big = 'z'.repeat(MODEL_ISSUE_LIST_CHARS + 1)
    for (const output of [
      { ok: false, error: { code: 'INTERNAL', message: big } },
      { ok: true, data: big },
      { ok: true, data: { other: big } },
      [big],
    ]) {
      expect(compactIssueListForModel({ output })).toEqual({ type: 'json', value: output })
    }

    const odd = { ok: true, data: { issues: [big, null, 7, { title: 7, labels: big }] } }
    expect(modelSees(odd).data.issues).toEqual([big, null, 7, { title: 7, labels: big }])
    expect(modelSees(odd).data.truncated).toBe(true)
  })
})
