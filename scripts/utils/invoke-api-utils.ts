import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { SignatureV4 } from '@smithy/signature-v4'
import { Sha256 } from '@aws-crypto/sha256-js'
import { HttpRequest } from '@smithy/protocol-http'
import { URL } from 'url'
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from '@aws-sdk/client-cloudformation'
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts'
import { Credentials, Provider } from '@aws-sdk/types'

export interface InvokeParams {
  endpoint: string
  region: string
  profile?: string
  method?: string // Default to POST
  body: string // Assumes JSON string body
}

export interface StreamingInvokeParams {
  functionUrl: string
  region: string
  profile?: string
  body: string
  onChunk: (chunk: string) => void
}

/**
 * Retrieves the API endpoint URL from the CloudFormation stack outputs
 */
export async function getApiEndpoint(
  stackName: string = 'ServerlessAgentPatternStack',
  region: string = 'us-east-1',
  profile?: string
): Promise<string | undefined> {
  try {
    // Create CloudFormation client with credentials from provider chain
    const credentialProvider = fromNodeProviderChain({ profile })
    const credentials = await credentialProvider()

    const cfnClient = new CloudFormationClient({
      region,
      credentials,
    })

    // Call DescribeStacks to get the outputs
    const command = new DescribeStacksCommand({
      StackName: stackName,
    })

    const response = await cfnClient.send(command)

    // Find the ApiEndpoint output
    const apiEndpointOutput = response.Stacks?.[0]?.Outputs?.find(
      (output) => output.OutputKey === 'ApiEndpoint'
    )

    return apiEndpointOutput?.OutputValue
  } catch (error) {
    console.error('Failed to retrieve API endpoint from CloudFormation:', error)
    return undefined
  }
}

/**
 * Retrieves the Function URL from the CloudFormation stack outputs
 */
export async function getFunctionUrl(
  stackName: string = 'ServerlessAgentPatternStack',
  region: string = 'us-east-1',
  profile?: string
): Promise<string | undefined> {
  try {
    // Create CloudFormation client with credentials from provider chain
    const credentialProvider = fromNodeProviderChain({ profile })
    const credentials = await credentialProvider()

    const cfnClient = new CloudFormationClient({
      region,
      credentials,
    })

    // Call DescribeStacks to get the outputs
    const command = new DescribeStacksCommand({
      StackName: stackName,
    })

    const response = await cfnClient.send(command)

    // Find the StreamingFunctionUrlEndpoint output
    const functionUrlOutput = response.Stacks?.[0]?.Outputs?.find(
      (output) => output.OutputKey === 'StreamingFunctionUrlEndpoint'
    )

    return functionUrlOutput?.OutputValue
  } catch (error) {
    console.error('Failed to retrieve Function URL from CloudFormation:', error)
    return undefined
  }
}

export async function invokeSignedApiRequest(
  params: InvokeParams
): Promise<any> {
  const { endpoint, region, profile, method = 'POST', body } = params

  // 1. Load Credentials (Original logic restored)
  const credentialProvider = fromNodeProviderChain({ profile })
  const credentials = await credentialProvider()

  // 2. Prepare the HTTP Request
  const url = new URL(endpoint)
  const request = new HttpRequest({
    method: method,
    hostname: url.hostname,
    path: url.pathname,
    protocol: url.protocol,
    headers: {
      'Content-Type': 'application/json',
      host: url.hostname, // Host header is required for signing
    },
    body: body,
  })

  // 3. Sign the Request
  const signer = new SignatureV4({
    credentials: credentials, // Use directly loaded credentials
    region: region,
    service: 'execute-api',
    sha256: Sha256,
  })

  const signedRequest = await signer.sign(request)

  // 4. Execute the Request using Fetch
  const response = await fetch(endpoint, {
    method: signedRequest.method,
    headers: signedRequest.headers,
    body: signedRequest.body,
  })

  const responseBody = await response.json()

  if (!response.ok) {
    console.error('Request Failed:', response.status, responseBody)
    throw new Error(`Request failed with status ${response.status}`)
  }

  return responseBody
}

/**
 * Invokes a Lambda Function URL with streaming response handling
 */
export async function invokeStreamingRequest(
  params: StreamingInvokeParams
): Promise<void> {
  const { functionUrl, region, profile, body, onChunk } = params

  // 1. Load Credentials using profile
  const credentialProvider = fromNodeProviderChain({ profile })
  const credentials = await credentialProvider()

  if (!credentials) {
    throw new Error(`Failed to load credentials for profile: ${profile}`)
  }

  // 2. Prepare the HTTP Request
  const url = new URL(functionUrl)
  const request = new HttpRequest({
    method: 'POST',
    hostname: url.hostname,
    path: url.pathname,
    protocol: url.protocol,
    headers: {
      'Content-Type': 'application/json',
      host: url.hostname, // Host header is required for signing
    },
    body: body,
  })

  // 3. Sign the Request using *temporary* credentials
  const signer = new SignatureV4({
    credentials: credentials, // Use the passed-in credentials
    region: region,
    service: 'lambda', // Function URLs are part of the Lambda service
    sha256: Sha256,
  })

  const signedRequest = await signer.sign(request)

  // 4. Execute the Request using Fetch with streaming
  const response = await fetch(functionUrl, {
    method: signedRequest.method,
    headers: signedRequest.headers,
    body: signedRequest.body,
  })

  if (!response.ok) {
    const errorText = await response.text()
    console.error('Streaming request failed:', response.status, errorText)
    throw new Error(`Streaming request failed with status ${response.status}`)
  }

  // Check if the response body is readable
  if (!response.body) {
    throw new Error('No response body received from the streaming request')
  }

  // Process the streaming response
  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  // Read chunks as they arrive
  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    // Decode the chunk and immediately send it to the handler
    if (value) {
      const text = decoder.decode(value, { stream: true })
      if (process.env.DEBUG) {
        console.log(`[DEBUG] Received raw chunk: ${text}`)
      }

      // Process the chunk immediately without waiting for complete JSON
      onChunk(text)
    }
  }
}
