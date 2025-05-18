import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager'

const secretsManager = new SecretsManagerClient({})

export async function getPineconeKey(): Promise<string> {
  const secretName = process.env.PINECONE_API_KEY_SECRET_NAME
  if (!secretName) {
    throw new Error(
      'PINECONE_API_KEY_SECRET_NAME environment variable is not set'
    )
  }
  const command = new GetSecretValueCommand({
    SecretId: secretName,
  })
  const response = await secretsManager.send(command)
  if (!response.SecretString) {
    throw new Error('Pinecone secret value is empty')
  }
  return response.SecretString
}
