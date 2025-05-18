import { Mastra } from '@mastra/core/mastra'
import { createLogger } from '@mastra/core/logger'
import {
  createCloudformationAgent,
  createCloudWatchLogsAgent,
  createCodepipelineAgent,
  createDynamodbAgent,
  createLambdaAgent,
  createS3Agent,
  createAwsAgent,
} from './agents'
import {
  CLOUDFORMATION_AGENT,
  CLOUDWATCHLOGS_AGENT,
  CODEPIPELINE_AGENT,
  LAMBDA_AGENT,
  DYNAMODB_AGENT,
  S3_AGENT,
  AWS_AGENT,
} from '../constants'
import { Agent } from '@mastra/core'

async function initializeMastra(): Promise<Mastra> {
  // Create Mastra instance
  const mastraInstance = new Mastra({
    agents: {
      [CLOUDFORMATION_AGENT]: await createCloudformationAgent(),
      [CLOUDWATCHLOGS_AGENT]: await createCloudWatchLogsAgent(),
      [CODEPIPELINE_AGENT]: await createCodepipelineAgent(),
      [LAMBDA_AGENT]: await createLambdaAgent(),
      [DYNAMODB_AGENT]: await createDynamodbAgent(),
      [S3_AGENT]: await createS3Agent(),
      [AWS_AGENT]: await createAwsAgent(),
    },
    logger: createLogger({
      name: 'Mastra',
      level: 'info',
    }),
  })

  return mastraInstance
}

let mastraInstancePromise: Promise<Mastra> | null = null

export function getMastraInstance(): Promise<Mastra> {
  if (!mastraInstancePromise) {
    mastraInstancePromise = initializeMastra()
  }
  return mastraInstancePromise
}

export const getAgent = async (
  agentName: string
): Promise<Agent | undefined> => {
  const mastraInstance = await getMastraInstance()

  // Type guard using 'unknown' as an intermediate step
  if (
    mastraInstance &&
    typeof (mastraInstance as unknown as Record<string, unknown>).getAgent ===
      'function'
  ) {
    // Call the method, asserting a minimal shape for getAgent
    const agent = (
      mastraInstance as unknown as {
        getAgent: (name: string) => unknown
      }
    ).getAgent(agentName) as Agent | undefined
    return agent
  }

  console.warn(
    "Mastra instance doesn't have a getAgent method or is not initialized as expected."
  )
  return undefined
}

export const mastra = {
  getMastraInstance,
}
