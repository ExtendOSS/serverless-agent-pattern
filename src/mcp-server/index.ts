// Add global error handlers
process.on('uncaughtException', (error) => {
  console.error('MCP Server UNCAUGHT EXCEPTION:\n', error)
  process.exit(1) // Ensure process exits on uncaught exception
})
process.on('unhandledRejection', (reason, promise) => {
  console.error(
    'MCP Server UNHANDLED REJECTION:\nReason:',
    reason,
    '\nAt Promise:',
    promise
  )
  process.exit(1) // Ensure process exits on unhandled rejection
})

// Remove diagnostic logs
import { Sha256 } from '@aws-crypto/sha256-js'
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { AwsCredentialIdentity } from '@aws-sdk/types'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { HttpRequest as SmithyHttpRequest } from '@smithy/protocol-http'
import { SignatureV4 } from '@smithy/signature-v4'
import { nanoid } from 'nanoid'
import { URL } from 'url'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { AWS_AGENT, AWS_AGENT_NAMES_WITH_NETWORK } from '../constants.js'
// Remove diagnostic log

// // Add near the top of the file, after other imports
// const DEFAULT_AWS_PROFILE = process.env.AWS_PROFILE

// --- Tool Definition (Schema and Logic) ---

const remoteAgentProxyInputSchema = z.object({
  query: z.string().describe('The query/prompt to send to the remote agent.'),
  profile: z
    .string()
    .optional()
    .describe(
      'AWS profile to use for credentials and CFN lookup. If not provided will be resolved by the default provider chain.'
    ),
  agent: z
    .enum(AWS_AGENT_NAMES_WITH_NETWORK)
    .optional()
    .default(AWS_AGENT)
    .describe(
      'The target agent name. Valid options: cloudformationAgent, codepipelineAgent, cloudwatchLogsAgent, lambdaAgent, dynamodbAgent, s3Agent, awsAgentNetwork, awsAgent (a unified agent with tools from all AWS services).'
    ),
  stackName: z
    .string()
    .optional()
    .default('ServerlessAgentPatternStack')
    .describe(
      'The CloudFormation stack name to fetch the Lambda Function URL from. Not the same as the stack name for arguments when using the cloudformationAgent.'
    ),
  region: z
    .string()
    .optional()
    .default('us-east-1')
    .describe('The AWS region of the stack and services.'),
  sessionId: z
    .string()
    .default(() => nanoid())
    .describe(
      "A 'sessionId' is optional and generated for you automatically if none is provided. You can omit this parameter on the first call in a session and then use the generated one as an input for future calls."
    ),
  lambdaFunctionUrlOverride: z
    .string()
    .optional()
    .describe('Explicitly provide the Lambda Function URL.'),
})

type RemoteAgentProxyInput = z.infer<typeof remoteAgentProxyInputSchema>

