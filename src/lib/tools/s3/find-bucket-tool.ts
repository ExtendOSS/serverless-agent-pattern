import { S3Client, ListBucketsCommand, Bucket } from '@aws-sdk/client-s3'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { createTool } from '@mastra/core'
import Fuse, { IFuseOptions } from 'fuse.js'
import { z } from 'zod'

const inputSchema = z.object({
  query: z
    .string()
    .describe('Search query to fuzzy match against S3 bucket names'),
  region: z
    .string()
    .optional()
    .default('us-east-1')
    .describe(
      'AWS region for the S3 client. ListBuckets is global, but client is regional.'
    ),
  limit: z
    .number()
    .min(1)
    .optional()
    .default(5)
    .describe('Maximum number of buckets to return. Defaults to 5.'),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.6)
    .describe(
      'Search precision (0-1). Lower is more precise. Defaults to 0.6.'
    ),
})

const bucketMatchSchema = z.object({
  bucketName: z.string(),
  creationDate: z.string().optional(), // Dates from SDK are Date objects, will convert to ISO string
  confidence: z.number().describe('Search confidence score (0-100)'),
})

const outputSchema = z.object({
  found: z.boolean().describe('Whether any matching buckets were found'),
  query: z.string().describe('The original search query'),
  bestMatch: bucketMatchSchema
    .nullable()
    .describe('The best matching bucket, or null if none found'),
  matches: z
    .array(bucketMatchSchema)
    .describe('A list of matching S3 buckets, ranked by relevance'),
  totalBucketsSearched: z
    .number()
    .describe('Total number of buckets scanned in the account'),
  message: z
    .string()
    .optional()
    .describe('Optional message, e.g., for errors or no results'),
})

export const findBucketTool = createTool({
  id: 's3_find_bucket',
  description: `Tool for finding AWS S3 buckets using fuzzy name matching. Lists all buckets and then filters them based on the query.

WHEN TO USE:
- When you need to find an S3 bucket but only have a partial or misspelled name.
- As an entry point before using other S3 tools like list_objects_in_bucket or get_bucket_location if the bucket name is ambiguous.

FEATURES:
- Fuzzy searching for bucket names.
- Relevance ranking and confidence scores.

NOTES:
- Higher confidence scores indicate better matches.
- Adjust 'threshold' to control search sensitivity.`,
  inputSchema,
  outputSchema,
  async execute({
    context,
  }: {
    context: z.infer<typeof inputSchema>
  }): Promise<z.infer<typeof outputSchema>> {
    console.log(
      `[findBucketTool] EXECUTE CALLED. Context: ${JSON.stringify(context)}`
    )
    const { query, region, limit, threshold } = context

    try {
      const client = new S3Client({
        credentials: fromNodeProviderChain({ ignoreCache: true }), // Added credentials for consistency
        region: region,
      })

      // ListAllMyBuckets is generally expected to return all buckets.
      // The SDK might handle pagination internally up to service limits.
      // For extreme numbers of buckets, explicit pagination (if supported by ListBucketsCommand output) would be more robust.
      console.log(
        `[findBucketTool] Attempting to send ListBucketsCommand. Client region: ${region}`
      )
      const listBucketsCommand = new ListBucketsCommand({})
      const listBucketsResponse = await client.send(listBucketsCommand)
      console.log('[findBucketTool] ListBucketsCommand successful.')

      const allBuckets = listBucketsResponse.Buckets || []

      if (allBuckets.length === 0) {
        return {
          found: false,
          query: query,
          bestMatch: null,
          matches: [],
          totalBucketsSearched: 0,
          message: 'No S3 buckets found in the account.',
        }
      }

      const bucketsForSearch = allBuckets
        .filter(
          (b): b is Bucket & { Name: string } => typeof b.Name === 'string'
        )
        .map((bucket) => ({
          bucketName: bucket.Name,
          creationDate: bucket.CreationDate?.toISOString(),
        }))

      const fuseOptions: IFuseOptions<(typeof bucketsForSearch)[0]> = {
        includeScore: true,
        threshold: threshold ?? 0.6,
        keys: ['bucketName'],
      }

      const fuse = new Fuse(bucketsForSearch, fuseOptions)
      const searchResults = fuse.search(query)

      const topMatches = searchResults.slice(0, limit ?? 5).map((result) => {
        const score = result.score ?? 1
        const confidence = Math.round((1 - score) * 100)
        return {
          bucketName: result.item.bucketName,
          creationDate: result.item.creationDate,
          confidence,
        }
      })

      const bestMatch = topMatches.length > 0 ? topMatches[0] : null

      return {
        found: topMatches.length > 0,
        query: query,
        bestMatch,
        matches: topMatches,
        totalBucketsSearched: allBuckets.length,
        message:
          topMatches.length > 0
            ? undefined
            : 'No matching buckets found for the query.',
      }
    } catch (error: unknown) {
      const typedError = error as Error
      const errorMessage =
        typedError.message ||
        'An unknown error occurred while finding S3 buckets'
      console.error(
        `[findBucketTool] ERROR (Client region: ${region}, Query: ${query}): ${errorMessage}`,
        error
      )
      throw new Error(
        JSON.stringify({
          error: {
            message: errorMessage,
            region: region,
            query: query,
            type: typedError.constructor?.name || 'UnknownError',
            tool: 's3_find_bucket',
          },
        })
      )
    }
  },
})
