import {
  CodePipelineClient,
  ListPipelinesCommand,
  PipelineSummary,
} from '@aws-sdk/client-codepipeline'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import { createTool } from '@mastra/core'
import Fuse, { IFuseOptions } from 'fuse.js'
import { z } from 'zod'

const inputSchema = z.object({
  query: z
    .string()
    .describe('Search query to fuzzy match against pipeline names'),
  region: z
    .string()
    .optional()
    .default('us-east-1')
    .describe('AWS region to search pipelines in. Defaults to us-east-1.'),
  limit: z
    .number()
    .min(1)
    .optional()
    .default(5)
    .describe(
      'Maximum number of pipelines to return in search results. Defaults to 5.'
    ),
  threshold: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .default(0.6)
    .describe(
      'Search precision (0-1). Lower means more precise matches. Defaults to 0.6.'
    ),
})

export const codepipelineFindPipeline = createTool({
  id: 'codepipeline_find_pipeline',
  description: `Tool for finding AWS CodePipelines using fuzzy name matching.

WHEN TO USE:
- When you need to find a CodePipeline but only have a partial or misspelled name.
- When a user refers to a pipeline without using its exact name (e.g., "What's the status of the 'main-deploy' pipeline?").
- As an entry point before using other CodePipeline tools if the pipeline name is ambiguous.

FEATURES:
- Advanced fuzzy searching to find pipelines by partial or inexact names.
- Relevance ranking to return best matches first.
- Returns detailed match information including confidence scores.

CHAIN WITH:
- Use this first when pipeline name is unclear, then pass the found pipeline name to other tools like 'codepipeline_get_pipeline' or 'codepipeline_get_pipeline_state'.

NOTES:
- Higher confidence scores (closer to 100) indicate better matches.
- Returns multiple candidates if the search is ambiguous.
- The 'pipelineName' field in the top result can be directly used with other CodePipeline tools.
- Adjust 'threshold' parameter (0.0 to 1.0) to control search sensitivity (lower is stricter).`,
  inputSchema,
  execute: async ({ context }) => {
    try {
      const client = new CodePipelineClient({
        credentials: fromNodeProviderChain({
          ignoreCache: true,
        }),
        region: context.region,
      })

      const getAllPipelines = async (): Promise<PipelineSummary[]> => {
        const allPipelines: PipelineSummary[] = []
        let nextToken: string | undefined

        do {
          const command = new ListPipelinesCommand({
            nextToken: nextToken,
          })
          const response = await client.send(command)

          if (response.pipelines) {
            allPipelines.push(...response.pipelines)
          }
          nextToken = response.nextToken
        } while (nextToken)

        return allPipelines
      }

      const allPipelines = await getAllPipelines()

      if (allPipelines.length === 0) {
        return {
          found: false,
          message: `No pipelines found in region ${context.region}.`,
          matches: [],
        }
      }

      const pipelinesForSearch = allPipelines.map((pipeline) => ({
        pipelineName: pipeline.name || '',
        version: pipeline.version,
        created: pipeline.created?.toISOString(),
        updated: pipeline.updated?.toISOString(),
      }))

      const fuseOptions: IFuseOptions<(typeof pipelinesForSearch)[0]> = {
        includeScore: true,
        threshold: context.threshold ?? 0.6,
        keys: ['pipelineName'],
      }

      const fuse = new Fuse(pipelinesForSearch, fuseOptions)
      const searchResults = fuse.search(context.query)

      const topMatches = searchResults
        .slice(0, context.limit ?? 5)
        .map((result) => {
          const score = result.score ?? 1 // Default score to 1 (no match) if undefined
          const confidence = Math.round((1 - score) * 100)
          return {
            pipelineName: result.item.pipelineName,
            confidence,
            version: result.item.version,
            created: result.item.created,
            updated: result.item.updated,
          }
        })

      const bestMatch = topMatches.length > 0 ? topMatches[0] : null

      return {
        found: topMatches.length > 0,
        query: context.query,
        bestMatch,
        matches: topMatches,
        totalPipelinesSearched: allPipelines.length,
      }
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : 'An unknown error occurred'
      throw new Error(
        JSON.stringify({
          error: {
            message: errorMessage,
            region: context.region,
            query: context.query,
            type:
              error instanceof Error ? error.constructor.name : 'UnknownError',
          },
        })
      )
    }
  },
})
