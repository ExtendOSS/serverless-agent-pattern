import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import {
  invokeSignedApiRequest,
  getApiEndpoint,
  getFunctionUrl,
  invokeStreamingRequest,
} from './utils/invoke-api-utils'
import {
  CLOUDFORMATION_AGENT,
  CODEPIPELINE_AGENT,
  CLOUDWATCHLOGS_AGENT,
  LAMBDA_AGENT,
  DYNAMODB_AGENT,
  S3_AGENT,
  AWS_AGENT,
  AWS_AGENT_NETWORK,
  AWS_AGENT_NAMES,
  AWS_AGENT_NAMES_WITH_NETWORK,
  AwsAgentNameWithNetwork,
} from '../src/constants'

// --- ANSI Color Codes ---
const colors = {
  reset: '\x1b[0m',
  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  // Bright foreground colors
  brightBlack: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',
  // Text formatting
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
}

// --- UI Helpers ---
const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

function showProcessingIndicator(message: string): { stop: () => void } {
  let i = 0
  const intervalId = setInterval(() => {
    process.stdout.write(
      `\r${colors.cyan}${frames[i]}${colors.reset} ${colors.brightBlue}${message}${colors.reset}`
    )
    i = (i + 1) % frames.length
  }, 80)

  return {
    stop: () => {
      clearInterval(intervalId)
      process.stdout.write('\r' + ' '.repeat(message.length + 2) + '\r') // Clear the line
    },
  }
}

// --- Types ---
interface AppConfig {
  region: string
  profile?: string
  stackName: string
  initialAgent: string
  initialUseStreaming: boolean
  debug: boolean
  singleQuery?: string
  sessionId: string
  apiGatewayEndpoint?: string
  lambdaFunctionUrl?: string
}

interface ChatState {
  currentAgent: string
  useStreaming: boolean
  // We might add more state here later, like conversation history if needed
}

// --- Configuration Loading ---
async function loadCliArgs() {
  const args = hideBin(process.argv)
  const processedArgs = args[0] === '--' ? args.slice(1) : args

  return await yargs(processedArgs)
    .option('endpoint', {
      alias: 'e',
      type: 'string',
      description:
        'The full API Gateway endpoint URL. If omitted, will be retrieved from CloudFormation.',
      demandOption: false,
    })
    .option('region', {
      alias: 'r',
      type: 'string',
      description: 'The AWS region of the API Gateway',
      default: 'us-east-1',
      demandOption: false,
    })
    .option('profile', {
      alias: 'p',
      type: 'string',
      description: 'The AWS profile to use for credentials',
      default: 'default',
    })
    .option('session-id', {
      alias: 's',
      type: 'string',
      description:
        'Unique identifier for the chat session. If omitted, a new one is generated.',
      demandOption: false,
    })
    .option('stack-name', {
      type: 'string',
      description: 'CloudFormation stack name to retrieve API endpoint from',
      default: 'ServerlessAgentPatternStack',
      demandOption: false,
    })
    .option('agent', {
      alias: 'a',
      type: 'string',
      description: 'The agent to use for processing the request',
      choices: AWS_AGENT_NAMES_WITH_NETWORK,
      default: AWS_AGENT,
      demandOption: false,
    })
    .option('streaming', {
      type: 'boolean',
      description:
        'Use streaming mode with Lambda Function URL instead of API Gateway',
      default: true,
      demandOption: false,
    })
    .option('debug', {
      type: 'boolean',
      description: 'Enable debug output for troubleshooting',
      default: false,
      demandOption: false,
    })
    .option('query', {
      alias: 'q',
      type: 'string',
      description:
        'Execute a single query and exit without starting the interactive chat.',
      demandOption: false,
    })
    .help()
    .alias('help', 'h').argv
}

