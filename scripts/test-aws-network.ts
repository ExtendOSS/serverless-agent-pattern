/**
 * Test script for the AWS Agent Network
 *
 * This script demonstrates how to use the AWS Agent Network to handle complex queries
 * that span multiple AWS services.
 *
 * To run this script:
 * 1. Build the project: pnpm run build
 * 2. Execute: pnpm tsx scripts/test-aws-network.ts
 */

import {
  generateWithAwsNetwork,
  streamWithAwsNetwork,
} from '../src/lib/aws-network-client'

async function main() {
  try {
    console.log('🚀 Testing AWS Agent Network...\n')

    // Example 1: Simple single-service query (should go to CloudFormation Agent)
    console.log('Example 1: Simple single-service query\n')
    const result1 = await generateWithAwsNetwork(
      'What are CloudFormation stacks and how do I list them?'
    )
    console.log(`Response: ${result1.text}\n\n`)

    // Example 2: Multi-service query (should coordinate multiple agents)
    console.log('Example 2: Multi-service query\n')
    const result2 = await generateWithAwsNetwork(
      'I want to understand the relationship between my CloudFormation stack, the Lambda functions it created, and how to check the logs for those functions.'
    )
    console.log(`Response: ${result2.text}\n\n`)

    // Example 3: Streaming a response (for a complex query)
    console.log('Example 3: Streaming a response\n')
    const threadId = `aws-thread-${Date.now()}`
    console.log(
      'Query: How can I find S3 buckets that were created by a specific CloudFormation stack and check if they have any objects?'
    )

    const streamResult = await streamWithAwsNetwork(
      'How can I find S3 buckets that were created by a specific CloudFormation stack and check if they have any objects?',
      threadId
    )

    console.log('Response:')
    for await (const chunk of streamResult.textStream) {
      process.stdout.write(chunk)
    }
    console.log('\n\n')

    // Example 4: Follow-up question in the same conversation thread
    console.log('Example 4: Follow-up question (same thread)\n')
    const result4 = await generateWithAwsNetwork(
      'If I found issues with those objects, how would I debug the Lambda function that created them?',
      threadId
    )
    console.log(`Response: ${result4.text}\n\n`)
  } catch (error) {
    console.error('Error testing AWS Agent Network:', error)
  }
}

main().catch(console.error)
