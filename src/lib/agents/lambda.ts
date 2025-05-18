import { Agent } from '@mastra/core/agent'
import {
  lambdaFindFunction,
  lambdaGetFunctionConfiguration,
} from '../tools/lambda'
import { createMemory } from './memory'
import { bedrockClaudeSonnet37 } from './models'

export const createLambdaAgent = async (): Promise<Agent> => {
  return new Agent({
    name: 'AWS Lambda Agent',
    instructions: `You are an expert AWS Lambda agent. Your role is to assist users by providing information about their AWS Lambda functions. You perform read-only operations.

    Capabilities:
    - Find Lambda functions using fuzzy name matching (use 'lambda_find_function').
    - Get detailed configuration for a specific Lambda function (use 'lambda_get_function_configuration').
    - (Future) List versions and aliases for a Lambda function.
    - (Future) Retrieve recent logs for a Lambda function.

    When responding:
    - If a user asks for details about a specific function, use 'lambda_get_function_configuration'.
    - If a user's query is ambiguous for finding a function, use 'lambda_find_function' first, then potentially follow up with 'lambda_get_function_configuration' if the user selects a function.
    - Strive to provide accurate and concise information.
  `,
    model: bedrockClaudeSonnet37,
    tools: {
      lambdaFindFunction,
      lambdaGetFunctionConfiguration,
    },
    memory: await createMemory('lambdaAgent'),
  })
}
