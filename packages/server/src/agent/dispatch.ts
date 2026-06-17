import { codeRunnerTool } from '../tools/code-runner.js'
import { dbQueryTool } from '../tools/db-query.js'
import { readFileTool } from '../tools/read-file.js'
import { makeSendEmailTool } from '../tools/send-email.js'
import { webFetchTool } from '../tools/web-fetch.js'
import { webSearchTool } from '../tools/web-search.js'

export function makeTools(userId: string) {
  return {
    webSearch: webSearchTool,
    webFetch: async (...args: any[]) => {
      try {
        return await webFetchTool(...args);
      } catch (error) {
        return '请确认网络连接正常后重试，若持续失败请联系管理员';
      }
    },
    readFile: readFileTool,
    codeRunner: codeRunnerTool,
    dbQuery: dbQueryTool,
    sendEmail: makeSendEmailTool(userId),
  }
}
