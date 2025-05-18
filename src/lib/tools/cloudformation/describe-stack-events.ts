import {
  CloudFormationClient,
  DescribeStackEventsCommand,
  StackEvent,
} from '@aws-sdk/client-cloudformation'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { createTool } from '@mastra/core'
import { z } from 'zod'

// Define the Zod input schema
const inputSchema = z.object({
  limit: z
    .number()
    .min(1)
    .default(50)
    .describe(
      'Maximum number of stack events to return. Applied after filtering'
    ),
  region: z
    .string()
    .default('us-east-1')
    .describe('AWS region to fetch events from. Defaults to us-east-1.'),
  resourceType: z
    .string()
    .optional()
    .describe('Filter events by AWS resource type (e.g., "AWS::S3::Bucket")'),
  stackName: z
    .string()
    .describe(
      'Name of the CloudFormation stack to retrieve events for (required)'
    ),
  status: z
    .string()
    .optional()
    .describe(
      'Filter events by status (e.g., "CREATE_COMPLETE", "UPDATE_FAILED")'
    ),
})

// Create and export the Mastra scoped tool version
export const cloudformationDescribeStackEvents = createTool({
  id: 'cloudformation_describe_stack_events',
  description: `Tool for retrieving and analyzing AWS CloudFormation stack events.

WHEN TO USE:
- When you need to investigate what happened with a stack (e.g., "What happened with the serverless agent pattern stack?")
- To troubleshoot failed or problematic stack operations
- To audit the history of changes to a stack over time
- To monitor the progress of ongoing stack operations
- To track creation, updates, and deletion of specific resources

FEATURES:
- Detailed chronological event information
- Filtering by resource type (e.g., only show events for Lambda functions)
- Filtering by event status (e.g., only show failure events)
- Automatic pagination for comprehensive history
- Reverse chronological ordering (newest events first)

CHAIN WITH:
- Use after find-stack or list-stacks to investigate history of a specific stack
- Use after describe-stack to understand changes to a stack's configuration
- Use after list-stack-resources to investigate issues with specific resources
- Particularly useful for answering questions like "Why did stack X fail?" or "What changed recently in stack Y?"

NOTES:
- Requires the exact stack name - use find-stack first if you have only a partial name
- Results are sorted in reverse chronological order (newest first)
- The output includes resource IDs, types, statuses, timestamps, and reasons
- Events show the complete lifecycle of resources and stacks
- Most useful tool for diagnosing "what happened?" questions about stacks`,
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

      // Function to get all events with pagination
      const getAllEvents = async (): Promise<StackEvent[]> => {
        const allEvents: StackEvent[] = []
        let nextToken: string | undefined
        const limit = args.limit || 100 // Ensure we respect the limit even if schema default doesn't apply

        // Calculate how many events to fetch if we're filtering
        // We'll need more than 'limit' if we're going to filter them afterward
        const fetchLimit =
          args.resourceType || args.status
            ? limit * 3 // Fetch 3x the limit if we're filtering, as a buffer
            : limit // Otherwise just use the limit directly

        do {
          const command = new DescribeStackEventsCommand({
            NextToken: nextToken,
            StackName: args.stackName,
          })
          const response = await client.send(command)

          if (response.StackEvents) {
            allEvents.push(...response.StackEvents)

            // Check if we have enough events based on whether we're filtering
            if (allEvents.length >= fetchLimit) {
              break
            }
          }

          nextToken = response.NextToken
        } while (nextToken)

        return allEvents
      }

      // Function to format event
      const formatEvent = (
        event: StackEvent
      ): Record<string, string | undefined> => {
        return {
          eventId: event.EventId,
          logicalResourceId: event.LogicalResourceId,
          physicalResourceId: event.PhysicalResourceId,
          resourceProperties: event.ResourceProperties,
          resourceStatus: event.ResourceStatus,
          resourceStatusReason: event.ResourceStatusReason || 'N/A',
          resourceType: event.ResourceType,
          stackId: event.StackId,
          stackName: event.StackName,
          timestamp: event.Timestamp?.toISOString(),
        }
      }

      // Get all events with automatic pagination
      const allEvents = await getAllEvents()

      if (allEvents.length === 0) {
        return {
          message: 'No stack events found.',
          events: [],
        }
      }

      // Sort events in reverse chronological order (newest first)
      let events = allEvents.sort((a, b) => {
        const dateA = a.Timestamp?.getTime() || 0
        const dateB = b.Timestamp?.getTime() || 0
        return dateB - dateA
      })

      // Apply resource type filter if specified
      if (args.resourceType) {
        events = events.filter(
          (event) => event.ResourceType === args.resourceType
        )
      }

      // Apply status filter if specified
      if (args.status) {
        events = events.filter((event) => event.ResourceStatus === args.status)
      }

      // Always apply limit to the filtered events, even if not specified
      const limit = args.limit || 100
      if (events.length > limit) {
        events = events.slice(0, limit)
      }

      // Format the events for better readability
      const formattedEvents = events.map(formatEvent)

      return {
        events: formattedEvents,
        totalEvents: allEvents.length,
        filteredEvents: events.length,
        stack: args.stackName,
        filters: {
          resourceType: args.resourceType || null,
          status: args.status || null,
          limit: args.limit || null,
        },
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred'

      throw new Error(
        JSON.stringify({
          error: {
            message: errorMessage,
            stackName: args.stackName,
            region: args.region,
            type:
              error instanceof Error ? error.constructor.name : 'UnknownError',
            validationPhase: 'describe_stack_events',
          },
        })
      )
    }
  },
})
