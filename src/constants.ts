// Individual agent names, can be useful for direct reference
export const CLOUDFORMATION_AGENT = 'cloudformationAgent' as const
export const CODEPIPELINE_AGENT = 'codepipelineAgent' as const
export const CLOUDWATCHLOGS_AGENT = 'cloudwatchLogsAgent' as const
export const LAMBDA_AGENT = 'lambdaAgent' as const
export const DYNAMODB_AGENT = 'dynamodbAgent' as const
export const S3_AGENT = 's3Agent' as const
export const AWS_AGENT = 'awsAgent' as const
export const AWS_AGENT_NETWORK = 'awsAgentNetwork' as const

export const AWS_AGENT_NAMES = [
  CLOUDFORMATION_AGENT,
  CODEPIPELINE_AGENT,
  CLOUDWATCHLOGS_AGENT,
  LAMBDA_AGENT,
  DYNAMODB_AGENT,
  S3_AGENT,
  AWS_AGENT,
] as const
export type AwsAgentName = (typeof AWS_AGENT_NAMES)[number]

export const AWS_AGENT_NAMES_WITH_NETWORK = [
  ...AWS_AGENT_NAMES,
  AWS_AGENT_NETWORK,
] as const
export type AwsAgentNameWithNetwork =
  (typeof AWS_AGENT_NAMES_WITH_NETWORK)[number]

export const agentDescriptions: Record<AwsAgentNameWithNetwork, string> = {
  [AWS_AGENT]:
    'Provides a comprehensive set of tools by combining the capabilities of all specialized AWS agents listed below. Useful for broad queries spanning multiple services, when the specific service is unknown or the query requires general knowledge of AWS across multiple services. Faster than using the network agent but less flexible and resilient.',
  [AWS_AGENT_NETWORK]:
    'Provides a comprehensive set of tools by combining the capabilities of all specialized AWS agents listed below. Useful for broad queries spanning multiple services, when the specific service is unknown or the query requires general knowledge of AWS across multiple services. More flexible and resilient than the unified agent but slower.',
  [CLOUDFORMATION_AGENT]:
    'Excels at finding and analyzing CloudFormation stacks, monitoring deployments, and troubleshooting.',
  [CODEPIPELINE_AGENT]:
    'Provides read-only access to CI/CD pipelines, their structure, status, and execution history.',
  [CLOUDWATCHLOGS_AGENT]:
    'Specializes in working with AWS CloudWatch logs, finding log groups, and retrieving log events.',
  [LAMBDA_AGENT]:
    'Helps with AWS Lambda functions, including finding them and getting their configuration.',
  [DYNAMODB_AGENT]:
    'Specializes in working with AWS DynamoDB, including finding tables, getting item counts, and retrieving specific items.',
  [S3_AGENT]:
    'Specializes in working with AWS S3, including finding buckets, getting object counts, and retrieving specific objects.',
}