const toolName = 'remoteAgentProxy'
const toolDescription = `This tool provides access to specialized remote agents with deep expertise in AWS CloudFormation, AWS CodePipeline, AWS CloudWatch Logs, AWS Lambda, AWS DynamoDB, S3, and weather information. It also offers a unified 'awsAgent' that combines tools from all specialized AWS agents and an 'awsAgentNetwork' that coordinates them.

IMPORTANT: A 'sessionId' is optional and generated for you automatically if none is provided. You can omit this parameter on the first call in a session and then use the generated one as an input for future calls.

Available Agents:

- **awsAgent (UNIFIED)**: Provides a comprehensive set of tools by combining the capabilities of all specialized AWS agents listed below. Useful for broad queries spanning multiple services, when the specific service is unknown, or for direct comparison with the awsAgentNetwork.

- **awsAgentNetwork**: Coordinates all specialized AWS agents to solve complex problems. It automatically routes queries to the most appropriate agent(s) and handles tasks spanning multiple AWS services.

- **cloudformationAgent**: Excels at finding and analyzing CloudFormation stacks, monitoring deployments, and troubleshooting.

- **codepipelineAgent**: Provides read-only access to CI/CD pipelines, their structure, status, and execution history.

- **cloudwatchLogsAgent**: Specializes in working with AWS CloudWatch logs, finding log groups, and retrieving log events.

- **lambdaAgent**: Helps with AWS Lambda functions, including finding them and getting their configuration.

- **dynamodbAgent**: Assists with DynamoDB tables, finding tables and describing their configurations.

- **s3Agent**: Manages S3 buckets and objects, including finding buckets, listing objects, getting content, and uploading objects.

All agents maintain conversation memory and can handle follow-up questions naturally. They use advanced embeddings for semantic recall and can reference previous interactions within the same session.

**CloudFormation Agent in detail**:
- Finding and analyzing CloudFormation stacks using fuzzy search.
- Monitoring stack deployments and troubleshooting failed resources.
- Providing detailed information about stack configurations, parameters, and resources.
- Tracking deployment history and explaining stack events.
- Offering recommendations for common CloudFormation issues.
- Use for questions like: "What happened to my stack deployment?", "Show me resources in my-stack.", "Why did my CloudFormation deployment fail?"

The AWS CodePipeline Agent provides read-only access to your CI/CD pipelines:
- Finding pipelines using fuzzy name matching (even with partial or misspelled names).
- Describing the structure (stages and actions) of a specific pipeline.
- Reporting the current state of a pipeline and its stages/actions.
- Listing historical executions for specific actions within a pipeline.
- Use for questions like: "Find CodePipelines related to 'WebApp-Prod'.", "Describe the 'WebApp-Prod' pipeline.", "What's the status of the 'Source' stage in 'MyPipeline'?", "Show the last 5 executions of the 'Build' action in 'MyPipeline::BuildStage'."
- This agent can be used in conjunction with the CloudFormation agent for comprehensive deployment and infrastructure analysis.

The AWS CloudWatch Logs Agent can:
- List log groups, optionally filtered by a prefix.
- Find log groups using fuzzy search (even with partial or misspelled names).
- Retrieve recent log events from a specified log group, with options for limit, time range, and filter patterns.
- Use for questions like: "List my log groups", "Find log groups related to 'api'", "Get the last 50 logs from /aws/lambda/my-service containing ERROR".

The AWS Lambda Agent can:
- Find Lambda functions using fuzzy name matching.
- (Future capabilities: get configuration, list versions/aliases, etc.)
- Use for questions like: "Find my lambda function for processing orders" or "Show me lambda functions related to 'user-service'".

The AWS DynamoDB Agent (NEW) provides read-only access to your DynamoDB tables:
- Finding tables using fuzzy name matching (even with partial or misspelled names).
- Describing the configuration and details of a specific table (e.g., schema, indexes, status, item count).
- Use for questions like: "Find DynamoDB tables related to 'CustomerData'.", "Describe the 'Orders' table.", "What is the key schema for the 'ProductCatalog' table?"

The S3 Agent manages S3 buckets and objects:
- Finding S3 buckets using fuzzy search
- Listing objects in buckets and their details
- Getting object content and metadata
- Working with S3 storage

The Weather Agent can:
- Provide detailed weather information for any location worldwide.
- Include temperature (defaulting to Fahrenheit), humidity, wind conditions, and precipitation.
- Handle location names in multiple languages.

All agents maintain conversation memory and can handle follow-up questions naturally. They use advanced embeddings for semantic recall and can reference previous interactions within the same session.`

// Convert Zod schema to JSON Schema for MCP
const mcpInputSchema = zodToJsonSchema(
  remoteAgentProxyInputSchema,
  toolName + 'Input'
)

