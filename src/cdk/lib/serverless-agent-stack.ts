import * as cdk from 'aws-cdk-lib'
import { Duration, RemovalPolicy } from 'aws-cdk-lib'
import * as apigw from 'aws-cdk-lib/aws-apigateway'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import { Construct } from 'constructs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { AWS_AGENT_NAMES } from '../../constants.js'

// ESM equivalent for __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export class ServerlessAgentPatternStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // --- IAM Role for Lambda ---
    const lambdaRole = new iam.Role(this, 'ServerlessAgentPatternLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole'
        ),
      ],
    })

    // Get Bedrock model identifiers from context
    const bedrockModels = (this.node.tryGetContext('bedrockModels') as {
      embeddingModel: string
      completionModel: string
    }) || {
      embeddingModel: 'amazon.titan-embed-text-v2:0',
      completionModel: 'anthropic.claude-3-7-sonnet-20250219-v1:0',
    }

    // Grant invoke permissions for Bedrock foundation models
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
        ],
        resources: [
          `arn:aws:bedrock:*::foundation-model/${bedrockModels.embeddingModel}`,
          `arn:aws:bedrock:*::foundation-model/${bedrockModels.completionModel}`,
          `arn:aws:bedrock:*:${this.account}:inference-profile/*`,
        ],
        effect: iam.Effect.ALLOW,
      })
    )

    // Grant CloudFormation read permissions
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'cloudformation:DescribeStacks',
          'cloudformation:DescribeStackEvents',
          'cloudformation:ListStacks',
          'cloudformation:ListStackResources',
          'cloudformation:DescribeStackResources',
          'cloudformation:GetTemplate',
          'cloudformation:DescribeStackResourceDrifts',
          'cloudformation:ListStackSetOperations',
          'cloudformation:ListTypeRegistrations',
          'cloudformation:ListExports',
        ],
        resources: ['*'], // Allow access to all CloudFormation stacks
      })
    )

    // Grant CodePipeline read permissions
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'codepipeline:GetPipeline',
          'codepipeline:ListPipelines',
          'codepipeline:GetPipelineState',
          'codepipeline:ListActionExecutions',
          'codepipeline:GetPipelineExecution', // Added based on earlier plan
          'codepipeline:ListPipelineExecutions', // Added based on earlier plan
        ],
        resources: ['*'], // Allow access to all CodePipeline pipelines
      })
    )

    // Grant CloudWatch Logs permissions
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:DescribeLogGroups', // For finding log groups
          'logs:FilterLogEvents', // For getting log events
        ],
        resources: ['*'], // Adjust if more specific resource scoping is needed, though 'logs:DescribeLogGroups' typically requires '*' for listing all.
      })
    )

    // Grant AWS Lambda read permissions (for the new Lambda Agent)
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'lambda:ListFunctions', // For finding Lambda functions
          'lambda:GetFunctionConfiguration', // For getting specific function configuration
          // Add other read-only Lambda permissions here as new tools are developed
          // e.g., 'lambda:GetFunction', 'lambda:ListVersionsByFunction', etc.
        ],
        resources: ['*'], // lambda:ListFunctions and lambda:GetFunctionConfiguration typically require '*' or specific function ARNs
      })
    )

    // Grant DynamoDB tool permissions (for the new DynamoDB Agent)
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:ListTables', // For finding DynamoDB tables
          'dynamodb:DescribeTable', // For getting specific table details
        ],
        resources: ['*'], // dynamodb:ListTables requires '*' for listing all tables.
        // dynamodb:DescribeTable can be scoped to specific tables if needed but '*' is simpler for now.
      })
    )

    // Grant S3 read permissions (for the new S3 Agent)
    lambdaRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          's3:ListAllMyBuckets',
          's3:ListBucket',
          's3:GetBucketLocation',
          's3:GetObject',
        ],
        resources: ['*'], // s3:ListAllMyBuckets generally requires '*' or specific bucket ARNs for other actions.
      })
    )

    // Conditionally grant pinecone permissions and set env var
    const enablePinecone = this.node.tryGetContext('enablePinecone') === true
    let pineconeSecret: secretsmanager.ISecret | undefined = undefined
    let pineconeEnv: Record<string, string> = {}
    if (enablePinecone) {
      pineconeSecret = secretsmanager.Secret.fromSecretNameV2(
        this,
        'PineconeApiKeySecretLookup',
        this.node.tryGetContext('pineconeSecretName') as string
      )
      pineconeSecret.grantRead(lambdaRole)
      pineconeEnv = { PINECONE_API_KEY_SECRET_NAME: pineconeSecret.secretName }
    }

    const agentMemoryTables: Record<string, dynamodb.Table> = {}
    const agentMemoryTableEnvVars: Record<string, string> = {}

    for (const agentId of AWS_AGENT_NAMES) {
      const table = new dynamodb.Table(this, `MastraMemory-${agentId}`, {
        partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        pointInTimeRecoverySpecification: {
          pointInTimeRecoveryEnabled: false,
        },
        encryption: dynamodb.TableEncryption.AWS_MANAGED,
        removalPolicy: RemovalPolicy.DESTROY, // Set to RETAIN for production
      })

      table.addGlobalSecondaryIndex({
        indexName: 'gsi1',
        partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
        projectionType: dynamodb.ProjectionType.ALL,
      })

      table.addGlobalSecondaryIndex({
        indexName: 'gsi2',
        partitionKey: { name: 'gsi2pk', type: dynamodb.AttributeType.STRING },
        sortKey: { name: 'gsi2sk', type: dynamodb.AttributeType.STRING },
        projectionType: dynamodb.ProjectionType.ALL,
      })

      agentMemoryTables[agentId] = table
      agentMemoryTableEnvVars[`MEMORY_TABLE_NAME_${agentId.toUpperCase()}`] =
        table.tableName

      // Grant DynamoDB permissions for this specific memory table
      table.grantReadWriteData(lambdaRole)

      // Output for this specific table
      new cdk.CfnOutput(this, `DynamoDBTable-${agentId}`, {
        value: table.tableName,
        description: `Name of the DynamoDB memory table for ${agentId} agent`,
      })
    }

    const libsqlLayerArn = this.node.tryGetContext('libsqlLayerArn') as string

    // Common Lambda configuration
    const commonLambdaProps = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.X86_64,
      role: lambdaRole,
      memorySize: 512,
      depsLockFilePath: 'pnpm-lock.yaml',
      environment: {
        ...agentMemoryTableEnvVars, // Add new per-agent table name env vars
        ...pineconeEnv,
      },
      bundling: {
        externalModules: ['@aws-sdk/*', '@libsql/client'],
      },
      layers: [
        // This is only necessary because of an apparent bug in Mastra where libsql is referenced via imports
        // even when it is not used.
        // See https://github.com/mastra-ai/mastra/issues/4135
        ...(libsqlLayerArn.length > 0
          ? [
              lambda.LayerVersion.fromLayerVersionArn(
                this,
                'LibsqlLayer',
                libsqlLayerArn
              ),
            ]
          : []),
      ],
    }

    // --- Buffered Lambda Function (for API Gateway) ---
    const bufferedLambda = new lambdaNodejs.NodejsFunction(
      this,
      'ServerlessAgentPatternBufferedLambda',
      {
        ...commonLambdaProps,
        // API Gateway timeout is 30 seconds, so there is no point in having a longer timeout.
        timeout: Duration.seconds(45),
        handler: 'bufferedHandler',
        entry: path.join(__dirname, '../../lambda/index.ts'),
      }
    )

    // --- Streaming Lambda Function (for Function URL) ---
    const streamingLambda = new lambdaNodejs.NodejsFunction(
      this,
      'ServerlessAgentPatternStreamingLambda',
      {
        ...commonLambdaProps,
        // Streaming functions can stream output for up to the full 15 minute lambda timeout.
        timeout: Duration.minutes(5),
        handler: 'streamingHandler',
        entry: path.join(__dirname, '../../lambda/index.ts'),
      }
    )

    // Add a Function URL with IAM auth for streaming responses
    const streamingFunctionUrl = streamingLambda.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM, // Enable streaming response
    })

    const accessArns = this.node.tryGetContext('accessArns') as string[]

    for (const pattern of accessArns) {
      streamingFunctionUrl.grantInvokeUrl(new iam.ArnPrincipal(pattern))
    }

    // --- API Gateway with IAM Auth ---
    const api = new apigw.RestApi(this, 'ServerlessAgentPatternApi', {
      restApiName: 'ServerlessAgentPatternApi',
      description: 'API Gateway for the Serverless Agent Pattern',
      defaultMethodOptions: {
        authorizationType: apigw.AuthorizationType.IAM,
      },
      policy: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            principals: accessArns.map((arn) => new iam.ArnPrincipal(arn)),
            actions: ['execute-api:Invoke'],
            resources: ['execute-api:/*/*/*'], // Allow invoking any method on any stage/resource
          }),
        ],
      }),
      deployOptions: {
        stageName: 'prod', // Explicitly set stage name
      },
    })

    // API Gateway Lambda Integration (using buffered Lambda)
    const chatResource = api.root.addResource('chat')
    chatResource.addMethod('POST', new apigw.LambdaIntegration(bufferedLambda))

    // --- CDK Output ---
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.urlForPath(chatResource.path),
      description: 'API Gateway endpoint URL for the /chat resource',
    })
    new cdk.CfnOutput(this, 'StreamingFunctionUrlEndpoint', {
      value: streamingFunctionUrl.url,
      description: 'Function URL endpoint for streaming responses',
    })
    new cdk.CfnOutput(this, 'BufferedLambdaFunctionName', {
      value: bufferedLambda.functionName,
      description: 'Name of the buffered Lambda function for API Gateway',
    })
    new cdk.CfnOutput(this, 'StreamingLambdaFunctionName', {
      value: streamingLambda.functionName,
      description: 'Name of the streaming Lambda function for Function URL',
    })
  }
}
