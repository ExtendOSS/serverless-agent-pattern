import { z } from 'zod'
import { AWS_AGENT, AWS_AGENT_NAMES_WITH_NETWORK } from '../constants'

// Define the schema for the request body content
export const BodyContentSchema = z.object({
  query: z.string(),
  threadId: z.string(),
  resourceId: z.string(),
  agent: z.enum(AWS_AGENT_NAMES_WITH_NETWORK).optional().default(AWS_AGENT),
})

// Define the schema for the request event body, validating the body
export const EventBodySchema = z
  .string()
  .nullable()
  .refine((body): body is string => body !== null, {
    message: 'Missing request body',
  })
  // Add a refine step to check for valid JSON *before* parsing
  .refine(
    (body) => {
      try {
        JSON.parse(body)
        return true
      } catch {
        return false
      }
    },
    {
      message: 'Invalid JSON in request body',
    }
  )
  .transform((body) => JSON.parse(body) as unknown) // Now safe to parse
  .pipe(BodyContentSchema) // Validate the parsed object

export const ValidAgents = AWS_AGENT_NAMES_WITH_NETWORK
