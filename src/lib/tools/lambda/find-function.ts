import {
  LambdaClient,
  ListFunctionsCommand,
  FunctionConfiguration,
  ListFunctionsCommandOutput,
} from '@aws-sdk/client-lambda'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { createTool } from '@mastra/core'
import Fuse, { IFuseOptions } from 'fuse.js'
import { z } from 'zod'

const inputSchema = z.object({
  query: z
    .string()
    .describe('Search query to fuzzy match against Lambda function names'),
  region: z
    .string()
    .optional()
    .default('us-east-1')
    .describe('AWS region to search functions in. Defaults to us-east-1.'),
  limit: z
    .number()
    .min(1)
    .optional()
    .default(10)
    .describe(
      'Maximum number of functions to return in search results. Defaults to 10.'
    ),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.6)
    .describe(
      'Search precision (0-1). Lower values mean more precise matches (less fuzzy). Defaults to 0.6.'
    ),
})

const functionMatchSchema = z.object({
  functionName: z.string(),
  functionArn: z.string(),
  runtime: z.string().optional(),
  lastModified: z.string().optional(),
  description: z.string().optional(),
  confidence: z.number().describe('Search confidence score (0-100)'),
})

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const outputSchema = z.object({
  found: z.boolean().describe('Whether any matching functions were found'),
  query: z.string().describe('The original search query'),
  bestMatch: functionMatchSchema
    .nullable()
    .describe('The best matching function, or null if none found'),
  matches: z
    .array(functionMatchSchema)
    .describe('A list of matching Lambda functions, ranked by relevance'),
  totalFunctionsSearched: z
    .number()
    .describe('Total number of functions scanned in the region'),
  message: z
    .string()
    .optional()
    .describe('Optional message, e.g., for errors or no results'),
})

export const lambdaFindFunction = createTool({
  id: 'lambda_find_function',
  description: `Tool for finding AWS Lambda functions using fuzzy name matching.

WHEN TO USE:
- When you need to find a Lambda function but only have a partial or misspelled name.
- As an entry point before using other Lambda-specific tools if the function name is ambiguous.

FEATURES:
- Advanced fuzzy searching to find functions by partial or inexact names.
- Relevance ranking to return best matches first.
- Returns detailed match information including confidence scores and basic metadata.

CHAIN WITH:
- Use this first when function name is unclear, then pass the found 'functionName' or 'functionArn' to other tools that require a specific Lambda identifier.

NOTES:
- Higher confidence scores (closer to 100) indicate better matches.
- Adjust 'threshold' parameter (0.0 to 1.0) to control search sensitivity (lower is stricter).`,
  inputSchema,
  execute: async ({
    context,
  }: {
    context: z.infer<typeof inputSchema>
  }): Promise<z.infer<typeof outputSchema>> => {
    try {
      const client = new LambdaClient({
        credentials: fromNodeProviderChain({
          ignoreCache: true,
        }),
        region: context.region,
      })

      const getAllFunctions = async (): Promise<FunctionConfiguration[]> => {
        const allFunctions: FunctionConfiguration[] = []
        let marker: string | undefined

        do {
          const command = new ListFunctionsCommand({ Marker: marker })
          const response: ListFunctionsCommandOutput =
            await client.send(command)

          if (response.Functions) {
            allFunctions.push(...response.Functions)
          }
          marker = response.NextMarker
        } while (marker)

        return allFunctions
      }

      const allFunctions = await getAllFunctions()

      if (allFunctions.length === 0) {
        return {
          found: false,
          query: context.query,
          bestMatch: null,
          matches: [],
          totalFunctionsSearched: 0,
          message: `No Lambda functions found in region ${context.region}.`,
        }
      }

      const functionsForSearch = allFunctions
        .filter(
          (
            fn
          ): fn is FunctionConfiguration & {
            FunctionName: string
            FunctionArn: string
          } =>
            typeof fn.FunctionName === 'string' &&
            typeof fn.FunctionArn === 'string'
        )
        .map((fn) => ({
          functionName: fn.FunctionName,
          functionArn: fn.FunctionArn,
          runtime: fn.Runtime,
          lastModified: fn.LastModified,
          description: fn.Description,
        }))

      const fuseOptions: IFuseOptions<(typeof functionsForSearch)[0]> = {
        includeScore: true,
        threshold: context.threshold ?? 0.6,
        keys: ['functionName', 'description'], // Also search in description
      }

      const fuse = new Fuse(functionsForSearch, fuseOptions)
      const searchResults = fuse.search(context.query)

      const topMatches = searchResults
        .slice(0, context.limit ?? 10)
        .map((result) => {
          const score = result.score ?? 1 // Default score to 1 (no match) if undefined
          const confidence = Math.round((1 - score) * 100)
          return {
            functionName: result.item.functionName,
            functionArn: result.item.functionArn,
            runtime: result.item.runtime,
            lastModified: result.item.lastModified,
            description: result.item.description,
            confidence,
          }
        })

      const bestMatch = topMatches.length > 0 ? topMatches[0] : null

      return {
        found: topMatches.length > 0,
        query: context.query,
        bestMatch,
        matches: topMatches,
        totalFunctionsSearched: allFunctions.length,
        message:
          topMatches.length > 0
            ? undefined
            : 'No matching functions found for the query.',
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'An unknown error occurred while finding Lambda functions'
      console.error(`Error in lambda_find_function: ${errorMessage}`, error)
      // It's good practice to throw an error that can be caught by the agent/caller
      // or return a structured error response within the output schema.
      // For consistency with other tools, we'll throw a structured error.
      throw new Error(
        JSON.stringify({
          error: {
            message: errorMessage,
            region: context.region,
            query: context.query,
            type:
              error instanceof Error ? error.constructor.name : 'UnknownError',
            tool: 'lambda_find_function',
          },
        })
      )
    }
  },
})
