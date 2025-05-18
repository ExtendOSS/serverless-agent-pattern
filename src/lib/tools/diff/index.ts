import { createTool } from '@mastra/core'
import { z } from 'zod'
import * as Diff from 'diff'

const diffInputSchema = z.object({
  text1: z.string().describe('The first text to compare.'),
  text2: z.string().describe('The second text to compare.'),
})

const diffOutputSchema = z.object({
  differences: z
    .array(
      z.object({
        value: z.string(),
        added: z.boolean().optional(),
        removed: z.boolean().optional(),
        count: z.number().optional(), // Made count optional as not all diff parts might have it directly from diffLines
      })
    )
    .describe(
      "An array of objects representing the differences. Each object has a 'value' (the differing text), 'added' or 'removed' boolean flags, and 'count' of lines/characters."
    ),
})

export const diffTool = createTool({
  id: 'text_diff', // Changed to snake_case for consistency with other tool IDs
  description:
    'Calculates and shows the differences between two texts. Useful for comparing versions of documents, code, or any textual content.',
  inputSchema: diffInputSchema,
  outputSchema: diffOutputSchema,
  async execute({
    context,
  }: {
    context: z.infer<typeof diffInputSchema>
  }): Promise<z.infer<typeof diffOutputSchema>> {
    const diffResult = Diff.diffLines(context.text1, context.text2)
    // The diffLines function from 'diff' package returns an array of Change objects.
    // Each Change object has 'value', 'added' (optional), 'removed' (optional), and 'count' (optional).
    // We need to ensure the returned structure matches our diffOutputSchema.
    const differences = diffResult.map((part) => ({
      value: part.value,
      added: part.added,
      removed: part.removed,
      count: part.count,
    }))
    return Promise.resolve({ differences })
  },
})