async function loadAndValidateConfig(): Promise<AppConfig> {
  const argv = await loadCliArgs()

  if (argv.debug) {
    process.env.DEBUG = 'true'
    console.log(`${colors.dim}[DEBUG] Debug mode enabled.${colors.reset}`)
  }

  const config: Partial<AppConfig> = {
    region: argv.region,
    profile: argv.profile,
    stackName: argv.stackName,
    initialAgent: argv.agent,
    initialUseStreaming: argv.streaming,
    debug: argv.debug,
    singleQuery: argv.query,
    sessionId: argv.sessionId || `chat-${Date.now()}`,
    apiGatewayEndpoint: argv.endpoint, // Start with provided endpoint if available
  }

  if (config.debug) {
    console.log(
      `${colors.cyan}Retrieving configuration from CloudFormation stack: ${colors.yellow}${config.stackName}${colors.cyan} in region ${colors.yellow}${config.region}${colors.cyan}...${colors.reset}`
    )
  }

  // Fetch Function URL
  try {
    config.lambdaFunctionUrl = await getFunctionUrl(
      config.stackName!,
      config.region!,
      config.profile
    )
    if (config.lambdaFunctionUrl) {
      if (config.debug) {
        console.log(
          `${colors.green}Found Streaming Function URL: ${colors.brightGreen}${config.lambdaFunctionUrl}${colors.reset}`
        )
      }
    } else {
      if (config.debug) {
        console.log(
          `${colors.yellow}Streaming Function URL not found.${colors.reset}`
        )
      }
    }
  } catch (error: any) {
    if (config.debug) {
      console.warn(
        `${colors.yellow}Could not retrieve Function URL: ${error.message || error}${colors.reset}`
      )
    }
  }

  // Validate and potentially disable streaming
  if (config.initialUseStreaming && !config.lambdaFunctionUrl) {
    if (config.debug) {
      console.log(
        `${colors.yellow}Cannot use streaming mode due to missing Function URL. Disabling streaming.${colors.reset}`
      )
    }
    config.initialUseStreaming = false
  }

  // Fetch API Gateway endpoint if needed
  if (!config.apiGatewayEndpoint && !config.initialUseStreaming) {
    if (config.debug) {
      console.log(
        `${colors.cyan}No API Gateway endpoint provided and not using streaming. Retrieving from CloudFormation...${colors.reset}`
      )
    }
    try {
      config.apiGatewayEndpoint = await getApiEndpoint(
        config.stackName!,
        config.region!,
        config.profile
      )
      if (config.apiGatewayEndpoint) {
        if (config.debug) {
          console.log(
            `${colors.green}Found API endpoint: ${colors.brightGreen}${config.apiGatewayEndpoint}${colors.reset}`
          )
        }
      } else {
        throw new Error('API Gateway endpoint not found in stack outputs.')
      }
    } catch (error: any) {
      console.error(
        `${colors.red}Failed to retrieve API endpoint: ${error.message || error}. Please provide the --endpoint parameter or ensure the stack output exists.${colors.reset}`
      )
      process.exit(1)
    }
  } else if (config.apiGatewayEndpoint) {
    if (config.debug) {
      console.log(
        `${colors.green}Using provided API endpoint: ${colors.brightGreen}${config.apiGatewayEndpoint}${colors.reset}`
      )
    }
  }

  // Final check: Need either a streaming setup or an API Gateway endpoint
  if (!config.lambdaFunctionUrl && !config.apiGatewayEndpoint) {
    console.error(
      `${colors.red}Configuration Error: Could not determine a valid API endpoint (neither streaming nor API Gateway). Check Cloudformation stack outputs or provide --endpoint.${colors.reset}`
    )
    process.exit(1)
  }

  // Assert that all required fields are present (TypeScript check)
  return config as AppConfig
}

