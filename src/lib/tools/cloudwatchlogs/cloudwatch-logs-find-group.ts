import {
  CloudWatchLogsClient,
  DescribeLogGroupsCommand,
  LogGroup,
} from '@aws-sdk/client-cloudwatch-logs'
import { createTool } from '@mastra/core'
import { z } from 'zod'
import Fuse from 'fuse.js' // Standard Fuse import

const client = new CloudWatchLogsClient({})

const findLogGroupInputSchema = z.object({
  logGroupNameQuery: z
    .string()
    .describe(
      'The query string to use for fuzzy finding log group names. Can be a partial name or a misspelled name.'
    ),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.6)
    .describe(
      'Fuzzy search threshold (0-1). Lower values are more lenient. Default is 0.6.'
    ),
  limit: z
    .number()
    .optional()
    .default(10)
    .describe('Maximum number of results to return. Default is 10.'),
})

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const findLogGroupOutputSchema = z.object({
  results: z
    .array(
      z.object({
        logGroupName: z.string(),
        arn: z.string(),
        score: z
          .number()
          .optional()
          .describe('Fuzzy search score (0-1, lower is better)'),
      })
    )
    .describe('A list of matching log groups.'),
})

export const cloudwatchlogsFindLogGroup = createTool({
  id: 'cloudwatchlogs_find_log_group',
  description:
    'Finds CloudWatch Log Groups by name using fuzzy search. Returns a list of matching log group names and their ARNs.',
  inputSchema: findLogGroupInputSchema,
  execute: async ({
    context,
  }: {
    context: z.infer<typeof findLogGroupInputSchema>
  }): Promise<z.infer<typeof findLogGroupOutputSchema>> => {
    const { logGroupNameQuery, threshold, limit } = context
    let logGroups: LogGroup[] = []
    let nextToken: string | undefined

    try {
      do {
        const command = new DescribeLogGroupsCommand({ nextToken })
        const response = await client.send(command)
        if (response.logGroups) {
          logGroups = logGroups.concat(response.logGroups)
        }
        nextToken = response.nextToken
      } while (nextToken)

      const activeLogGroups = logGroups.filter(
        (lg): lg is LogGroup & { logGroupName: string; arn: string } =>
          typeof lg.logGroupName === 'string' && typeof lg.arn === 'string'
      )

      const fuse = new Fuse(activeLogGroups, {
        keys: ['logGroupName'],
        includeScore: true,
        threshold,
        isCaseSensitive: false,
      })

      const searchResults = fuse.search(logGroupNameQuery)

      return {
        results: searchResults.slice(0, limit).map((result) => ({
          logGroupName: result.item.logGroupName,
          arn: result.item.arn,
          score: result.score,
        })),
      }
    } catch (error) {
      console.error('Error finding CloudWatch log groups:', error)
      return { results: [] }
    }
  },
})