async function getCfnOutput(
  stackName: string,
  outputKey: string,
  region: string,
  credentials: AwsCredentialIdentity
): Promise<string | undefined> {
  console.error(
    `[getCfnOutput] Attempting to fetch output ${outputKey} from stack ${stackName} in region ${region}`
  )
  try {
    const cfnClient = new CloudFormationClient({ region, credentials })
    const command = new DescribeStacksCommand({ StackName: stackName })
    console.error(
      `[getCfnOutput] Sending DescribeStacksCommand for stack ${stackName}...`
    )
    const response = await cfnClient.send(command)
    console.error(
      `[getCfnOutput] DescribeStacksCommand response received for stack ${stackName}.`
    )
    const output = response.Stacks?.[0]?.Outputs?.find(
      (o) => o.OutputKey === outputKey
    )
    if (output) {
      console.error(
        `[getCfnOutput] Found output ${outputKey}: ${output.OutputValue}`
      )
    } else {
      console.error(
        `[getCfnOutput] Output ${outputKey} not found in response for stack ${stackName}.`
      )
    }
    return output?.OutputValue
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    // Log the specific error encountered during the API call
    console.error(
      `[getCfnOutput] ERROR fetching output ${outputKey} from stack ${stackName}: ${message}`,
      error // Log the full error object if available
    )
    throw new Error(
      `Failed to retrieve ${outputKey} from CloudFormation stack ${stackName}: ${message}`
    )
  }
}

async function signRequest(
  requestUrl: string,
  region: string,
  service: string,
  body: string,
  credentials: AwsCredentialIdentity
): Promise<SmithyHttpRequest> {
  const url = new URL(requestUrl)
  const request = new SmithyHttpRequest({
    method: 'POST',
    hostname: url.hostname,
    path: url.pathname,
    protocol: url.protocol,
    headers: {
      'Content-Type': 'application/json',
      host: url.hostname,
    },
    body: body,
  })

  const signer = new SignatureV4({
    credentials,
    region,
    service,
    sha256: Sha256,
  })

  const signed = await signer.sign(request)

  // Check the type of the body after signing
  const bodyType = typeof signed.body
  if (
    bodyType !== 'string' &&
    !(signed.body instanceof Uint8Array) &&
    signed.body != null
  ) {
    // Log warning to stderr
    console.error(
      '[WARN] Signed request body is of an unexpected type:',
      bodyType,
      'Attempting to proceed.'
    )
  }
  // Cast should be compatible with the return type now
  return signed as SmithyHttpRequest
}

async function invokeStreamingRequest(
  functionUrl: string,
  region: string,
  body: string,
  credentials: AwsCredentialIdentity
): Promise<string> {
  const signedRequest = await signRequest(
    functionUrl,
    region,
    'lambda', // Function URLs are part of the Lambda service
    body,
    credentials
  )

  const response = await fetch(functionUrl, {
    method: signedRequest.method,
    headers: signedRequest.headers,
    body:
      typeof signedRequest.body === 'string' ||
      signedRequest.body instanceof Uint8Array
        ? signedRequest.body
        : String(signedRequest.body ?? ''), // Fallback: convert unknown to string
  })

  if (!response.ok || !response.body) {
    const errorText = await response.text()
    console.error('Streaming request failed:', response.status, errorText)
    throw new Error(
      `Streaming request failed with status ${response.status}: ${errorText}`
    )
  }

  // Accumulate chunks
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let accumulatedResponse = ''
  while (true) {
    const chunkResult = (await reader.read()) as {
      done: boolean
      value?: Uint8Array
    }
    if (chunkResult.done) break
    const value = chunkResult.value
    if (value) {
      // Decode the chunk and append directly, no JSON parsing needed for text stream
      const chunk = decoder.decode(value, { stream: true })
      accumulatedResponse += chunk
    }
  }

  return accumulatedResponse
}

