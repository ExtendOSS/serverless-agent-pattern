import { S3Client, GetBucketLocationCommand } from '@aws-sdk/client-s3'
import { createTool } from '@mastra/core'
import { z } from 'zod'

const toolInputSchema = z.object({
  bucketName: z.string().describe('The name of the S3 bucket.'),
  region: z
    .string()
    .optional()
    .describe(
      'AWS region of the S3 client. If not provided, uses default from environment.'
    ),
})

const toolOutputSchema = z.object({
  locationConstraint: z
    .string()
    .optional()
    .describe(
      "The region where the bucket is located. For 'us-east-1', this can be null or undefined."
    ),
})

export const getBucketLocationTool = createTool({
  id: 'get_bucket_location',
  description:
    'Gets the AWS Region where a S3 bucket is located. The S3 client will be configured for the specified region or the default environment region.',
  inputSchema: toolInputSchema,
  outputSchema: toolOutputSchema,
  async execute({
    context,
  }: {
    context: z.infer<typeof toolInputSchema>
  }): Promise<z.infer<typeof toolOutputSchema>> {
    const { bucketName, region } = context
    console.log(
      `[getBucketLocationTool] EXECUTE CALLED. Context: ${JSON.stringify(context)}`
    )
    const client = new S3Client({ region: region })
    try {
      console.log(
        `[getBucketLocationTool] Attempting GetBucketLocation for ${bucketName}. Client region: ${region}`
      )
      const command = new GetBucketLocationCommand({
        Bucket: bucketName,
      })
      const response = await client.send(command)
      console.log(
        `[getBucketLocationTool] GetBucketLocation successful for ${bucketName}. LocationConstraint: ${response.LocationConstraint}`
      )
      return { locationConstraint: response.LocationConstraint }
    } catch (error: unknown) {
      const typedError = error as Error
      let errorMessage =
        typedError.message ||
        `An unknown error occurred while getting location for bucket ${bucketName}`
      if (!errorMessage.includes(bucketName)) {
        errorMessage = `Error for bucket ${bucketName}: ${errorMessage}`
      }
      console.error(
        `[getBucketLocationTool] ERROR (Client region: ${region}, Bucket: ${bucketName}): ${errorMessage}`,
        error
      )
      throw new Error(
        JSON.stringify({
          error: {
            message: errorMessage,
            bucketName: bucketName,
            region: region,
            type: typedError.constructor?.name || 'UnknownError',
            tool: 'get_bucket_location',
          },
        })
      )
    }
  },
})
