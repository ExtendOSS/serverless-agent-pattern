import {
  CloudFormationClient,
  ListStacksCommand,
  StackStatus,
  StackSummary,
} from '@aws-sdk/client-cloudformation'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { createTool } from '@mastra/core'
import Fuse from 'fuse.js'
import { z } from 'zod'

// Define the Zod input schema
const inputSchema = z.object({
  query: z.string().describe('Search query to fuzzy match against stack names'),
  region: z
    .string()
    .default('us-east-1')
    .describe('AWS region to search stacks in. Defaults to us-east-1.'),
  status: z
    .enum(Object.values(StackStatus) as [string, ...string[]])
    .optional()
    .describe('Filter stacks by status. Default includes all active stacks'),
  limit: z
    .number()
    .min(1)
    .default(5)
    .describe('Maximum number of stacks to return in search results'),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .default(0.6)
    .describe('Search precision (0-1). Lower means more precise matches.'),
})

// Create and export the Mastra tool version
export const cloudformationFindStack = createTool({
  id: 'cloudformation_find_stack',
  description: `Tool for finding CloudFormation stacks using fuzzy name matching.

WHEN TO USE:
- When you need to find a CloudFormation stack but only have a partial name
- When a user refers to a stack without using its exact name (e.g., "What happened with the poc mastra stack?")
- As an entry point before using other CloudFormation tools when stack name is ambiguous
- To identify the best matching stack before using describe-stack, list-stack-resources, or describe-stack-events

FEATURES:
- Advanced fuzzy searching algorithm to find stacks by partial names
- Handles typos and misspellings in stack names
- Supports different word orders (e.g., "mastra poc" vs "poc mastra")
- Relevance ranking to return best matches first
- Supports filtering by stack status
- Returns detailed match information including confidence scores

CHAIN WITH:
- Use this first when stack name is unclear, then pass the found stackName to other tools
- Results can be directly passed to describe-stack to get full stack details
- Results can be passed to list-stack-resources to examine resources in the stack
- Results can be passed to describe-stack-events to investigate stack operations

NOTES:
- Higher confidence scores indicate better matches
- Returns multiple candidates when the search is ambiguous
- The 'stackName' field in the top result can be directly used with other CloudFormation tools
- Adjust threshold parameter to control search precision (lower = more precise)`,
  inputSchema,
  execute: async ({ context }) => {
    const args = context
    try {
      const client = new CloudFormationClient({
        credentials: fromNodeProviderChain({
          ignoreCache: true,
        }),
        region: args.region,
      })

      // Function to get all stacks with pagination
      const getAllStacks = async (): Promise<StackSummary[]> => {
        const allStacks: StackSummary[] = []
        let nextToken: string | undefined

        do {
          const command = new ListStacksCommand({
            NextToken: nextToken,
            StackStatusFilter: args?.status
              ? [args.status as StackStatus]
              : [
                  StackStatus.CREATE_COMPLETE,
                  StackStatus.CREATE_IN_PROGRESS,
                  StackStatus.UPDATE_COMPLETE,
                  StackStatus.UPDATE_IN_PROGRESS,
                  StackStatus.UPDATE_COMPLETE_CLEANUP_IN_PROGRESS,
                  StackStatus.REVIEW_IN_PROGRESS,
                  StackStatus.IMPORT_COMPLETE,
                  StackStatus.IMPORT_IN_PROGRESS,
                ],
          })
          const response = await client.send(command)

          if (response.StackSummaries) {
            allStacks.push(...response.StackSummaries)
          }

          nextToken = response.NextToken
        } while (nextToken)

        return allStacks
      }

      const allStacks = await getAllStacks()

      if (allStacks.length === 0) {
        return {
          found: false,
          message: 'No stacks found in the specified region.',
          matches: [],
        }
      }

      // Prepare stack data for fuzzy search
      const stacksForSearch = allStacks.map((stack) => ({
        stackName: stack.StackName || '',
        status: stack.StackStatus,
        creationTime: stack.CreationTime?.toISOString(),
        lastUpdatedTime: stack.LastUpdatedTime?.toISOString(),
        // Add original stack reference
        original: stack,
      }))

      // Configure Fuse.js options
      const fuseOptions = {
        includeScore: true, // Include score in results
        threshold: args.threshold, // Default threshold for a good match
        keys: ['stackName'], // Search in the stackName field
      }

      // Create a new Fuse instance
      const fuse = new Fuse(stacksForSearch, fuseOptions)

      // Perform the fuzzy search
      const searchResults = fuse.search(args.query)

      // Map search results to our return format
      const topMatches = searchResults.slice(0, args.limit).map((result) => {
        const match = result.item
        // Convert Fuse score (0-1 where 0 is perfect) to confidence percentage (0-100 where 100 is perfect)
        const score = result.score || 0
        const confidence = Math.round((1 - score) * 100)

        return {
          stackName: match.stackName,
          confidence,
          status: match.status,
          creationTime: match.creationTime,
          lastUpdatedTime: match.lastUpdatedTime || null,
        }
      })

      const bestMatch = topMatches.length > 0 ? topMatches[0] : null

      return {
        found: topMatches.length > 0,
        query: args.query,
        bestMatch,
        matches: topMatches,
        totalStacks: allStacks.length,
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred'

      throw new Error(
        JSON.stringify({
          error: {
            message: errorMessage,
            region: args.region,
            query: args.query,
            type:
              error instanceof Error ? error.constructor.name : 'UnknownError',
            validationPhase: 'find_stack',
          },
        })
      )
    }
  },
})
