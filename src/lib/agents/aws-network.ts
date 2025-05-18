import { AgentNetwork } from '@mastra/core/network'
import { bedrockClaudeSonnet37 } from './models'
import { createCloudformationAgent } from './cloudformation'
import { createCloudWatchLogsAgent } from './cloudwatchlogs'
import { createCodepipelineAgent } from './codepipeline'
import { createLambdaAgent } from './lambda'
import { createDynamodbAgent } from './dynamodb'
import { createS3Agent } from './s3'

/**
 * Creates an AWS Agent Network that composes all AWS-specific agents, allowing them
 * to collaborate to solve complex AWS-related tasks.
 *
 * This implementation follows the holonic system design principle from SELF_IMPROVEMENT_PROMPT.md,
 * where each agent is a self-contained "whole" with clear responsibilities while also functioning
 * as an integrated "part" of the larger AWS network.
 */
export const createAwsAgentNetwork = async (): Promise<AgentNetwork> => {
  // Create all individual AWS agents
  const cloudformationAgent = await createCloudformationAgent()
  const cloudwatchLogsAgent = await createCloudWatchLogsAgent()
  const codepipelineAgent = await createCodepipelineAgent()
  const lambdaAgent = await createLambdaAgent()
  const dynamodbAgent = await createDynamodbAgent()
  const s3Agent = await createS3Agent()

  // Create and return the agent network
  return new AgentNetwork({
    name: 'AWS Agent Network',
    instructions: `You are the AWS Agent Network, a system that coordinates specialized AWS agents to handle complex AWS-related tasks.

Your role is to understand the user's query and route it to the most appropriate specialized agent, or to compose multiple agents to solve complex problems.

The following specialized agents are available to you:

1. CloudFormation Agent: Experts at finding, analyzing, and monitoring CloudFormation stacks. Use for questions about stack deployments, configurations, and troubleshooting.

2. CloudWatch Logs Agent: Specializes in working with AWS CloudWatch logs. Use for queries about log groups, finding logs, and retrieving log events.

3. CodePipeline Agent: Provides insights into CI/CD pipelines. Use for finding pipelines, describing their structure, checking pipeline status, and reviewing execution history.

4. Lambda Agent: Helps with AWS Lambda functions. Use for finding Lambda functions and querying information about them.

5. DynamoDB Agent: Assists with DynamoDB tables. Use for finding tables, describing their configurations, and querying schema information.

6. S3 Agent: Manages S3 buckets and objects. Use for finding buckets, listing objects, retrieving object content, and working with S3 storage.

When coordinating these agents:
- If a query clearly belongs to ONE agent, route it directly to that agent.
- For complex queries that span MULTIPLE AWS services, break down the task and coordinate between the relevant agents.
- Maintain context between sub-tasks. When one agent provides information, use that to inform requests to other agents.
- For queries that mention specific AWS resources (e.g., a CloudFormation stack name), route to the appropriate agent even if the resource name is partially misspelled.
- Explain your coordination strategy when handling complex, multi-agent tasks.
- Always provide clear, concise responses that directly address the user's query.

Avoid unnecessary meta-commentary about the routing process unless it helps explain the solution approach for complex problems.`,
    model: bedrockClaudeSonnet37,
    agents: [
      cloudformationAgent,
      cloudwatchLogsAgent,
      codepipelineAgent,
      lambdaAgent,
      dynamodbAgent,
      s3Agent,
    ],
  })
}
