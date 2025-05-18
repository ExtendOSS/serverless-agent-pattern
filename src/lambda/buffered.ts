import { getMastraInstance } from '../lib'
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda'
import { z } from 'zod'
import { EventBodySchema } from './shared'

// Define the schema for the APIGatewayProxyEvent, using the shared body schema
const EventSchema = z.object({
  body: EventBodySchema,
})

// Lambda handler function for API Gateway (non-streaming)
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  // Validate the entire event object
  const validationResult = EventSchema.safeParse(event)

  if (!validationResult.success) {
    // Handle validation errors (missing body, invalid JSON, or incorrect body structure)
    const errorMessages = validationResult.error.errors.map((e) => e.message)

    return {
      statusCode: 400,
      body: JSON.stringify({
        message: 'Invalid request',
        errors: errorMessages,
      }),
    }
  }

  // Extract query, threadId, resourceId, and agent from validated body
  const { query, threadId, resourceId, agent } = validationResult.data.body

  try {
    // Get the initialized Mastra instance (waits for secrets if first invocation)
    const mastra = await getMastraInstance()

    // Get the requested agent (defaults to cloudformationAgent if not specified)
    const selectedAgent = mastra.getAgent(agent)

    // Standard API Gateway response
    const response = await selectedAgent.generate(
      [{ role: 'user', content: query }],
      {
        threadId,
        resourceId,
        // Allow up to 5 tool usage steps
        // By default, it's set to 1, which means that only a single LLM call is made.
        maxSteps: 5,
        maxRetries: 2, // Allow up to 2 retries
      }
    )

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: response.text,
        agent: agent,
      }),
    }
  } catch (error) {
    // Handle errors during agent interaction or other unexpected issues
    console.error('Error processing request:', error)

    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Internal Server Error',
        error: error instanceof Error ? error.message : String(error),
      }),
    }
  }
}
