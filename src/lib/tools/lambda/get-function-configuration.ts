import {
  LambdaClient,
  GetFunctionConfigurationCommand,
  GetFunctionConfigurationCommandOutput,
} from '@aws-sdk/client-lambda'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { createTool } from '@mastra/core'
import { z } from 'zod'

const inputSchema = z.object({
  functionName: z.string().describe('The name or ARN of the Lambda function.'),
  region: z
    .string()
    .optional()
    .default('us-east-1')
    .describe(
      'AWS region where the Lambda function exists. Defaults to us-east-1.'
    ),
})

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const outputSchema = z
  .object({
    functionName: z.string().optional(),
    functionArn: z.string().optional(),
    runtime: z.string().optional(),
    role: z
      .string()
      .optional()
      .describe("The ARN of the function's execution role."),
    handler: z.string().optional(),
    codeSize: z
      .number()
      .optional()
      .describe("The size of the function's deployment package, in bytes."),
    description: z.string().optional(),
    timeout: z
      .number()
      .optional()
      .describe(
        'The amount of time in seconds that Lambda allows a function to run before stopping it.'
      ),
    memorySize: z
      .number()
      .optional()
      .describe('The amount of memory available to the function at runtime.'),
    lastModified: z
      .string()
      .optional()
      .describe(
        'The date and time that the function was last updated, in ISO-8601 format.'
      ),
    version: z
      .string()
      .optional()
      .describe('The version of the Lambda function.'),
    vpcId: z.string().optional().describe('The ID of the VPC if configured.'),
    subnetIds: z
      .array(z.string())
      .optional()
      .describe('A list of subnet IDs if VPC is configured.'),
    securityGroupIds: z
      .array(z.string())
      .optional()
      .describe('A list of security group IDs if VPC is configured.'),
    environmentVariables: z
      .record(z.string())
      .optional()
      .describe(
        "The function's environment variables. Only keys are returned for security reasons by default from SDK, actual values require GetFunction with appropriate permissions if sensitive."
      ),
    kmsKeyArn: z
      .string()
      .optional()
      .describe('The KMS key ARN used for encryption, if any.'),
    architectures: z
      .array(z.string())
      .optional()
      .describe('The instruction set architecture for the function.'),
    ephemeralStorageSize: z
      .number()
      .optional()
      .describe("The size of the function's /tmp directory in MB."),
    loggingConfig: z
      .object({
        logFormat: z.string().optional(),
        applicationLogLevel: z.string().optional(),
        systemLogLevel: z.string().optional(),
        logGroup: z.string().optional(),
      })
      .optional()
      .describe("The function's Amazon CloudWatch Logs configuration."),
    layers: z
      .array(
        z.object({
          arn: z.string().optional(),
          codeSize: z.number().optional(),
        })
      )
      .optional()
      .describe("The function's layers."),
    deadLetterConfigArn: z
      .string()
      .optional()
      .describe(
        'The ARN of the dead-letter queue for the function, if configured.'
      ),
    state: z
      .string()
      .optional()
      .describe(
        'The current state of the function (e.g., Active, Pending, Failed).'
      ),
    stateReason: z
      .string()
      .optional()
      .describe('The reason for the current state, if any.'),
    stateReasonCode: z
      .string()
      .optional()
      .describe('The code for the state reason, if any.'),
    lastUpdateStatus: z
      .string()
      .optional()
      .describe('The status of the last update performed on the function.'),
    lastUpdateStatusReason: z
      .string()
      .optional()
      .describe('The reason for the last update status.'),
    lastUpdateStatusReasonCode: z
      .string()
      .optional()
      .describe('The code for the last update status reason.'),
    packageType: z
      .string()
      .optional()
      .describe('The type of deployment package (Zip or Image).'),
    imageConfig: z
      .object({
        entryPoint: z.array(z.string()).optional(),
        command: z.array(z.string()).optional(),
        workingDirectory: z.string().optional(),
      })
      .optional()
      .describe('Container image configuration values.'),
    signingProfileVersionArn: z
      .string()
      .optional()
      .describe(
        'The ARN of the signing profile version, if code signing is enabled.'
      ),
    signingJobArn: z
      .string()
      .optional()
      .describe('The ARN of the signing job, if code signing is enabled.'),
  })
  .describe('Detailed configuration of an AWS Lambda function.')

