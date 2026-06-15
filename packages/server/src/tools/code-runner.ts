import vm from 'node:vm'

import { tool } from 'ai'

import { z } from 'zod'

export const codeRunnerTool = tool({
  description:
    'Execute a JavaScript code snippet in a restricted VM context (node:vm) and return stdout output. ' +
    'Useful for calculations, data transformations, formatting, JSON processing, and quick prototyping. ' +
    'Available globals: console, Math, Date, JSON, Array, Object, String, Number, Map, Set, Promise, RegExp. ' +
    'Use console.log() to produce output. No require/import, no filesystem, no network access.',
  parameters: z.object({
    code: z.string().describe('JavaScript code to execute'),
    timeout: z.number().optional().default(5000).describe('Execution timeout in milliseconds (max 10000)'),
  }),
  execute: async ({ code, timeout }) => {
    const logs: string[] = []
    const sandbox = {
      console: {
        log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
        error: (...args: unknown[]) => logs.push('[stderr] ' + args.map(String).join(' ')),
        warn: (...args: unknown[]) => logs.push('[warn] ' + args.map(String).join(' ')),
      },
      Math,
      Date,
      JSON,
      parseInt,
      parseFloat,
      isNaN,
      isFinite,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Map,
      Set,
      Promise,
      Error,
      TypeError,
      RangeError,
      encodeURIComponent,
      decodeURIComponent,
    }

    const safeTimeout = Math.min(timeout, 10_000)

    try {
      const result = vm.runInNewContext(code, sandbox, { timeout: safeTimeout })
      const resultStr = result !== undefined ? String(result) : undefined
      return {
        success: true,
        output: logs.join('\n'),
        result: resultStr,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return {
        success: false,
        output: logs.join('\n'),
        error: message,
      }
    }
  },
})
