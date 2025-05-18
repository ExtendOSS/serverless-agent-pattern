import { createTool } from '@mastra/core'
import { z } from 'zod'
import * as chrono from 'chrono-node' // Import chrono-node

const toolInputSchema = z.object({
  offsetDescription: z
    .string()
    .optional()
    .default('now')
    .describe(
      "A textual description of the date offset (e.g., '1 hour ago', 'in 2 days', 'yesterday', 'tomorrow'). Defaults to 'now' if not provided."
    ),
})

const toolOutputSchema = z.object({
  calculatedDate: z
    .string()
    .describe('The calculated date and time in ISO 8601 format (UTC).'),
})

type GetDateOffsetToolInput = z.infer<typeof toolInputSchema>

// Define a type for the expected error structure within parsedMessage
type ParsedError = {
  error?: {
    message?: string
    type?: string
    tool?: string
  }
}

export const getDateOffset = createTool({
  id: 'get_date_offset',
  description:
    "Calculates a date based on a textual offset from the current time (e.g., '1 hour ago', 'tomorrow') and returns it as an ISO string. Defaults to the current time ('now') if no offsetDescription is provided.",
  inputSchema: toolInputSchema,
  outputSchema: toolOutputSchema,
  // eslint-disable-next-line @typescript-eslint/require-await
  async execute({
    context: userInput,
  }: {
    context: GetDateOffsetToolInput
  }): Promise<z.infer<typeof toolOutputSchema>> {
    const { offsetDescription } = userInput

    try {
      // Use chrono.parseDate to parse the description
      // The second argument to parseDate can be a reference date, defaulting to now.
      const parsedDate = chrono.parseDate(offsetDescription)

      if (parsedDate) {
        const calculatedDate = parsedDate.toISOString()
        console.log(
          `[getDateOffsetTool] Offset: "${offsetDescription}", Parsed Date: ${calculatedDate}`
        )
        return { calculatedDate }
      } else {
        // If chrono couldn't parse it, throw an error
        const errorMessageContent = `Offset description "${offsetDescription}" is not supported or could not be understood.`
        console.error(`[getDateOffsetTool] ERROR: ${errorMessageContent}`)
        throw new Error(
          JSON.stringify({
            error: {
              message: errorMessageContent,
              type: 'UnsupportedOffsetDescriptionError',
              tool: 'get_date_offset',
            },
          })
        )
      }
    } catch (error: unknown) {
      const typedError = error as Error
      try {
        const parsedMessage = JSON.parse(typedError.message) as ParsedError
        if (parsedMessage?.error?.tool === 'get_date_offset') {
          throw error
        }
      } catch (parseError) {
        console.debug(
          '[getDateOffsetTool] Original error was not our custom JSON or not a JSON string, wrapping it.',
          parseError
        )
      }

      const finalErrorMessage =
        typedError.message ||
        'An unknown error occurred while calculating the offset date.'
      console.error(
        `[getDateOffsetTool] WRAPPED ERROR: ${finalErrorMessage}`,
        typedError
      )
      throw new Error(
        JSON.stringify({
          error: {
            message: finalErrorMessage,
            type: typedError.constructor?.name || 'UnknownError',
            tool: 'get_date_offset',
          },
        })
      )
    }
  },
})