export const lambdaGetFunctionConfiguration = createTool({
  id: 'lambda_get_function_configuration',
  description:
    'Retrieves the version-specific configuration information for a specified AWS Lambda function. This includes details like runtime, role, handler, memory size, timeout, environment variables (keys only by default), VPC settings, layers, and more.',
  inputSchema,
  execute: async ({
    context,
  }: {
    context: z.infer<typeof inputSchema>
  }): Promise<z.infer<typeof outputSchema>> => {
    const client = new LambdaClient({
      credentials: fromNodeProviderChain({ ignoreCache: true }),
      region: context.region,
    })

    try {
      const command = new GetFunctionConfigurationCommand({
        FunctionName: context.functionName,
        // Qualifier: can be added if specific versions/aliases are targeted
      })
      const response: GetFunctionConfigurationCommandOutput =
        await client.send(command)

      // Map the SDK response to our output schema
      return {
        functionName: response.FunctionName,
        functionArn: response.FunctionArn,
        runtime: response.Runtime,
        role: response.Role,
        handler: response.Handler,
        codeSize: response.CodeSize,
        description: response.Description,
        timeout: response.Timeout,
        memorySize: response.MemorySize,
        lastModified: response.LastModified,
        version: response.Version,
        vpcId: response.VpcConfig?.VpcId,
        subnetIds: response.VpcConfig?.SubnetIds,
        securityGroupIds: response.VpcConfig?.SecurityGroupIds,
        environmentVariables: response.Environment?.Variables,
        kmsKeyArn: response.KMSKeyArn,
        architectures: response.Architectures,
        ephemeralStorageSize: response.EphemeralStorage?.Size,
        loggingConfig: response.LoggingConfig
          ? {
              logFormat: response.LoggingConfig.LogFormat,
              applicationLogLevel: response.LoggingConfig.ApplicationLogLevel,
              systemLogLevel: response.LoggingConfig.SystemLogLevel,
              logGroup: response.LoggingConfig.LogGroup,
            }
          : undefined,
        layers: response.Layers?.map((layer) => ({
          arn: layer.Arn,
          codeSize: layer.CodeSize,
        })),
        deadLetterConfigArn: response.DeadLetterConfig?.TargetArn,
        state: response.State,
        stateReason: response.StateReason,
        stateReasonCode: response.StateReasonCode,
        lastUpdateStatus: response.LastUpdateStatus,
        lastUpdateStatusReason: response.LastUpdateStatusReason,
        lastUpdateStatusReasonCode: response.LastUpdateStatusReasonCode,
        packageType: response.PackageType,
        imageConfig: response.ImageConfigResponse?.ImageConfig
          ? {
              entryPoint: response.ImageConfigResponse.ImageConfig.EntryPoint,
              command: response.ImageConfigResponse.ImageConfig.Command,
              workingDirectory:
                response.ImageConfigResponse.ImageConfig.WorkingDirectory,
            }
          : undefined,
        signingProfileVersionArn: response.SigningProfileVersionArn,
        signingJobArn: response.SigningJobArn,
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'An unknown error occurred while getting Lambda function configuration.'
      console.error(
        `Error in lambda_get_function_configuration: ${errorMessage}`,
        error
      )
      // It's good practice to throw an error that can be caught by the agent/caller
      // or return a structured error response within the output schema.
      throw new Error(
        JSON.stringify({
          error: {
            message: errorMessage,
            functionName: context.functionName,
            region: context.region,
            type:
              error instanceof Error ? error.constructor.name : 'UnknownError',
            tool: 'lambda_get_function_configuration',
          },
        })
      )
    }
  },
})