// --- Single-Shot Query Execution ---
async function executeSingleQuery(config: AppConfig) {
  console.log(
    `${colors.bold}${colors.cyan}--- Executing Single Query ---${colors.reset}`
  )
  console.log(
    `${colors.brightBlack}Mode: ${colors.brightGreen}${config.initialUseStreaming ? 'Streaming' : 'Standard API'}${colors.reset}`
  )
  console.log(
    `${colors.brightBlack}Agent: ${colors.brightWhite}${config.initialAgent}${colors.reset}`
  )
  console.log(
    `${colors.brightBlack}Query: ${colors.brightWhite}${config.singleQuery}${colors.reset}`
  )
  console.log(`${colors.cyan}---${colors.reset}`)

  const requestBody = JSON.stringify({
    query: config.singleQuery,
    threadId: `thread-${config.sessionId}`,
    resourceId: `resource-${config.sessionId}`, // Use the same session ID for consistency
    agent: config.initialAgent,
  })

  let indicator: { stop: () => void } | undefined

  try {
    if (config.initialUseStreaming && config.lambdaFunctionUrl) {
      console.log(
        `${colors.bold}${colors.blue}Agent (${config.initialAgent}):${colors.reset}`
      )
      await invokeStreamingRequest({
        functionUrl: config.lambdaFunctionUrl,
        region: config.region,
        profile: config.profile,
        body: requestBody,
        onChunk: handleStreamingChunk,
      })
      console.log('\n') // Newline after streaming
    } else {
      // Standard API Gateway response (Single Shot)
      if (!config.apiGatewayEndpoint) {
        console.error(
          `${colors.red}Error: Cannot execute standard API query because the API Gateway endpoint is missing.${colors.reset}`
        )
        process.exit(1)
      }
      indicator = showProcessingIndicator(
        `Processing query with ${config.initialAgent}...`
      )
      const responseBody = await invokeSignedApiRequest({
        endpoint: config.apiGatewayEndpoint!,
        region: config.region,
        profile: config.profile,
        method: 'POST',
        body: requestBody,
      })
      indicator?.stop()
      const agentResponse = responseBody.message ?? JSON.stringify(responseBody)
      console.log(
        `${colors.bold}${colors.blue}Agent (${config.initialAgent}):${colors.reset} ${agentResponse}`
      )
    }
    console.log(`${colors.cyan}--- Query Complete ---${colors.reset}`)
    process.exit(0)
  } catch (error: any) {
    indicator?.stop()
    console.error(
      `${colors.red}\nError during single query execution:${colors.brightRed}`,
      error.message || error,
      colors.reset
    )
    process.exit(1)
  }
}

// --- Streaming Chunk Handler ---
function handleStreamingChunk(chunk: string) {
  try {
    const parsedChunk = JSON.parse(chunk)
    if (parsedChunk.statusCode && parsedChunk.body) {
      try {
        const parsedBody = JSON.parse(parsedChunk.body)
        process.stdout.write(parsedBody.message || parsedBody.toString())
      } catch (e) {
        process.stdout.write(parsedChunk.body)
      }
    } else if (parsedChunk.message) {
      process.stdout.write(parsedChunk.message)
    } else {
      process.stdout.write(JSON.stringify(parsedChunk))
    }
  } catch (e) {
    if (chunk.trim()) {
      process.stdout.write(chunk)
    }
    if (process.env.DEBUG) {
      console.log(`\n[DEBUG] Received text chunk: ${chunk.length} bytes`)
    }
  }
}

// --- Command Processing ---
const aliasToAgent: Record<string, AwsAgentNameWithNetwork> = {
  cf: CLOUDFORMATION_AGENT,
  cfn: CLOUDFORMATION_AGENT,
  cloudformation: CLOUDFORMATION_AGENT,
  cp: CODEPIPELINE_AGENT,
  codepipeline: CODEPIPELINE_AGENT,
  cw: CLOUDWATCHLOGS_AGENT,
  cwl: CLOUDWATCHLOGS_AGENT,
  logs: CLOUDWATCHLOGS_AGENT,
  cloudwatch: CLOUDWATCHLOGS_AGENT,
  lambda: LAMBDA_AGENT,
  dynamodb: DYNAMODB_AGENT,
  s3: S3_AGENT,
  net: AWS_AGENT_NETWORK,
  network: AWS_AGENT_NETWORK,
  aws: AWS_AGENT,
}

const agentToAlias: Record<AwsAgentNameWithNetwork, string> = {
  [CLOUDFORMATION_AGENT]: 'cfn',
  [CODEPIPELINE_AGENT]: 'cp',
  [CLOUDWATCHLOGS_AGENT]: 'cwl',
  [LAMBDA_AGENT]: 'lambda',
  [DYNAMODB_AGENT]: 'dynamodb',
  [S3_AGENT]: 's3',
  [AWS_AGENT_NETWORK]: 'network',
  [AWS_AGENT]: 'aws',
}

