import {
  CloudFormationClient,
  ListStackResourcesCommand,
  StackResourceSummary,
} from '@aws-sdk/client-cloudformation'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { createTool } from '@mastra/core'
import { z } from 'zod'

// Define the Zod input schema
const inputSchema = z.object({
  limit: z
    .number()
    .min(1)
    .default(100)
    .describe(
      'Maximum number of resources to fetch from CloudFormation. Resource type filtering may result in fewer resources being returned.'
    ),
  region: z
    .string()
    .default('us-east-1')
    .describe('AWS region to list resources from. Defaults to us-east-1.'),
  resourceType: z
    .string()
    .optional()
    .describe(
      'Filter resources by resource type (e.g., AWS::S3::Bucket, AWS::Lambda::Function).'
    ),
  stackName: z
    .string()
    .describe('Name or ARN of the stack to list resources for.'),
})

// Create and export the Mastra tool version
export const cloudformationListStackResources = createTool({
  id: 'cloudformation_list_stack_resources',
  description: `Tool for retrieving and analyzing AWS CloudFormation stack resources.

WHEN TO USE:
- When you need to list all resources deployed in a specific stack (e.g., "What resources are in the test-api stack?")
- To find specific resource types within a stack (e.g., "Show me all the S3 buckets in the stack")
- To check the status and deployment information of stack resources
- To audit what infrastructure has been deployed by CloudFormation
- To diagnose deployment issues by checking resource status

FEATURES:
- Complete resource listing with detailed information
- Filtering by resource type (AWS::S3::Bucket, AWS::Lambda::Function, etc.)
- Pagination support for large stacks
- Region-specific access
- Direct links to AWS console for each resource

CHAIN WITH:
- Use after find-stack or list-stacks to examine resources in a specific stack
- Use after describe-stack to see what resources implement a stack's functionality
- Follow with describe-stack-events to investigate issues with specific resources
- Can be used to answer questions like "What Lambda functions are in the X stack?"

NOTES:
- Requires the exact stack name - use find-stack first if you have only a partial name
- All resources in the stack are retrieved before applying filters
- Includes detailed status and timestamp information
- Resource information includes logical and physical IDs and type
- Particularly useful for answering "what's in this stack?" type questions`,
  inputSchema,
  execute: async ({ context }) => {
    try {
      const client = new CloudFormationClient({
        credentials: fromNodeProviderChain({
          ignoreCache: true,
        }),
        region: context.region,
      })

      // Function to format resource information
      const formatResourceInfo = (
        resource: StackResourceSummary
      ): Record<string, unknown> => {
        return {
          driftInformation: resource.DriftInformation || {},
          lastUpdatedTime: resource.LastUpdatedTimestamp?.toISOString() || null,
          logicalResourceId: resource.LogicalResourceId,
          physicalResourceId: resource.PhysicalResourceId || null,
          resourceStatus: resource.ResourceStatus,
          resourceStatusReason: resource.ResourceStatusReason || null,
          resourceType: resource.ResourceType,
        }
      }

      // Generate Console URL
      const generateConsoleUrl = (): string => {
        return `https://${context.region}.console.aws.amazon.com/cloudformation/home?region=${context.region}#/stacks/resources?stackId=${encodeURIComponent(context.stackName || '')}`
      }

      // Function to get all resources with pagination
      const getAllResources = async (): Promise<StackResourceSummary[]> => {
        const allResources: StackResourceSummary[] = []
        let nextToken: string | undefined
        const limit = context.limit || 100 // Ensure we respect the limit even if schema default doesn't apply

        // Calculate how many resources to fetch if we're filtering
        // We'll need more than 'limit' if we're going to filter them afterward
        const fetchLimit = context.resourceType
          ? limit * 3 // Fetch 3x the limit if we're filtering, as a buffer
          : limit // Otherwise just use the limit directly

        do {
          const command = new ListStackResourcesCommand({
            NextToken: nextToken,
            StackName: context.stackName,
          })
          const response = await client.send(command)

          if (response.StackResourceSummaries) {
            allResources.push(...response.StackResourceSummaries)

            // Check if we have enough resources based on whether we're filtering
            if (allResources.length >= fetchLimit) {
              break
            }
          }

          nextToken = response.NextToken
        } while (nextToken)

        return allResources
      }

      const allResources = await getAllResources()

      if (allResources.length === 0) {
        return {
          consoleUrl: generateConsoleUrl(),
          message: 'No resources found in the specified stack.',
          resources: [],
        }
      }

      let filteredResources = allResources

      // Apply resource type filter if specified
      if (context.resourceType) {
        filteredResources = filteredResources.filter(
          (resource) => resource.ResourceType === context.resourceType
        )
      }

      // Apply the limit to the filtered resources
      if (context.limit && filteredResources.length > context.limit) {
        filteredResources = filteredResources.slice(0, context.limit)
      }

      // Format the results
      const formattedResources = filteredResources.map((resource) =>
        formatResourceInfo(resource)
      )

      return {
        consoleUrl: generateConsoleUrl(),
        filteredResources: filteredResources.length,
        resources: formattedResources,
        totalResources: allResources.length,
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred'

      throw new Error(
        JSON.stringify({
          error: {
            message: errorMessage,
            stackName: context.stackName,
            region: context.region,
            type:
              error instanceof Error ? error.constructor.name : 'UnknownError',
            filters: {
              resourceType: context.resourceType || null,
              limit: context.limit || null,
            },
            validationPhase: 'list_resources',
          },
        })
      )
    }
  },
})
