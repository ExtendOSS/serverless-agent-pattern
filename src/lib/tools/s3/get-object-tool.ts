import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  S3ServiceException,
} from '@aws-sdk/client-s3'
import { createTool } from '@mastra/core'
import { z } from 'zod'
import { Readable } from 'stream'

// Maximum object size to fetch fully (5MB default)
const MAX_OBJECT_SIZE = 5 * 1024 * 1024
// Maximum content to return if truncating (100KB default)
const MAX_CONTENT_LENGTH = 100 * 1024

/**
 * Safely gets a property from an object or stream
 */
function hasMethod(obj: unknown, method: string): boolean {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    method in obj &&
    typeof (obj as Record<string, unknown>)[method] === 'function'
  )
}

/**
 * Converts streams to string, with size limiting
 * @param stream The stream-like object to convert
 * @param maxSize Maximum size to read before truncating
 */
async function streamToString(
  stream: unknown,
  maxSize: number = MAX_CONTENT_LENGTH
): Promise<{ content: string; truncated: boolean }> {
  // Handle Buffer directly
  if (Buffer.isBuffer(stream)) {
    const truncated = stream.length > maxSize
    return {
      content: truncated
        ? stream.slice(0, maxSize).toString()
        : stream.toString(),
      truncated,
    }
  }

  // Handle Node.js Readable streams
  if (stream instanceof Readable || hasMethod(stream, 'pipe')) {
    return new Promise((resolve, reject) => {
      const readable = stream as Readable
      const chunks: Buffer[] = []
      let totalSize = 0
      let truncated = false

      readable.on('data', (chunk) => {
        if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk)
          totalSize += chunk.length

          if (totalSize > maxSize && !truncated) {
            truncated = true
            // Don't need to read more data
            readable.destroy()
          }
        }
      })

      readable.on('error', (err) => reject(err))

      readable.on('end', () => {
        let content = Buffer.concat(chunks)
        if (truncated) {
          content = content.slice(0, maxSize)
        }
        resolve({
          content: content.toString('utf-8'),
          truncated,
        })
      })
    })
  }

  // Handle web ReadableStream
  if (hasMethod(stream, 'getReader')) {
    // Need to handle ReadableStream with getReader
    try {
      const getReader = (
        stream as {
          getReader(): {
            read(): Promise<{ done: boolean; value?: Uint8Array }>
          }
        }
      ).getReader()
      const chunks: Uint8Array[] = []
      let totalSize = 0
      let truncated = false

      while (true) {
        const { done, value } = await getReader.read()

        if (done) break

        if (value) {
          chunks.push(value)
          totalSize += value.length

          if (totalSize > maxSize && !truncated) {
            truncated = true
            break
          }
        }
      }

      // Combine all chunks
      const allUint8Arrays = new Uint8Array(Math.min(totalSize, maxSize))
      let position = 0

      for (const chunk of chunks) {
        if (position + chunk.length <= maxSize) {
          allUint8Arrays.set(chunk, position)
          position += chunk.length
        } else {
          // Only copy part of this chunk to reach maxSize
          const remainingBytes = maxSize - position
          allUint8Arrays.set(chunk.slice(0, remainingBytes), position)
          break
        }
      }

      const decoder = new TextDecoder('utf-8')
      return {
        content: decoder.decode(allUint8Arrays),
        truncated,
      }
    } catch (err) {
      throw new Error(`Error reading web stream: ${String(err)}`)
    }
  }

  // Try direct conversion as a last resort
  if (typeof stream === 'string') {
    const truncated = stream.length > maxSize
    return {
      content: truncated ? stream.substring(0, maxSize) : stream,
      truncated,
    }
  }

  // Unable to process the stream
  throw new Error(`Unsupported stream format: ${typeof stream}`)
}

const toolInputSchema = z.object({
  bucket: z.string().describe('The name of the S3 bucket.'),
  key: z.string().describe('The key of the object in the S3 bucket.'),
  region: z
    .string()
    .optional()
    .describe(
      'AWS region. If not provided, uses the default region from AWS config.'
    ),
  maxSize: z
    .number()
    .optional()
    .describe(
      `Maximum size in bytes to return. Objects larger than this will be truncated. Default: ${MAX_CONTENT_LENGTH} bytes.`
    ),
})

const toolOutputSchema = z.object({
  success: z.boolean(),
  content: z.string().optional(),
  contentType: z.string().optional(),
  contentLength: z.number().optional(),
  truncated: z.boolean().optional(),
  objectSizeBytes: z.number().optional(),
  message: z.string().optional(),
  statusCode: z.number().optional(),
  errorType: z.string().optional(),
  eTag: z.string().optional(),
})