type CommandResult =
  | { type: 'continue' }
  | { type: 'exit' }
  | { type: 'query'; query: string }
  | { type: 'switchAgent'; agent: string }
  | { type: 'toggleStreaming'; enabled: boolean }
  | { type: 'showHelp' }
  | { type: 'showSession' }
  | { type: 'error'; message: string }

function processCommand(
  input: string,
  currentState: ChatState,
  config: AppConfig
): CommandResult {
  if (!input.startsWith('/')) {
    // If it's not a command, it's a query to the current agent
    return { type: 'query', query: input.trim() }
  }

  const [commandInput, ...commandArgs] = input.substring(1).trim().split(/\s+/)
  const command = commandInput.toLowerCase()

  switch (command) {
    case 'q':
    case 'quit':
    case 'exit':
      return { type: 'exit' }
    case 'a':
    case 'agent': {
      const agentName = commandArgs.join(' ').trim()
      if (!agentName) {
        return {
          type: 'error',
          message: `Current agent is ${colors.yellow}${currentState.currentAgent}${colors.reset}. Usage: /agent <agent_name>`,
        }
      }
      const newAgent = aliasToAgent[agentName] || agentName
      if (AWS_AGENT_NAMES_WITH_NETWORK.includes(newAgent)) {
        if (newAgent !== currentState.currentAgent) {
          return { type: 'switchAgent', agent: newAgent }
        } else {
          return { type: 'continue' } // Already using this agent
        }
      } else {
        return {
          type: 'error',
          message: `Invalid agent "${agentName}". Available agents: ${AWS_AGENT_NAMES_WITH_NETWORK.join(', ')}.`,
        }
      }
    }
    case 'capabilities':
      return { type: 'query', query: 'What are your capabilities?' }
    case 'help':
      return { type: 'showHelp' }
    case 'session':
      return { type: 'showSession' }
    case 'streaming':
      if (!config.lambdaFunctionUrl) {
        return {
          type: 'error',
          message: 'Streaming mode cannot be toggled: Function URL is missing.',
        }
      }
      return { type: 'toggleStreaming', enabled: !currentState.useStreaming }
    default:
      // No prefix match found, handle legacy/unknown
      // Backward compatibility for legacy commands (optional)
      if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
        return { type: 'exit' }
      }
      if (input.toLowerCase().startsWith('agent:')) {
        const agentName = input.substring(6).trim()
        const newAgent = aliasToAgent[agentName] || agentName
        if (AWS_AGENT_NAMES_WITH_NETWORK.includes(newAgent)) {
          if (newAgent !== currentState.currentAgent) {
            return { type: 'switchAgent', agent: newAgent }
          } else {
            return { type: 'continue' } // Already using this agent
          }
        } else {
          return {
            type: 'error',
            message: `Invalid agent "${agentName}". Available agents: ${AWS_AGENT_NAMES_WITH_NETWORK.join(', ')}.`,
          }
        }
      }

      // If it wasn't a slash command and didn't match legacy, treat as query
      if (!input.startsWith('/') && input.trim()) {
        return { type: 'query', query: input.trim() }
      }

      return {
        type: 'error',
        message: `Unknown command: ${commandInput}. Type /help for available commands.`,
      }
  }
}

