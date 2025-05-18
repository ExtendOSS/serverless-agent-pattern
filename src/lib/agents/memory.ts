import { bedrock } from '@ai-sdk/amazon-bedrock'
import { DynamoDBStore } from '@helloextend/mastra-dynamodb'
import { Memory } from '@mastra/memory'
import { PineconeVector } from '@mastra/pinecone'
import { getPineconeKey } from '../utils'
import { AwsAgentName } from '../../constants'

export async function createMemory(agentIdentifier: AwsAgentName) {
  let vector: PineconeVector | false = false
  if (process.env.PINECONE_API_KEY_SECRET_NAME) {
    vector = new PineconeVector(await getPineconeKey())
  }

  const tableNameEnvVar = `MEMORY_TABLE_NAME_${agentIdentifier.toUpperCase()}`
  const tableName =
    process.env[tableNameEnvVar] ||
    `mastra-memory-${agentIdentifier.toLowerCase()}`

  return new Memory({
    vector,
    storage: new DynamoDBStore({
      name: `dynamodb-memory-${agentIdentifier.toLowerCase()}`,
      config: {
        tableName: tableName,
      },
    }),
    embedder: bedrock.embedding('amazon.titan-embed-text-v2:0'),
    options: {
      semanticRecall: true,
      lastMessages: 42,
      threads: {
        generateTitle: false,
      },
    },
  })
}
