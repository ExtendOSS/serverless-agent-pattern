import {
  CodePipelineClient,
  ListPipelinesCommand,
  ListPipelinesCommandOutput,
  PipelineSummary,
} from '@aws-sdk/client-codepipeline'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { createTool } from '@mastra/core'
import { z } from 'zod'

const inputSchema = z.object({
  region: z
    .string()
    .optional()
    .default('us-east-1')
    .describe('AWS region to list pipelines from. Defaults to us-east-1.'),
})

export const codepipelineListPipelines = createTool({
  id: 'codepipeline_list_pipelines',
  description: `Tool for listing all AWS CodePipelines in a specified region.

WHEN TO USE:
- When a user asks "What pipelines exist?" or "Show me all pipelines."
- To get an overview of all pipelines before diving into a specific one.
- As a first step if the user mentions a pipeline but doesn't provide an exact name, to help them identify it.

FEATURES:
- Lists all pipelines in the target AWS region.
- Returns pipeline names, creation and update timestamps, and version. The pipeline ARN is not included in this summary; use 'codepipeline_get_pipeline' for a specific pipeline to get its ARN.

CHAIN WITH:
- Use before 'codepipeline_get_pipeline' or 'codepipeline_get_pipeline_state' if the user needs details about a specific pipeline from the list.

NOTES:
- This tool does not accept a pipeline name as input; it lists all pipelines.
- The output can be a list, so be prepared to handle multiple pipelines.
- IAM permissions required: 'codepipeline:ListPipelines'.`,
  inputSchema,
  execute: async ({ context }) => {
    try {
      const client: CodePipelineClient = new CodePipelineClient({
        credentials: fromNodeProviderChain({ ignoreCache: true }),
        region: context.region,
      })

      const command: ListPipelinesCommand = new ListPipelinesCommand({})
      let pipelines: PipelineSummary[] = []
      let nextToken: string | undefined

      do {
        command.input.nextToken = nextToken
        const response: ListPipelinesCommandOutput = await client.send(command)
        if (response.pipelines) {
          pipelines = pipelines.concat(response.pipelines)
        }
        nextToken = response.nextToken
      } while (nextToken)

      if (pipelines.length === 0) {
        return {
          message: `No CodePipelines found in region ${context.region}.`,
          pipelines: [],
        }
      }

      return {
        pipelines: pipelines.map((p) => ({
          name: p.name,
          created: p.created?.toISOString(),
          updated: p.updated?.toISOString(),
          version: p.version,
        })),
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'An unknown error occurred'

      throw new Error(
        JSON.stringify({
          error: {
            message: errorMessage,
            region: context.region,
            type:
              error instanceof Error ? error.constructor.name : 'UnknownError',
            originalError: error instanceof Error ? error.stack : undefined,
          },
        })
      )
    }
  },
})
