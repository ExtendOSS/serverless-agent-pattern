import { DynamoDBClient, ListTablesCommand } from '@aws-sdk/client-dynamodb'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import Fuse from 'fuse.js'
import { z } from 'zod'
import { createTool } from '@mastra/core'

const inputSchema = z.object({
  query: z
    .string()
    .describe('The search query to find DynamoDB tables by name'),
  region: z.string().default('us-east-1').describe('AWS region to search in'),
  threshold: z
    .number()
    .default(0.6)
    .describe('Fuzzy search threshold (0.0 to 1.0, lower is stricter)'),
  limit: z.number().default(5).describe('Maximum number of results to return'),
})

type InputType = z.infer<typeof inputSchema>

export const dynamodbFindTable = createTool({
  id: 'dynamodb_find_table',
  description: `Tool for finding AWS DynamoDB tables using fuzzy name matching.

WHEN TO USE:
- When you need to find a DynamoDB table but only have a partial or misspelled name
- When a user refers to a table without using its exact name (e.g., "Show me the items in the user table")
- As an entry point before using other DynamoDB tools if the table name is ambiguous

FEATURES:
- Advanced fuzzy searching to find tables by partial or inexact names
- Relevance ranking to return best matches first
- Returns detailed match information including confidence scores

CHAIN WITH:
- Use this first when table name is unclear, then pass the found table name to other DynamoDB tools
- Results can be directly passed to describe-table to get full table details

NOTES:
- Higher confidence scores (closer to 100) indicate better matches
- Returns multiple candidates if the search is ambiguous
- The 'tableName' field in the top result can be directly used with other DynamoDB tools
- Adjust 'threshold' parameter (0.0 to 1.0) to control search sensitivity (lower is stricter)`,
  inputSchema,
  execute: async ({ context }: { context: InputType }) => {
    try {
      const client = new DynamoDBClient({
        credentials: fromNodeProviderChain({
          ignoreCache: true,
        }),
        region: context.region,
      })

      const getAllTables = async (): Promise<string[]> => {
        const allTables: string[] = []
        let lastEvaluatedTableName: string | undefined

        do {
          const command = new ListTablesCommand({
            ExclusiveStartTableName: lastEvaluatedTableName,
          })
          const response = await client.send(command)

          if (response.TableNames) {
            allTables.push(...response.TableNames)
          }
          lastEvaluatedTableName = response.LastEvaluatedTableName
        } while (lastEvaluatedTableName)

        return allTables
      }

      const allTables = await getAllTables()

      if (allTables.length === 0) {
        return {
          found: false,
          message: `No DynamoDB tables found in region ${context.region}.`,
          matches: [],
        }
      }

      const tablesForSearch = allTables.map((tableName) => ({
        tableName: tableName,
      }))

      const fuseOptions = {
        includeScore: true,
        threshold: context.threshold,
        keys: ['tableName'],
      }

      const fuse = new Fuse(tablesForSearch, fuseOptions)
      const searchResults = fuse.search(context.query)

      const topMatches = searchResults.slice(0, context.limit).map((result) => {
        const score = result.score ?? 1 // Default score to 1 (no match) if undefined
        const confidence = Math.round((1 - score) * 100)
        return {
          tableName: result.item.tableName,
          confidence,
        }
      })

      const bestMatch = topMatches.length > 0 ? topMatches[0] : null

      return {
        found: topMatches.length > 0,
        query: context.query,
        bestMatch,
        matches: topMatches,
        totalTablesSearched: allTables.length,
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'An unknown error occurred'
      throw new Error(
        JSON.stringify({
          error: {
            message: errorMessage,
            region: context.region,
            query: context.query,
            type:
              error instanceof Error ? error.constructor.name : 'UnknownError',
          },
        })
      )
    }
  },
})
