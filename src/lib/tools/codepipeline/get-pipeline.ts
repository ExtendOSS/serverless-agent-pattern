import {
  CodePipelineClient,
  GetPipelineCommand,
  GetPipelineCommandOutput,
} from '@aws-sdk/client-codepipeline'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { createTool } from '@mastra/core'
import { z } from 'zod'

const inputSchema = z.object({
  name: z.string().describe('The name of the pipeline to retrieve.'),
  region: z
    .string()
    .optional()
    .default('us-east-1')
    .describe('AWS region where the pipeline exists. Defaults to us-east-1.'),
})

export const codepipelineGetPipeline = createTool({
  id: 'codepipeline_get_pipeline',
  description: `Tool for retrieving the detailed structure of a specific AWS CodePipeline.

WHEN TO USE:
- When a user asks for details about a specific pipeline, e.g., "Describe the 'my-app-pipeline'."
- To understand the stages and actions configured within a pipeline.
- After identifying a pipeline with 'codepipeline_list_pipelines', to get its full configuration.

FEATURES:
- Fetches the complete pipeline structure including stages, actions, and their configurations.
- Provides metadata about the pipeline.

CHAIN WITH:
- Use after 'codepipeline_list_pipelines' if the exact pipeline name is not known.
- Follow with 'codepipeline_get_pipeline_state' to get the current status of this pipeline.

NOTES:
- Requires the exact pipeline name.
- IAM permissions required: 'codepipeline:GetPipeline'.`,
  inputSchema,
  execute: async ({ context }) => {
    try {
      const client: CodePipelineClient = new CodePipelineClient({
        credentials: fromNodeProviderChain({ ignoreCache: true }),
        region: context.region,
      })

      const command: GetPipelineCommand = new GetPipelineCommand({
        name: context.name,
      })

      const response: GetPipelineCommandOutput = await client.send(command)

      if (!response.pipeline) {
        throw new Error(
          JSON.stringify({
            error: {
              message: `Pipeline '${context.name}' not found in region '${context.region}'.`,
              pipelineName: context.name,
              region: context.region,
              type: 'PipelineNotFoundError',
            },
          })
        )
      }

      return {
        pipeline: {
          name: response.pipeline.name,
          roleArn: response.pipeline.roleArn,
          artifactStore: response.pipeline.artifactStore,
          artifactStores: response.pipeline.artifactStores,
          stages: response.pipeline.stages,
          version: response.pipeline.version,
          triggers: response.pipeline.triggers,
          executionMode: response.pipeline.executionMode,
        },
        metadata: response.metadata
          ? {
              arn: response.metadata.pipelineArn,
              created: response.metadata.created?.toISOString(),
              updated: response.metadata.updated?.toISOString(),
              pollingDisabledAt:
                response.metadata.pollingDisabledAt?.toISOString(),
            }
          : undefined,
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'An unknown error occurred'

      // Attempt to parse if error.message is already a JSON string from a previous structured error
      try {
        // Provide a type for the expected structure of a parsed error from other tools
        const parsedError = JSON.parse(errorMessage) as {
          error?: { message?: string; type?: string }
        }
        if (
          parsedError.error &&
          parsedError.error.type === 'PipelineNotFoundError'
        ) {
          throw error // Re-throw the original structured error
        }
      } catch /* _e */ {
        // Error variable not used, can be omitted or prefixed with _
        // Not a JSON string or not the specific error we want to re-throw, proceed to wrap
      }

      throw new Error(
        JSON.stringify({
          error: {
            message: errorMessage,
            pipelineName: context.name,
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
