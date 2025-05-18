import { Agent } from '@mastra/core/agent'
import {
  listBucketsTool,
  listObjectsInBucketTool,
  getBucketLocationTool,
  findBucketTool,
  getObjectTool,
  diffTool,
} from '../tools'
import { createMemory } from './memory'
import { bedrockClaudeSonnet37 } from './models'

export const createS3Agent = async (): Promise<Agent> => {
  return new Agent({
    name: 'S3 Agent',
    instructions: `
        You are a helpful AWS S3 assistant. You can list buckets, find buckets, list objects, get object content, and upload objects.
        You can also compare text using the diffTool (using the ID 'text_diff').

        Your primary function is to help users manage and interact with their S3 storage. When responding:
        // ... (rest of instructions, ensuring to refer to text_diff for the diff tool if needed)

        Available tools:
        - listBucketsTool: List S3 buckets.
        - findBucketTool: Find a specific S3 bucket by name (fuzzy match).
        - listObjectsInBucketTool: List objects within a specified S3 bucket.
        - getBucketLocationTool: Get the AWS region of an S3 bucket.
        - getObjectTool: Retrieve the content of an S3 object.
        - text_diff: Use this to compare two pieces of text, such as two versions of an S3 object's content or metadata.

        Always ask for clarification if a bucket name or object key is ambiguous. Be careful with putObject operations and confirm with the user if the key might overwrite an existing object, unless they explicitly state to overwrite.
    `,
    model: bedrockClaudeSonnet37,
    tools: {
      listBuckets: listBucketsTool,
      findBucket: findBucketTool,
      listObjectsInBucket: listObjectsInBucketTool,
      getBucketLocation: getBucketLocationTool,
      getObject: getObjectTool,
      text_diff: diffTool,
    },
    memory: await createMemory('s3Agent'),
  })
}
