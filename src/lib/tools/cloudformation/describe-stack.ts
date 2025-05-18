import {
  CloudFormationClient,
  DescribeStacksCommand,
  Stack,
} from '@aws-sdk/client-cloudformation'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { createTool } from '@mastra/core'
import { z } from 'zod'

// Define the Zod input schema
const inputSchema = z.object({
  region: z
    .string()
    .default('us-east-1')
    .describe('AWS region to describe stacks from. Defaults to us-east-1.'),
  stackName: z.string().describe('Name or ARN of the stack to describe.'),
})

// Create and export the Mastra tool version
export const cloudformationDescribeStack = createTool({
  id: 'cloudformation_describe_stack',
  description: `Tool for retrieving detailed information about an AWS CloudFormation stack.

WHEN TO USE:
- When you need comprehensive details about a specific stack (e.g., "Tell me about the test-api stack")
- To check stack parameters, outputs, and current status
- To get information about a stack's configuration and deployment settings
- To determine if a specific stack exists and its current state
- To analyze stack outputs for use in other operations

FEATURES:
- Detailed stack information retrieval
- Comprehensive output including parameters, outputs, and tags
- Direct AWS Console URLs for easy access
- Complete metadata about stack status and configuration
- Region-specific access

CHAIN WITH:
- Use after list-stacks or find-stack to get detailed information about a specific stack
- Follow with list-stack-resources to examine what's deployed in the stack
- Use before describe-stack-events when investigating stack history and operations
- Can be used to answer questions like "What parameters does the X stack have?"

NOTES:
- Requires the exact stack name - use find-stack first if you don't have the complete name
- Returns complete stack details in a structured format
- All timestamps are in ISO 8601 format
- Includes stack-level metadata and configuration
- Console URLs are automatically generated based on stack ARN and region`,
  inputSchema,
  execute: async ({ context }) => {
    try {
      const client = new CloudFormationClient({
        credentials: fromNodeProviderChain({
          ignoreCache: true,
        }),
        region: context.region,
      })

      const command = new DescribeStacksCommand({
        StackName: context.stackName,
      })

      const response = await client.send(command)

      if (!response.Stacks || response.Stacks.length === 0) {
        throw new Error(
          JSON.stringify({
            error: {
              message: `Stack ${context.stackName} not found`,
              stackName: context.stackName,
              region: context.region,
              type: 'StackNotFoundError',
            },
          })
        )
      }

      const stack = response.Stacks[0]
      const region = context.region || 'us-east-1'

      // Format the stack information
      const formatMetadata = (stack: Stack) => {
        return {
          consoleUrl: stack.StackId
            ? `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks/stackinfo?stackId=${encodeURIComponent(stack.StackId)}`
            : null,
          id: stack.StackId || null,
          name: stack.StackName || null,
          status: stack.StackStatus || null,
          statusReason: stack.StackStatusReason || null,
        }
      }

      const formatResources = (stack: Stack) => {
        return {
          outputs: (stack.Outputs || []).map((output) => ({
            description: output.Description || null,
            exportName: output.ExportName || null,
            key: output.OutputKey || null,
            value: output.OutputValue || null,
          })),
          parameters: (stack.Parameters || []).map((param) => ({
            key: param.ParameterKey || null,
            value: param.ParameterValue || null,
          })),
          tags: (stack.Tags || []).map((tag) => ({
            key: tag.Key || null,
            value: tag.Value || null,
          })),
        }
      }

      const { outputs, parameters, tags } = formatResources(stack)
      return {
        capabilities: stack.Capabilities || [],
        creationTime: stack.CreationTime?.toISOString(),
        description: stack.Description || null,
        disableRollback: stack.DisableRollback || false,
        driftInformation: {
          lastCheckTimestamp:
            stack.DriftInformation?.LastCheckTimestamp?.toISOString() || null,
          stackDriftStatus: stack.DriftInformation?.StackDriftStatus || null,
        },
        enableTerminationProtection: stack.EnableTerminationProtection || false,
        lastUpdatedTime: stack.LastUpdatedTime?.toISOString() || null,
        metadata: formatMetadata(stack),
        outputs,
        parameters,
        roleARN: stack.RoleARN || null,
        tags,
        timeoutInMinutes: stack.TimeoutInMinutes || null,
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error occurred'

      // Try to parse the error message if it's already in JSON format
      try {
        const parsedError = JSON.parse(errorMessage) as string
        throw new Error(parsedError)
      } catch {
        // If it's not valid JSON, format it as a new error
        throw new Error(
          JSON.stringify({
            error: {
              message: errorMessage,
              stackName: context.stackName,
              region: context.region,
              type:
                error instanceof Error
                  ? error.constructor.name
                  : 'UnknownError',
            },
          })
        )
      }
    }
  },
})
