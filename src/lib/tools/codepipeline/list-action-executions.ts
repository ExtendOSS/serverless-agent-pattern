import {
  CodePipelineClient,
  ListActionExecutionsCommand,
  ListActionExecutionsCommandOutput,
  ActionExecutionDetail,
} from '@aws-sdk/client-codepipeline'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { createTool } from '@mastra/core'
import { z } from 'zod'

const inputSchema = z.object({
  pipelineName: z.string().describe('The name of the pipeline.'),
  stageNameFilter: z
    .string()
    .optional()
    .describe('Optional: Filter executions by this stage name.'),
  actionNameFilter: z
    .string()
    .optional()
    .describe('Optional: Filter executions by this action name.'),
  region: z
    .string()
    .optional()
    .default('us-east-1')
    .describe('AWS region where the pipeline exists. Defaults to us-east-1.'),
  maxResults: z
    .number()
    .optional()
    .describe(
      'Maximum number of results to return after filtering. Defaults to 10, max 100.'
    ),
})

export const codepipelineListActionExecutions = createTool({
  id: 'codepipeline_list_action_executions',
  description: `Tool for listing historical executions for actions within an AWS CodePipeline. Can be filtered locally by stage and action name.

WHEN TO USE:
- When a user wants to see the history of actions, e.g., "Show me runs of the Deploy action in Prod stage of my-app-pipeline".
- To investigate action failures by looking at past attempts.
- To get details like start/end times and status of previous action executions.

FEATURES:
- Lists action executions for a given pipeline.
- Can be filtered locally by stage name and action name (provide these in stageNameFilter and actionNameFilter).
- Provides details for each execution including status, times, input/output artifacts, and execution ID.

CHAIN WITH:
- Typically used after 'codepipeline_get_pipeline_state' for more historical detail on specific actions.

NOTES:
- Requires pipelineName. stageNameFilter and actionNameFilter are applied after fetching all actions for the pipeline.
- IAM permissions required: 'codepipeline:ListActionExecutions'.`,
  inputSchema,
  execute: async ({ context }) => {
    try {
      const client: CodePipelineClient = new CodePipelineClient({
        credentials: fromNodeProviderChain({ ignoreCache: true }),
        region: context.region,
      })

      const command: ListActionExecutionsCommand =
        new ListActionExecutionsCommand({
          pipelineName: context.pipelineName,
          maxResults: 100,
        })

      let allActionExecutionDetails: ActionExecutionDetail[] = []
      let nextToken: string | undefined

      do {
        command.input.nextToken = nextToken
        const response: ListActionExecutionsCommandOutput =
          await client.send(command)
        if (response.actionExecutionDetails) {
          allActionExecutionDetails = allActionExecutionDetails.concat(
            response.actionExecutionDetails
          )
        }
        nextToken = response.nextToken
      } while (nextToken && allActionExecutionDetails.length < 100)

      let filteredDetails = allActionExecutionDetails
      if (context.stageNameFilter) {
        filteredDetails = filteredDetails.filter(
          (d) => d.stageName === context.stageNameFilter
        )
      }
      if (context.actionNameFilter) {
        filteredDetails = filteredDetails.filter(
          (d) => d.actionName === context.actionNameFilter
        )
      }

      const maxResults = context.maxResults || 10
      if (filteredDetails.length > maxResults) {
        filteredDetails = filteredDetails.slice(0, maxResults)
      }

      if (filteredDetails.length === 0) {
        let message = `No action executions found for pipeline '${context.pipelineName}' in region ${context.region}`
        if (context.stageNameFilter)
          message += ` matching stage '${context.stageNameFilter}'`
        if (context.actionNameFilter)
          message += ` and action '${context.actionNameFilter}'`
        message += '.'
        return {
          message,
          executions: [],
        }
      }

      return {
        executions: filteredDetails.map((detail: ActionExecutionDetail) => {
          const isTerminal =
            detail.status === 'Succeeded' ||
            detail.status === 'Failed' ||
            detail.status === 'Abandoned'
          const endTimeDate = isTerminal ? detail.lastUpdateTime : undefined
          const durationString =
            detail.startTime && endTimeDate
              ? `${(endTimeDate.getTime() - detail.startTime.getTime()) / 1000}s`
              : undefined

          return {
            pipelineExecutionId: detail.pipelineExecutionId,
            stageName: detail.stageName,
            actionName: detail.actionName,
            startTime: detail.startTime?.toISOString(),
            endTime: endTimeDate?.toISOString(),
            duration: durationString,
            status: detail.status,
            inputSummary: detail.input?.inputArtifacts
              ? `${detail.input.inputArtifacts.length} artifact(s)`
              : 'none',
            outputSummary: detail.output?.outputArtifacts
              ? `${detail.output.outputArtifacts.length} artifact(s)`
              : 'none',
          }
        }),
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'An unknown error occurred'

      throw new Error(
        JSON.stringify({
          error: {
            message: errorMessage,
            pipelineName: context.pipelineName,
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
