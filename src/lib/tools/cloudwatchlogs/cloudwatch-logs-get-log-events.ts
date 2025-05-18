import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
  FilteredLogEvent,
} from '@aws-sdk/client-cloudwatch-logs'
import { createTool } from '@mastra/core'
import { z } from 'zod'

const client = new CloudWatchLogsClient({})

const getLogEventsInputSchema = z.object({
  logGroupName: z.string().describe('The name of the log group.'),
  limit: z
    .number()
    .optional()
    .default(50)
    .describe(
      'The maximum number of log events to return. Default is 50. Max is 10000.'
    ),
  startTime: z
    .number()
    .describe(
      'The start of the time range, expressed as the number of milliseconds after Jan 1, 1970 00:00:00 UTC. Events with a timestamp earlier than this time are not returned. Use the get_date_offset tool to calculate a date offset from the current time.'
    ),
  endTime: z
    .number()
    .optional()
    .describe(
      'The end of the time range, expressed as the number of milliseconds after Jan 1, 1970 00:00:00 UTC. Events with a timestamp later than this time are not returned.'
    )
    .default(Date.now()),
  filterPattern: z
    .string()
    .optional()
    .describe('A filter pattern to apply to the log events.'),
})

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const getLogEventsOutputSchema = z.object({
  events: z
    .array(
      z.object({
        timestamp: z.number().optional(),
        message: z.string().optional(),
        ingestionTime: z.number().optional(),
        eventId: z.string().optional(),
        logStreamName: z.string().optional(),
      })
    )
    .describe('A list of log events.'),
  nextForwardToken: z
    .string()
    .optional()
    .describe('Token for the next set of events in chronological order.'),
  nextBackwardToken: z
    .string()
    .optional()
    .describe(
      'Token for the previous set of events in reverse chronological order.'
    ),
})

export const cloudwatchlogsGetLogEvents = createTool({
  id: 'cloudwatchlogs_get_log_events',
  description:
    'Retrieves recent log events from a specified CloudWatch Log Group.',
  inputSchema: getLogEventsInputSchema,
  execute: async ({
    context,
  }: {
    context: z.infer<typeof getLogEventsInputSchema>
  }): Promise<z.infer<typeof getLogEventsOutputSchema>> => {
    const { logGroupName, limit, startTime, endTime, filterPattern } = context

    try {
      const command = new FilterLogEventsCommand({
        logGroupName,
        limit,
        startTime,
        endTime,
        filterPattern,
        interleaved: true, // Returns events from all log streams interleaved, simplifying recent log retrieval
      })
      const response = await client.send(command)

      const events = (response.events || []).map((event: FilteredLogEvent) => ({
        timestamp: event.timestamp,
        message: event.message,
        ingestionTime: event.ingestionTime,
        eventId: event.eventId,
        logStreamName: event.logStreamName,
      }))

      return {
        events,
        nextForwardToken: response.nextToken, // FilterLogEvents uses nextToken for both directions if interleaved
      }
    } catch (error) {
      console.error('Error getting CloudWatch log events:', error)
      // Consider how to surface this error to the agent/user
      return { events: [] }
    }
  },
})