// --- Tool Execution Logic ---
async function runRemoteAgentProxy(
  input: RemoteAgentProxyInput
): Promise<{ output: string; sessionId: string }> {
  // Get AWS credentials from the provider chain
  console.error(
    `[runRemoteAgentProxy] Getting AWS credentials using profile: ${input.profile}`
  )
  const originalCredentials = await fromNodeProviderChain({
    profile: input.profile,
  })()

  try {
    if (!input.query.trim()) {
      return {
        output: 'Please provide a query to send to the remote agent.',
        sessionId: input.sessionId,
      }
    }

    // Get Lambda Function URL
    let functionUrl = input.lambdaFunctionUrlOverride
    if (!functionUrl) {
      console.error(
        `[runRemoteAgentProxy] Retrieving Lambda Function URL from CloudFormation Stack ${input.stackName}`
      )
      try {
        functionUrl = await getCfnOutput(
          input.stackName,
          'StreamingFunctionUrlEndpoint',
          input.region,
          originalCredentials
        )
        console.error(
          `[runRemoteAgentProxy] Retrieved Lambda Function URL: ${functionUrl}`
        )
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(
          `[runRemoteAgentProxy] Failed to get Lambda Function URL: ${message}`
        )
        throw new Error(`Failed to get Lambda Function URL: ${message}`)
      }
    }

    if (!functionUrl) {
      throw new Error(
        'Lambda Function URL not found and not provided in override.'
      )
    }

    // Prepare the request body
    const requestBody = {
      query: input.query,
      agent: input.agent,
      threadId: input.sessionId,
      resourceId: `remoteProxy-tool-${input.sessionId}`,
    }
    const stringifiedBody = JSON.stringify(requestBody)

    // Make the request using originalCredentials
    console.error(
      `[runRemoteAgentProxy] Invoking streaming request to ${functionUrl} with agent ${input.agent}`
    )
    const responseText = await invokeStreamingRequest(
      functionUrl,
      input.region,
      stringifiedBody,
      originalCredentials
    )

    return { output: responseText, sessionId: input.sessionId }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[runRemoteAgentProxy] ERROR: ${message}`)
    return {
      output: `Error invoking remote agent: ${message}`,
      sessionId: input.sessionId,
    }
  }
}

// --- MCP Server Setup ---

const server = new Server(
  {
    description: 'Remote Agent Proxy MCP Server',
    name: 'remote-agent-proxy-mcp-server',
    version: '0.1.0',
  },
  {
    capabilities: {
      logging: {},
      tools: {},
    },
  }
)

// ListTools Handler
server.setRequestHandler(ListToolsRequestSchema, () => {
  // Extract the actual schema definition using the typed variable
  const definitionKey = toolName + 'Input'
  const inlineSchema = mcpInputSchema?.definitions?.[definitionKey] ?? {
    type: 'object',
  } // Use the key used during generation

  const response = {
    tools: [
      {
        name: toolName,
        description: toolDescription,
        // Provide the inlined schema definition
        inputSchema: inlineSchema,
      },
    ],
  }
  return response
})

// CallTool Handler
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const requestedToolName = req.params.name

  if (requestedToolName !== toolName) {
    throw new Error(`Tool not found: ${requestedToolName}`)
  }

  try {
    const validatedInput = remoteAgentProxyInputSchema.parse(
      req.params.arguments
    )
    const result = await runRemoteAgentProxy(validatedInput)

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result),
        },
      ],
    }
  } catch (error: unknown) {
    // Enhanced error handling for Zod validation errors
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((issue) => {
        const path = issue.path.join('.')
        return `${path || 'parameter'}: ${issue.message}`
      })
      console.error(`[MCP Server] Validation error for ${toolName}:`, issues)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: 'Invalid request',
              errors: issues,
              details: issues.join(', '),
            }),
          },
        ],
      }
    }

    const message = error instanceof Error ? error.message : String(error)
    console.error(`[MCP Server] Error executing tool ${toolName}:`, message)
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            message: 'Error executing request',
            error: message,
          }),
        },
      ],
    }
  }
})

// Start the server
const transport = new StdioServerTransport()
server.connect(transport).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error('❌ Failed to connect local MCP server:', message)
  process.exit(1)
})

// Keep the process alive by explicitly resuming stdin
process.stdin.resume()

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🔌 Shutting down local MCP server...')
  void server.close() // Explicitly ignore promise
  process.exit(0)
})
process.on('SIGTERM', () => {
  console.log('\n🔌 Shutting down local MCP server...')
  void server.close() // Explicitly ignore promise
  process.exit(0)
})