function showHelp() {
  // Define descriptions locally for now
  const agentDescriptions: Record<string, string> = {
    [CLOUDFORMATION_AGENT]: 'AWS CloudFormation stack expert',
    [CODEPIPELINE_AGENT]: 'AWS CodePipeline expert',
    [CLOUDWATCHLOGS_AGENT]: 'AWS CloudWatch Logs expert',
    [LAMBDA_AGENT]: 'AWS Lambda functions expert',
    [DYNAMODB_AGENT]: 'AWS DynamoDB tables expert',
    [S3_AGENT]: 'AWS S3 buckets and objects expert',
    [AWS_AGENT]: 'AWS general expert',
    [AWS_AGENT_NETWORK]: 'Coordinating network of all AWS agents',
  }

  let agentHelpText = ''
  for (const agentName of AWS_AGENT_NAMES_WITH_NETWORK) {
    const description = agentDescriptions[agentName] || ''
    const agentNameWithAlias = `${agentName} (${agentToAlias[agentName] || ''})`
    agentHelpText += `  ${colors.yellow}${agentNameWithAlias.padEnd(25)}${colors.reset} ${description}\n`
  }

  console.log(`
${colors.bold}${colors.brightGreen}Interactive Chat Client${colors.reset}
${colors.dim}This client lets you interact with the remote Mastra agents.${colors.reset}

${colors.bold}Available Commands:${colors.reset}
  ${colors.cyan}/help${colors.reset}                 Show this help message
  ${colors.cyan}/exit${colors.reset}                 Exit the chat session
  ${colors.cyan}/session${colors.reset}              Show current session info
  ${colors.cyan}/agent${colors.reset} <agent_name>   Switch to a different agent
  ${colors.cyan}/streaming${colors.reset} <on|off>   Toggle streaming mode

${colors.bold}Available Agents:${colors.reset}
${agentHelpText}
${colors.italic}${colors.dim}Note: Your sessionId is preserved during the chat session to maintain conversation context.${colors.reset}
`)
}

function showSessionInfo(state: ChatState, config: AppConfig) {
  console.log(`\n${colors.brightYellow}Session Information:${colors.reset}`)
  console.log(
    `${colors.yellow}Session ID: ${colors.brightWhite}${config.sessionId}${colors.reset}`
  )
  console.log(
    `${colors.yellow}Current Agent: ${colors.brightWhite}${state.currentAgent}${colors.reset}`
  )
  console.log(
    `${colors.yellow}Streaming Mode: ${colors.brightWhite}${state.useStreaming ? 'Enabled' : 'Disabled'}${colors.reset}`
  )
  if (state.useStreaming) {
    console.log(
      `${colors.yellow}  Streaming Function URL: ${colors.brightWhite}${config.lambdaFunctionUrl}${colors.reset}`
    )
  } else if (config.apiGatewayEndpoint) {
    console.log(
      `${colors.yellow}  API Endpoint: ${colors.brightWhite}${config.apiGatewayEndpoint}${colors.reset}`
    )
  }

  console.log(
    `${colors.yellow}Region: ${colors.brightWhite}${config.region}${colors.reset}`
  )
  console.log(
    `${colors.yellow}Profile: ${colors.brightWhite}${config.profile ?? '(default)'}${colors.reset}`
  )

  console.log(`${colors.cyan}---${colors.reset}`)
}

// --- API Interaction Logic ---
async function invokeAgent(
  query: string,
  state: ChatState,
  config: AppConfig
): Promise<void> {
  const requestBody = JSON.stringify({
    query: query,
    threadId: `thread-${config.sessionId}`,
    resourceId: `resource-${config.sessionId}`,
    agent: state.currentAgent,
  })

  let indicator: { stop: () => void } | undefined
  let canStream = state.useStreaming && config.lambdaFunctionUrl

  try {
    if (canStream) {
      console.log(
        `${colors.bold}${colors.blue}Agent (${state.currentAgent}):${colors.reset}`
      )
      await invokeStreamingRequest({
        functionUrl: config.lambdaFunctionUrl!,
        region: config.region,
        profile: config.profile,
        body: requestBody,
        onChunk: handleStreamingChunk,
      })
      console.log('\n') // Newline after streaming
    } else if (config.apiGatewayEndpoint) {
      // Use standard API Gateway
      indicator = showProcessingIndicator(
        `Processing with ${state.currentAgent}...`
      )
      const responseBody = await invokeSignedApiRequest({
        endpoint: config.apiGatewayEndpoint,
        region: config.region,
        profile: config.profile,
        method: 'POST',
        body: requestBody,
      })
      indicator?.stop()
      const agentResponse = responseBody.message ?? JSON.stringify(responseBody)
      console.log(
        `${colors.bold}${colors.blue}Agent (${state.currentAgent}):${colors.reset} ${agentResponse}`
      )
    } else {
      // Should not happen due to earlier checks, but safeguard
      console.error(
        `${colors.red}Configuration Error: No valid method to contact the agent (Streaming unavailable and no API Gateway endpoint).${colors.reset}`
      )
    }
  } catch (error: any) {
    indicator?.stop()
    console.error(
      `${colors.red}\nError during API call:${colors.brightRed}`,
      error.message || error,
      colors.reset
    )
    console.log(
      `${colors.yellow}Please try again or type "/exit" to quit.${colors.reset}`
    )
  } finally {
    console.log(`${colors.cyan}---${colors.reset}`) // Separator
  }
}

