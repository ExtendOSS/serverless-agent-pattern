import {
  CodePipelineClient,
  GetPipelineStateCommand,
  GetPipelineStateCommandOutput,
} from '@aws-sdk/client-codepipeline'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { createTool } from '@mastra/core'
import { z } from 'zod'

const inputSchema = z.object({
  name: z.string().describe('The name of the pipeline to get the state for.'),
  region: z
    .string()
    .optional()
    .default('us-east-1')
    .describe('AWS region where the pipeline exists. Defaults to us-east-1.'),
})

export const codepipelineGetPipelineState = createTool({
  id: 'codepipeline_get_pipeline_state',
  description: `Tool for retrieving the current state of each stage and action within a specific AWS CodePipeline.

WHEN TO USE:
- When a user asks about the current status of a pipeline, e.g., "What's the status of 'my-app-pipeline'?" or "Is 'my-app-pipeline' running?"
- To check the latest execution details of each action in a pipeline.
- After getting pipeline structure with 'codepipeline_get_pipeline', to understand its current operational state.

FEATURES:
- Provides the status of each stage (e.g., InProgress, Succeeded, Failed).
- Details the state of each action within stages, including last status change, execution ID, and summary.

CHAIN WITH:
- Use after 'codepipeline_get_pipeline' for a comprehensive view (structure + state).
- Can be followed by 'codepipeline_list_action_executions' for a specific action if more historical detail is needed.

NOTES:
- Requires the exact pipeline name.
- IAM permissions required: 'codepipeline:GetPipelineState'.`,
  inputSchema,
  execute: async ({ context }) => {
    try {
      const client: CodePipelineClient = new CodePipelineClient({
        credentials: fromNodeProviderChain({ ignoreCache: true }),
        region: context.region,
      })

      const command: GetPipelineStateCommand = new GetPipelineStateCommand({
        name: context.name,
      })

      const response: GetPipelineStateCommandOutput = await client.send(command)

      // The response directly contains the pipeline state information.
      // We can simplify the output slightly for better readability by the LLM.
      return {
        pipelineName: response.pipelineName,
        pipelineVersion: response.pipelineVersion,
        stageStates: response.stageStates?.map((stage) => ({
          stageName: stage.stageName,
          inboundTransitionState: stage.inboundTransitionState,
          actionStates: stage.actionStates?.map((action) => ({
            actionName: action.actionName,
            currentRevision: action.currentRevision,
            latestExecution: action.latestExecution,
            entityUrl: action.entityUrl,
          })),
          latestExecution: stage.latestExecution, // Include stage-level latest execution
        })),
        created: response.created?.toISOString(), // Add top-level created/updated if available and useful
        updated: response.updated?.toISOString(),
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'An unknown error occurred'

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
