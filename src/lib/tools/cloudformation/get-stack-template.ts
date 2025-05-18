import {
  CloudFormationClient,
  GetTemplateCommand,
  GetTemplateCommandInput,
  GetTemplateCommandOutput,
} from '@aws-sdk/client-cloudformation'
import { z } from 'zod'
import { createTool } from '@mastra/core'

const inputSchema = z.object({
  stackName: z
    .string()
    .min(1)
    .describe('The name or unique stack ID of the CloudFormation stack.'),
  region: z
    .string()
    .optional()
    .describe(
      'The AWS region where the stack is located. Defaults to the configured region if not specified.'
    ),
})

export const getStackTemplateTool = createTool({
  id: 'cloudformation_get_stack_template',
  description:
    'Retrieves the template for a specified CloudFormation stack. You can specify the template stage to get the original, processed, or provisioned template.',
  inputSchema,
  async execute({ context }) {
    const { stackName, region: regionFromInput } = context

    const effectiveRegion = regionFromInput || process.env.AWS_REGION

    if (!stackName) {
      throw new Error(
        JSON.stringify({
          error: {
            message: 'Stack name is required.',
            type: 'InputValidationError',
          },
        })
      )
    }

    if (!effectiveRegion) {
      throw new Error(
        JSON.stringify({
          error: {
            message:
              "AWS region is not configured. Please specify the region in the input or ensure it's set in the environment.",
            type: 'ConfigurationError',
          },
        })
      )
    }

    const client = new CloudFormationClient({ region: effectiveRegion })

    const params: GetTemplateCommandInput = {
      StackName: stackName,
    }

    try {
      const response: GetTemplateCommandOutput = await client.send(
        new GetTemplateCommand(params)
      )
      if (response.TemplateBody) {
        return { templateBody: response.TemplateBody }
      }
      throw new Error(
        JSON.stringify({
          error: {
            message:
              'Successfully retrieved stack information, but the template body was unexpectedly empty.',
            stackName,
            region: effectiveRegion,
            type: 'EmptyTemplateBodyError',
          },
        })
      )
    } catch (err) {
      let errorMessage = 'Unknown error retrieving CloudFormation template.'
      let errorType = 'CloudFormationToolError'
      const errorDetails: { stack?: string; [key: string]: unknown } = {}

      if (err instanceof Error) {
        errorMessage = err.message
        errorType = err.name
        if (err.stack) {
          errorDetails.stack = err.stack
        }
      }

      console.error(
        `Error in getCloudFormationStackTemplate for ${stackName} in ${effectiveRegion}:`,
        err
      )

      if (
        errorType === 'ValidationError' &&
        errorMessage.includes('does not exist')
      ) {
        throw new Error(
          JSON.stringify({
            error: {
              message: `Stack with name or ID '${stackName}' not found in region ${effectiveRegion}.`,
              stackName,
              region: effectiveRegion,
              type: 'StackNotFoundError',
            },
          })
        )
      }
      if (
        errorType === 'CredentialsProviderError' ||
        errorMessage.includes('Failed to get credentials')
      ) {
        throw new Error(
          JSON.stringify({
            error: {
              message: `Failed to get AWS credentials: ${errorMessage}. Ensure credentials are configured correctly or the environment.`,
              type: 'CredentialsError',
            },
          })
        )
      }

      throw new Error(
        JSON.stringify({
          error: {
            message: errorMessage,
            originalErrorType: errorType,
            details: errorDetails,
            stackName,
            region: effectiveRegion,
            type: 'GenericToolError',
          },
        })
      )
    }
  },
})
