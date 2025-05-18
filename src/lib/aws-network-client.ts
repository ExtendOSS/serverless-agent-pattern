import { createAwsAgentNetwork } from './agents'

/**
 * This file demonstrates how to use the AWS Agent Network directly.
 *
 * While the AWS Agent Network isn't currently registered with the main Mastra instance
 * (due to type constraints), it can be used directly through this client.
 */

// Example function to generate text with the AWS Agent Network
export async function generateWithAwsNetwork(
  prompt: string,
  threadId?: string
) {
  const awsAgentNetwork = await createAwsAgentNetwork()

  console.log(
    `🔄 Processing request with AWS Agent Network: "${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}"`
  )

  const result = await awsAgentNetwork.generate(prompt, {
    resourceId: 'aws-client',
    threadId: threadId || `aws-thread-${Date.now()}`,
  })

  return {
    text: result.text,
    threadId: threadId || `aws-thread-${Date.now()}`,
  }
}

// Example function to stream text with the AWS Agent Network
export async function streamWithAwsNetwork(prompt: string, threadId?: string) {
  const awsAgentNetwork = await createAwsAgentNetwork()

  console.log(
    `🔄 Streaming response with AWS Agent Network: "${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}"`
  )

  const stream = await awsAgentNetwork.stream(prompt, {
    resourceId: 'aws-client',
    threadId: threadId || `aws-thread-${Date.now()}`,
  })

  return {
    textStream: stream.textStream,
    threadId: threadId || `aws-thread-${Date.now()}`,
  }
}
