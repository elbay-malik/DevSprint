/**
 * Reads .github/workflows/ci.yml as text, by its indentation. It holds no side
 * effects, so ci-local.ts can use it and the tests can import it.
 */

/** One job's block: everything under its two-space key, up to the next one. */
export function jobBlock(workflow: string, job: string): string {
  const block = new RegExp(`^  ${job}:\\n([\\s\\S]*?)(?=^  \\S|(?![\\s\\S]))`, 'm').exec(
    workflow,
  )?.[1]
  if (!block) throw new Error(`ci.yml has no '${job}' job`)
  return block
}

/** The single-line `- run:` steps of one job, in order. */
export function jobSteps(workflow: string, job: string): string[] {
  const block = jobBlock(workflow, job)
  if (/^\s+(- )?run: [|>]/m.test(block)) {
    throw new Error(`ci.yml's '${job}' job has a multi-line run step; ci-local cannot mirror it`)
  }
  return [...block.matchAll(/^\s+- run: (.+)$/gm)].map((match) => (match[1] ?? '').trim())
}
