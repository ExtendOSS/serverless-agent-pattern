import { DynamoDBClient, DescribeTableCommand } from '@aws-sdk/client-dynamodb'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { z } from 'zod'
import { createTool } from '@mastra/core'

const inputSchema = z.object({
  tableName: z.string().describe('The name of the DynamoDB table to describe'),
  region: z
    .string()
    .default('us-east-1')
    .describe('AWS region where the table is located'),
})

type InputType = z.infer<typeof inputSchema>

export const dynamodbDescribeTable = createTool({
  id: 'dynamodb_describe_table',
  description: `Tool for retrieving detailed information about an AWS DynamoDB table.

WHEN TO USE:
- When you need comprehensive information about a DynamoDB table's configuration
- When you need to check table status, provisioned capacity, or throughput settings
- When you need to verify table settings like TTL, encryption, or stream configuration
- When you want to see the table's primary key structure and indexes

FEATURES:
- Provides complete details about table configuration and status
- Shows throughput information (provisioned or on-demand)
- Lists all secondary indexes (GSIs and LSIs)
- Includes table size and item count estimates
- Shows creation date and other metadata

CHAIN WITH:
- Use 'dynamodb_find_table' first if the exact table name is unknown
- Chain with other DynamoDB tools to analyze or work with the table

NOTES:
- Some values like item count and table size are estimates that may be delayed by several minutes
- Table status will indicate if the table is active and ready for use
- Returns the full AWS API response with all table details`,
  inputSchema,
  execute: async ({ context }: { context: InputType }) => {
    try {
      const client = new DynamoDBClient({
        credentials: fromNodeProviderChain({
          ignoreCache: true,
        }),
        region: context.region,
      })

      const command = new DescribeTableCommand({
        TableName: context.tableName,
      })

      const response = await client.send(command)

      if (!response.Table) {
        throw new Error(
          `Table ${context.tableName} not found in region ${context.region}`
        )
      }

      // Transform the API response to a more readable format
      const tableDetails = response.Table

      // Extract key schema for easier reading
      const keySchema = tableDetails.KeySchema?.map((key) => ({
        name: key.AttributeName,
        type: key.KeyType,
      }))

      // Extract attribute definitions
      const attributeDefinitions = tableDetails.AttributeDefinitions?.map(
        (attr) => ({
          name: attr.AttributeName,
          type: attr.AttributeType,
        })
      )

      // Transform stream specification if it exists
      const streamSpecification = tableDetails.StreamSpecification
        ? {
            streamEnabled: tableDetails.StreamSpecification.StreamEnabled,
            streamViewType: tableDetails.StreamSpecification.StreamViewType,
          }
        : undefined

      // Format secondary indexes
      const globalSecondaryIndexes = tableDetails.GlobalSecondaryIndexes?.map(
        (gsi) => ({
          indexName: gsi.IndexName,
          keySchema: gsi.KeySchema?.map((key) => ({
            name: key.AttributeName,
            type: key.KeyType,
          })),
          projection: gsi.Projection,
          indexStatus: gsi.IndexStatus,
          provisionedThroughput: gsi.ProvisionedThroughput
            ? {
                readCapacityUnits: gsi.ProvisionedThroughput.ReadCapacityUnits,
                writeCapacityUnits:
                  gsi.ProvisionedThroughput.WriteCapacityUnits,
              }
            : undefined,
        })
      )

      const localSecondaryIndexes = tableDetails.LocalSecondaryIndexes?.map(
        (lsi) => ({
          indexName: lsi.IndexName,
          keySchema: lsi.KeySchema?.map((key) => ({
            name: key.AttributeName,
            type: key.KeyType,
          })),
          projection: lsi.Projection,
        })
      )

      // Extract provisioned throughput if applicable
      const provisionedThroughput = tableDetails.ProvisionedThroughput
        ? {
            readCapacityUnits:
              tableDetails.ProvisionedThroughput.ReadCapacityUnits,
            writeCapacityUnits:
              tableDetails.ProvisionedThroughput.WriteCapacityUnits,
            lastIncreaseDateTime:
              tableDetails.ProvisionedThroughput.LastIncreaseDateTime,
            lastDecreaseDateTime:
              tableDetails.ProvisionedThroughput.LastDecreaseDateTime,
          }
        : undefined

      // Check for TTL status
      let ttlEnabled = false
      // We need to use JSON to bypass TypeScript's type checking since the TTL properties aren't in the type definitions
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const tableDetailsObj = JSON.parse(JSON.stringify(tableDetails))

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
      const timeToLiveDescription = tableDetailsObj.TimeToLiveDescription

      if (timeToLiveDescription) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (timeToLiveDescription.TimeToLiveStatus === 'ENABLED') {
          ttlEnabled = true
        }
      }

      // Create a clean response object
      const result = {
        tableName: tableDetails.TableName,
        tableStatus: tableDetails.TableStatus,
        creationDateTime: tableDetails.CreationDateTime,
        billingMode: tableDetails.BillingModeSummary?.BillingMode,
        keySchema,
        attributeDefinitions,
        itemCount: tableDetails.ItemCount,
        tableSizeBytes: tableDetails.TableSizeBytes,
        provisionedThroughput,
        streamSpecification,
        streamArn: tableDetails.LatestStreamArn,
        globalSecondaryIndexes,
        localSecondaryIndexes,
        tableId: tableDetails.TableId,
        encryptionType: tableDetails.SSEDescription?.SSEType,
        ttlEnabled,
        replicaDescription: tableDetails.Replicas?.map((replica) => ({
          region: replica.RegionName,
          status: replica.ReplicaStatus,
        })),
        tableClassSummary: tableDetails.TableClassSummary?.TableClass,
        deletionProtection: tableDetails.DeletionProtectionEnabled,
      }

      return result
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'An unknown error occurred'
      throw new Error(
        JSON.stringify({
          error: {
            message: errorMessage,
            region: context.region,
            tableName: context.tableName,
            type:
              error instanceof Error ? error.constructor.name : 'UnknownError',
          },
        })
      )
    }
  },
})
