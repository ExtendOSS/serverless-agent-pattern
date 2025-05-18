/**
 * Lambda handler entry points
 *
 * This file exports two different Lambda handlers:
 * - bufferedHandler: Standard API Gateway handler that returns complete responses
 * - streamingHandler: Function URL handler that supports response streaming
 *
 * Use the appropriate handler depending on your Lambda invocation model:
 * - For API Gateway integrations, use 'bufferedHandler'
 * - For Function URLs with streaming, use 'streamingHandler'
 */

// Re-export handlers from their respective files
export { handler as bufferedHandler } from './buffered'
export { handler as streamingHandler } from './streaming'
