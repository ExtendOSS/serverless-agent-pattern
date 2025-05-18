import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3'
import { createTool } from '@mastra/core'
import { z } from 'zod'

const toolInputSchema = z.object({
  region: z
    .string()
    .optional()
    .describe('AWS region. If not provided, uses default from environment.'),
})
const toolOutputSchema = z.object({
  buckets: z.array(
    z.object({
      name: z.string().optional(),
      creationDate: z.date().optional(),
    })
  ),
})

export const listBucketsTool = createTool({
  id: 'list_buckets',
  description: 'Lists all S3 buckets in the account.',
  inputSchema: toolInputSchema,
  outputSchema: toolOutputSchema,
  async execute({
    context,
  }: {
    context: z.infer<typeof toolInputSchema>
  }): Promise<z.infer<typeof toolOutputSchema>> {
    console.log(
      `[listBucketsTool] EXECUTE CALLED. Context region: ${context.region}, Full context: ${JSON.stringify(context)}`
    )
    const { region } = context
    const client = new S3Client({ region: region })
    try {
      console.log(
        `[listBucketsTool] Attempting to send ListBucketsCommand. Client region: ${region}`
      )
      const command = new ListBucketsCommand({})
      const response = await client.send(command)
      console.log('[listBucketsTool] ListBucketsCommand successful.')
      const buckets =
        response.Buckets?.map((bucket) => ({
          name: bucket.Name,
          creationDate: bucket.CreationDate,
        })) || []
      return { buckets }
    } catch (error: unknown) {
      const typedError = error as Error
      const errorMessage =
        typedError.message ||
        'An unknown error occurred while listing S3 buckets'
      console.error(
        `[listBucketsTool] ERROR (Client region: ${region}): ${errorMessage}`,
        error
      )
      throw new Error(
        JSON.stringify({
          error: {
            message: errorMessage,
            region: region,
            type: typedError.constructor?.name || 'UnknownError',
            tool: 'list_buckets',
          },
        })
      )
    }
  },
})