type GetObjectToolInput = z.infer<typeof toolInputSchema>
type GetObjectToolOutput = z.infer<typeof toolOutputSchema>

export const getObjectTool = createTool({
  id: 's3_get_object',
  description: 'Retrieves the content of an object from an S3 bucket.',
  inputSchema: toolInputSchema,
  outputSchema: toolOutputSchema,
  async execute({
    context,
  }: {
    context: GetObjectToolInput
  }): Promise<GetObjectToolOutput> {
    const { bucket, key, region, maxSize } = context

    // Configure client with standard settings
    const client = new S3Client({ region })

    try {
      // First check object size with HeadObject
      let objectSize: number | undefined
      let contentType: string | undefined
      let wasContentTruncated = false
      let eTag: string | undefined

      try {
        const headResponse = await client.send(
          new HeadObjectCommand({
            Bucket: bucket,
            Key: key,
          })
        )

        objectSize = headResponse.ContentLength
        contentType = headResponse.ContentType
        eTag = headResponse.ETag

        // If object is too big, warn user about truncation
        if (objectSize && objectSize > (maxSize || MAX_CONTENT_LENGTH)) {
          wasContentTruncated = true
        }

        // Completely skip if it's massively large
        if (objectSize && objectSize > MAX_OBJECT_SIZE) {
          return {
            success: false,
            message: `Object is too large (${(objectSize / (1024 * 1024)).toFixed(2)} MB) to retrieve in full. The content will be truncated to the first ${(maxSize || MAX_CONTENT_LENGTH) / 1024} KB.`,
            objectSizeBytes: objectSize,
            contentType,
            eTag,
            truncated: true,
          }
        }
      } catch (
        /* eslint-disable-next-line @typescript-eslint/no-unused-vars */
        _headError
      ) {
        // Continue with GetObject if HeadObject fails
        // This can happen with some permissions configurations
      }

      // Get the actual object
      const response = await client.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        })
      )

      if (!response.Body) {
        return {
          success: false,
          message: 'Object found but has no content',
        }
      }

      // Convert the response body to string with size limits
      const { content, truncated } = await streamToString(
        response.Body,
        maxSize || MAX_CONTENT_LENGTH
      )

      // If truncated by the stream processing, update the flag
      if (truncated) {
        wasContentTruncated = true
      }

      return {
        success: true,
        content,
        contentType: response.ContentType || contentType,
        contentLength: response.ContentLength,
        truncated: wasContentTruncated,
        objectSizeBytes: objectSize,
      }
    } catch (error: unknown) {
      const typedError = error as Error
      let errorMessage = typedError.message
      let errorType = typedError.constructor?.name || 'UnknownError'
      let statusCode: number | undefined = undefined

      // Check if it's an AWS SDK error
      if (error instanceof S3ServiceException) {
        errorType = error.name
        statusCode = error.$metadata?.httpStatusCode

        if (statusCode === 404) {
          errorMessage = `Object not found: s3://${bucket}/${key}`
        } else if (statusCode === 403) {
          errorMessage = `Access denied for object: s3://${bucket}/${key}`
        } else if (statusCode === 400) {
          errorMessage = `Bad request when accessing s3://${bucket}/${key}`
        }
      } else if (
        typeof error === 'object' &&
        error !== null &&
        'name' in error &&
        'message' in error &&
        '$metadata' in error
      ) {
        // Fallback for SDK errors that might not be properly typed
        errorType = (error as { name: string }).name
        const metadata = (error as { $metadata: Record<string, unknown> })
          .$metadata

        if (
          typeof metadata === 'object' &&
          metadata !== null &&
          'httpStatusCode' in metadata
        ) {
          statusCode = metadata.httpStatusCode as number

          if (statusCode === 404) {
            errorMessage = `Object not found: s3://${bucket}/${key}`
          } else if (statusCode === 403) {
            errorMessage = `Access denied for object: s3://${bucket}/${key}`
          } else if (statusCode === 400) {
            errorMessage = `Bad request when accessing s3://${bucket}/${key}`
          }
        }
      }

      if (errorType === 'TimeoutError') {
        errorMessage = `Request timed out when accessing s3://${bucket}/${key}`
      }

      return {
        success: false,
        message: errorMessage,
        statusCode,
        errorType,
      }
    }
  },
})
