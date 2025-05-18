import { z } from 'zod'
import { AWS_AGENT_NAMES } from '../constants'
import { getMastraInstance } from '../lib'
import { createAwsAgentNetwork } from '../lib/agents'
import { EventBodySchema } from './shared'

interface ResponseStream {
  setContentType: (contentType: string) => void
  write: (chunk: string) => void
  end: () => Promise<void>
}

interface FunctionUrlEvent {
  body: string
  [key: string]: unknown
}

// AWS Lambda runtime provides this global for response streaming
declare const awslambda: {
  streamifyResponse: <T>(
    handler: (
      event: FunctionUrlEvent,
      responseStream: ResponseStream
    ) => Promise<T>
  ) => (event: FunctionUrlEvent, context: unknown) => Promise<T>
}

// Define the schema for the request event, using the shared body schema
const EventSchema = z.object({
  body: EventBodySchema,
})

// Lambda handler function for streaming responses via Function URLs
export const handler = awslambda.streamifyResponse(
  async (
    event: FunctionUrlEvent,
    responseStream: ResponseStream
  ): Promise<void> => {
    console.log('Received event:', event)
    // Validate the entire event object
    const validationResult = EventSchema.safeParse(event)

    if (!validationResult.success) {
      // Handle validation errors (missing body, invalid JSON, or incorrect body structure)
      const errorMessages = validationResult.error.errors.map((e) => e.message)
      const error = {
        message: 'Invalid request',
        errors: errorMessages,
      }
      console.error('Error:', error)
      // Handle validation errors for streaming response
      const errorResponse = JSON.stringify(error)

      responseStream.write(errorResponse)
      await responseStream.end()
      return
    }

    // Extract query, threadId, resourceId, and agent from validated body
    const { query, threadId, resourceId, agent } = validationResult.data.body

    // Namespace the threadId with the agent name to ensure memory isolation
    const namespacedThreadId = `${agent}::${threadId}`

    try {
      responseStream.setContentType('text/plain')

      if (agent === 'awsAgentNetwork') {
        const network = await createAwsAgentNetwork()
        const stream = await network.stream(
          [{ role: 'user', content: query }],
          {
            threadId: namespacedThreadId,
            resourceId,
            maxSteps: 10, // Allow up to 10 tool usages
            maxRetries: 2, // Allow up to 2 retries
            temperature: 0,
          }
        )

        for await (const chunk of stream.textStream) {
          responseStream.write(chunk)
        }
      } else {
        const mastra = await getMastraInstance()

        const selectedAgent = mastra.getAgent(agent)

        if (!selectedAgent) {
          const errorResponse = JSON.stringify({
            message: `Agent "${agent}" not found. Valid agents are: ${AWS_AGENT_NAMES.join(', ')}.`,
          })
          responseStream.write(errorResponse)
        } else {
          // Start streaming chunks as they come in
          const stream = await selectedAgent.stream(
            [{ role: 'user', content: query }],
            {
              threadId: namespacedThreadId,
              resourceId,
              maxSteps: 10, // Allow up to 10 tool usages
              maxRetries: 2, // Allow up to 2 retries
              temperature: 0,
            }
          )

          for await (const chunk of stream.textStream) {
            responseStream.write(chunk)
          }
        }
      }

      await responseStream.end()
    } catch (error) {
      // Handle errors during agent interaction or other unexpected issues
      console.error('Error processing request:', error)

      // Handle errors for streaming response
      const errorResponse = JSON.stringify({
        message: 'Internal Server Error',
        error: error instanceof Error ? error.message : String(error),
      })

      responseStream.write(errorResponse)
      await responseStream.end()
    }
  }
)
