import {
  S3Client,
  ListObjectsV2Command,
  _Object,
  CommonPrefix,
  ListObjectsV2CommandInput,
  ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3'
import { createTool } from '@mastra/core'
import { z } from 'zod'

// Define the Zod input and output schemas explicitly
const toolInputSchema = z.object({
  bucketName: z.string().describe('The name of the S3 bucket.'),
  prefix: z.string().optional().describe('Optional prefix to filter objects.'),
  maxKeys: z
    .number()
    .optional()
    .default(42)
    .describe(
      'Maximum number of objects to return per API call. Defaults to 1000.'
    ),
  region: z
    .string()
    .optional()
    .describe('AWS region. If not provided, uses default from environment.'),
})

const toolOutputSchema = z.object({
  objects: z.array(
    z.object({
      key: z.string().optional(),
      lastModified: z.date().optional(),
      size: z.number().optional(),
      storageClass: z.string().optional(),
    })
  ),
  commonPrefixes: z.array(z.string()).optional(),
})

export const listObjectsInBucketTool = createTool({
  id: 'list_objects_in_bucket',
  description:
    'Lists all objects and common prefixes (folders) within a specified S3 bucket under a given prefix. Handles pagination to retrieve all items.',
  inputSchema: toolInputSchema,
  outputSchema: toolOutputSchema,
  async execute({
    context,
  }: {
    context: z.infer<typeof toolInputSchema>
  }): Promise<z.infer<typeof toolOutputSchema>> {
    console.log(
      `[listObjectsInBucketTool] EXECUTE CALLED. Context: ${JSON.stringify(context)}`
    )
    const { bucketName, prefix, maxKeys, region } = context
    const client = new S3Client({ region: region })

    const allObjects: _Object[] = []
    const allCommonPrefixes: CommonPrefix[] = []
    let continuationToken: string | undefined = undefined

    try {
      console.log(
        `[listObjectsInBucketTool] Starting to list objects for bucket ${bucketName}, prefix ${prefix || ''}. Client region: ${region}`
      )
      do {
        const commandInput: ListObjectsV2CommandInput = {
          Bucket: bucketName,
          Prefix: prefix,
          MaxKeys: maxKeys,
          ContinuationToken: continuationToken,
        }
        const command: ListObjectsV2Command = new ListObjectsV2Command(
          commandInput
        )
        console.log(
          `[listObjectsInBucketTool] Sending ListObjectsV2Command. ContinuationToken: ${continuationToken}`
        )
        const response: ListObjectsV2CommandOutput = await client.send(command)

        if (response.Contents) {
          allObjects.push(...response.Contents)
        }
        if (response.CommonPrefixes) {
          allCommonPrefixes.push(...response.CommonPrefixes)
        }

        continuationToken = response.NextContinuationToken
        console.log(
          `[listObjectsInBucketTool] Page received. Objects on page: ${response.Contents?.length || 0}. NextContinuationToken: ${continuationToken}`
        )
      } while (continuationToken)

      console.log(
        `[listObjectsInBucketTool] Pagination complete. Total objects fetched: ${allObjects.length}, Total common prefixes: ${allCommonPrefixes.length}`
      )

      const objectsForOutput = allObjects.map((obj) => ({
        key: obj.Key,
        lastModified: obj.LastModified,
        size: obj.Size,
        storageClass: obj.StorageClass,
      }))

      const commonPrefixesForOutput = allCommonPrefixes
        .map((cp) => cp.Prefix || '')
        .filter((p) => p)

      return {
        objects: objectsForOutput,
        commonPrefixes: commonPrefixesForOutput,
      }
    } catch (error: unknown) {
      const typedError = error as Error
      let errorMessage =
        typedError.message ||
        `An unknown error occurred while listing objects in bucket ${bucketName}`
      // Ensure bucketName is part of the message if not already from SDK error
      if (!errorMessage.includes(bucketName)) {
        errorMessage = `Error for bucket ${bucketName}: ${errorMessage}`
      }
      console.error(
        `[listObjectsInBucketTool] ERROR (Client region: ${region}, Bucket: ${bucketName}, Prefix: ${prefix || ''}): ${errorMessage}`,
        error
      )
      throw new Error(
        JSON.stringify({
          error: {
            message: errorMessage,
            bucketName: bucketName,
            prefix: prefix,
            region: region,
            type: typedError.constructor?.name || 'UnknownError',
            tool: 'list_objects_in_bucket',
          },
        })
      )
    }
  },
})