// --- Main Chat Logic ---
async function startInteractiveChat(config: AppConfig) {
  console.log(
    `${colors.bold}${colors.cyan}--- Starting Interactive Chat ---${colors.reset}`
  )

  const state: ChatState = {
    currentAgent: config.initialAgent,
    useStreaming: config.initialUseStreaming,
  }

  showSessionInfo(state, config) // Show initial state

  if (!config.sessionId.startsWith('chat-')) {
    // Only show if user provided ID
    console.log(
      `${colors.dim}(Resuming session with ID: ${config.sessionId})${colors.reset}`
    )
  } else {
    console.log(
      `${colors.dim}(Use --session-id ${config.sessionId} to resume later.)${colors.reset}`
    )
  }

  console.log(`${colors.dim}Type /help for available commands.${colors.reset}`)

  const rl = readline.createInterface({
    input,
    output,
    terminal: true,
  })

  // Graceful exit handlers
  rl.on('close', () => {
    console.log(
      `\n${colors.bold}${colors.cyan}--- Chat Session Ended (EOF/Close) ---${colors.reset}`
    )
    process.exit(0)
  })
  process.on('SIGINT', () => {
    console.log(
      `\n${colors.bold}${colors.cyan}--- Chat Session Ended (SIGINT) ---${colors.reset}`
    )
    rl.close()
    // rl.close() should trigger the 'close' event above
  })

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let userInput: string | null = null
    try {
      userInput = await rl.question(
        `${colors.bold}${colors.green}You:${colors.reset} `
      )
    } catch (error) {
      console.log(`\n${colors.yellow}Readline error, exiting...${colors.reset}`)
      break // Exit loop on readline error
    }

    // Handle Ctrl+D (EOF)
    if (userInput === null) {
      break // Exit loop, rl.on('close') will handle exit message
    }

    const commandResult = processCommand(userInput, state, config)

    switch (commandResult.type) {
      case 'continue':
        // Just loop again for the next input
        break
      case 'exit':
        rl.close()
        return // Exit function, process will exit via rl.on('close')
      case 'query':
        await invokeAgent(commandResult.query, state, config)
        break
      case 'switchAgent':
        state.currentAgent = commandResult.agent
        console.log(
          `${colors.magenta}Switched to agent: ${colors.brightMagenta}${state.currentAgent}${colors.reset}`
        )
        console.log(`${colors.cyan}---${colors.reset}`)
        break
      case 'toggleStreaming':
        state.useStreaming = commandResult.enabled
        console.log(
          `${colors.magenta}Streaming mode ${state.useStreaming ? 'enabled' : 'disabled'}.${colors.reset}`
        )
        showSessionInfo(state, config) // Show updated info
        break
      case 'showHelp':
        showHelp()
        break
      case 'showSession':
        showSessionInfo(state, config)
        break
      case 'error':
        console.log(
          `${colors.red}Error: ${commandResult.message}${colors.reset}`
        )
        console.log(`${colors.cyan}---${colors.reset}`)
        break
    }
  }
}

// --- Main Execution ---
async function main() {
  try {
    const config = await loadAndValidateConfig()

    if (config.singleQuery) {
      await executeSingleQuery(config)
    } else {
      await startInteractiveChat(config)
    }
  } catch (error: any) {
    console.error(
      `${colors.red}\nUnhandled error during script execution:${colors.brightRed}`,
      error.message || error,
      colors.reset
    )
    process.exit(1)
  }
}

await main()
